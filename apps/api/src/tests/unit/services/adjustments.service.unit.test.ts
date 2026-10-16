import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../../../config/db";
import { approveAdjustment, rejectAdjustment, requestAdjustment } from "../../../services/admin/adjustments.service";
import { AdminActionError } from "../../../services/admin/admin.service";
import { setStaffRole } from "../../../services/admin/staff.service";
import { post } from "../../../services/ledger/ledger.service";
import { notify } from "../../../services/notifications/notification.service";

const tx = {
  adjustment: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn() },
  wallet: { findUnique: jest.fn(), update: jest.fn() },
  transaction: { create: jest.fn() },
  adminAuditLog: { create: jest.fn() },
  user: { count: jest.fn(), update: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), count: jest.fn() },
    adjustment: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("bcryptjs");
jest.mock("../../../services/ledger/ledger.service", () => ({ post: jest.fn(), SYSTEM_ACCOUNTS: { ADJUSTMENTS: "adjustments" } }));
jest.mock("../../../services/notifications/notification.service", () => ({ notify: jest.fn(), formatNaira: (v: unknown) => `₦${String(v)}` }));
jest.mock("../../../utils/lock.utils", () => ({ withLock: jest.fn((_id: string, fn: () => unknown) => fn()) }));
jest.mock("../../../utils/cache.utils", () => ({ invalidateBalance: jest.fn() }));
jest.mock("../../../queues/transaction.queue", () => ({ enqueueTransactionEvent: jest.fn() }));

const d = (v: number | string) => new Prisma.Decimal(v);
const request = (overrides: Record<string, unknown> = {}) => ({
  userId: "customer",
  direction: "CREDIT" as const,
  kind: "GOODWILL" as const,
  amount: 2500,
  reason: "Sorry for the delay",
  password: "secret",
  ...overrides,
});
const pending = (overrides: Record<string, unknown> = {}) => ({
  id: "adj-1",
  userId: "customer",
  direction: "CREDIT",
  kind: "GOODWILL",
  amount: d(2500),
  reason: "Sorry for the delay",
  status: "PENDING",
  requestedById: "finance",
  ...overrides,
});
const error = async (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as AdminActionError);

describe("adjustments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ password: "hash" });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "customer" });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    tx.adjustment.create.mockImplementation(({ data }) => Promise.resolve({ id: "adj-1", status: "PENDING", ...data }));
    tx.adjustment.updateMany.mockResolvedValue({ count: 1 });
    tx.wallet.findUnique.mockResolvedValue({ userId: "customer", balance: d(1000) });
    tx.transaction.create.mockResolvedValue({ id: "tx-1", amount: d(2500), reference: "ref", timestamp: new Date() });
    (prisma.adjustment.findUniqueOrThrow as jest.Mock).mockImplementation(() => Promise.resolve(pending()));
  });

  it("needs the admin's password, and a wrong one is 400 (never 401)", async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const e = await error(requestAdjustment("finance", request()));

    expect(e).toMatchObject({ status: 400, message: "Incorrect password" });
    expect(tx.adjustment.create).not.toHaveBeenCalled();
  });

  it("applies a credit up to ₦10,000 at once: wallet, user-facing transaction, ledger, audit and notice", async () => {
    await requestAdjustment("finance", request());

    expect(tx.wallet.update).toHaveBeenCalledWith({ where: { userId: "customer" }, data: { balance: d(3500) } });
    expect(tx.transaction.create.mock.calls[0][0].data).toMatchObject({ type: "CREDIT", description: "Credit from PurpleWallet" });
    expect(post).toHaveBeenCalledWith(tx, expect.objectContaining({
      type: "ADJUSTMENT",
      debit: "adjustments",
      credit: { wallet: "customer" },
      reference: "adj-1",
      createdById: "finance",
    }));
    expect(tx.adminAuditLog.create.mock.calls.map((c) => c[0].data.action)).toEqual(["adjustment.request", "adjustment.approve"]);
    // The internal reason isn't shown to the user
    expect((notify as jest.Mock).mock.calls[0][0].body).not.toContain("delay");
  });

  it("leaves anything above ₦10,000 pending for a second admin", async () => {
    const result = await requestAdjustment("finance", request({ amount: 25000 }));

    expect(result.status).toBe("PENDING");
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("won't let the requester approve their own adjustment when another admin could", async () => {
    (prisma.adjustment.findUnique as jest.Mock).mockResolvedValue(pending({ amount: d(25000) }));
    (prisma.user.count as jest.Mock).mockResolvedValue(1);

    expect(await error(approveAdjustment("finance", "adj-1", "secret"))).toMatchObject({ status: 403 });
    expect(tx.adjustment.updateMany).not.toHaveBeenCalled();
    // Other approvers are active Finance or Owner staff, excluding the requester
    expect((prisma.user.count as jest.Mock).mock.calls[0][0].where).toEqual({
      id: { not: "finance" },
      role: { in: ["FINANCE", "OWNER"] },
      frozenAt: null,
    });
  });

  it("lets the only admin approve their own, recorded as self-approved", async () => {
    (prisma.adjustment.findUnique as jest.Mock).mockResolvedValue(pending({ amount: d(25000) }));
    (prisma.user.count as jest.Mock).mockResolvedValue(0);

    await approveAdjustment("finance", "adj-1", "secret", "Checked the receipt");

    expect(tx.adjustment.updateMany.mock.calls[0][0].data).toMatchObject({
      status: "APPROVED",
      decidedById: "finance",
      decisionNote: "Self-approved: no second approver available. Checked the receipt",
    });
    const approval = tx.adminAuditLog.create.mock.calls.find((c) => c[0].data.action === "adjustment.approve")[0].data;
    expect(approval.details).toMatchObject({ selfApproved: true, soloApproval: true });
    expect(post).toHaveBeenCalled();
  });

  it("lets a different admin approve, recording who decided", async () => {
    (prisma.adjustment.findUnique as jest.Mock).mockResolvedValue(pending({ amount: d(25000) }));

    await approveAdjustment("owner", "adj-1", "secret", "Checked");

    expect(tx.adjustment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "adj-1", status: "PENDING" },
      data: { status: "APPROVED", decidedById: "owner", decisionNote: "Checked" },
    });
    expect(post).toHaveBeenCalledWith(tx, expect.objectContaining({ createdById: "owner" }));
  });

  it("refuses a debit that would take the wallet below zero, and marks a small one rejected", async () => {
    (prisma.adjustment.findUniqueOrThrow as jest.Mock).mockImplementation(() =>
      Promise.resolve(pending({ direction: "DEBIT", kind: "CORRECTION", amount: d(5000) }))
    );

    const e = await error(requestAdjustment("finance", request({ direction: "DEBIT", kind: "CORRECTION", amount: 5000 })));

    expect(e).toMatchObject({ status: 409, message: "This would take the wallet below zero" });
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect((prisma.adjustment.updateMany as jest.Mock).mock.calls[0][0].data).toMatchObject({ status: "REJECTED" });
  });

  it.each([
    [{ direction: "DEBIT", kind: "GOODWILL" }, "Only a correction can take money from a wallet"],
    [{ userId: "finance" }, "You can't adjust your own balance"],
    [{ amount: 10.555 }, "Enter an amount up to ₦10,000,000"],
  ])("refuses %j", async (overrides, message) => {
    expect(await error(requestAdjustment("finance", request(overrides)))).toMatchObject({ status: 400, message });
  });

  it("can be rejected, once", async () => {
    await rejectAdjustment("owner", "adj-1", "secret", "Not a duplicate after all");
    expect(tx.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "adjustment.reject" });

    tx.adjustment.updateMany.mockResolvedValue({ count: 0 });
    expect(await error(rejectAdjustment("owner", "adj-1", "secret", "again"))).toMatchObject({ status: 409 });
  });
});

describe("staff roles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    (prisma.user.findUniqueOrThrow as jest.Mock).mockResolvedValue({ password: "hash" });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    tx.user.update.mockResolvedValue({ id: "u2", role: "SUPPORT" });
  });

  it("grants a role and audits the change", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u2", role: "USER", frozenAt: null });

    await setStaffRole("owner", "u2", "SUPPORT", "New support hire", "secret");

    expect(tx.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "staff.role_change", details: { from: "USER", to: "SUPPORT" } });
  });

  it("never demotes the last owner", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u2", role: "OWNER", frozenAt: null });
    tx.user.count.mockResolvedValue(1);

    expect(await error(setStaffRole("owner", "u2", "VIEWER", "x x x", "secret"))).toMatchObject({ status: 409 });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("refuses an owner changing their own role, or giving a frozen account a staff role", async () => {
    expect(await error(setStaffRole("owner", "owner", "VIEWER", "x x x", "secret"))).toMatchObject({ status: 400 });

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "u2", role: "USER", frozenAt: new Date() });
    expect(await error(setStaffRole("owner", "u2", "SUPPORT", "x x x", "secret"))).toMatchObject({ status: 400 });
  });
});
