import prisma from "../../../config/db";
import { notify } from "../../../services/notifications/notification.service";
import {
  AdminActionError,
  freezeUser,
  getReconciliation,
  listAuditLog,
  recheckDeposit,
  searchUsers,
  setUserTier,
  unfreezeUser,
  unlockPin,
} from "../../../services/admin/admin.service";
import { confirmDeposit } from "../../../services/payments/deposit.service";
import { fetchBalance, isPaystackConfigured, PaystackError } from "../../../services/payments/paystack.client";
import { walletsOffLedger } from "../../../services/ledger/ledger.service";

const tx = {
  user: { updateMany: jest.fn(), update: jest.fn() },
  adminAuditLog: { create: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    deposit: { findUnique: jest.fn() },
    wallet: { aggregate: jest.fn(), count: jest.fn() },
    adminAuditLog: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  },
}));
jest.mock("../../../services/notifications/notification.service", () => ({ notify: jest.fn() }));
jest.mock("../../../services/payments/deposit.service", () => ({ confirmDeposit: jest.fn() }));
jest.mock("../../../services/payments/withdrawal.service", () => ({ confirmWithdrawal: jest.fn() }));
jest.mock("../../../services/wallet.service", () => ({ computeBalance: jest.fn() }));
jest.mock("../../../services/ledger/ledger.service", () => ({
  SYSTEM_ACCOUNTS: { PAYSTACK_CLEARING: "paystack_clearing" },
  ledgerSummary: jest.fn().mockResolvedValue({
    accounts: [{ code: "paystack_clearing", name: "Paystack clearing", type: "ASSET", balance: "4500.00" }],
    userWallets: { count: 3, balance: "5000.00" },
    trialBalance: "0.00",
  }),
  walletsOffLedger: jest.fn().mockResolvedValue([]),
  walletLedgerBalance: jest.fn(),
}));
jest.mock("../../../services/payments/paystack.client", () => ({
  ...jest.requireActual("../../../services/payments/paystack.client"),
  fetchBalance: jest.fn(),
  isPaystackConfigured: jest.fn(),
}));

const expectAdminError = async (promise: Promise<unknown>, status: number, message?: string) => {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(AdminActionError);
  expect(error).toMatchObject({ status, ...(message ? { message } : {}) });
};

const target = (overrides: Record<string, unknown> = {}) => ({
  id: "u2",
  role: "USER",
  tier: "TIER_1",
  frozenAt: null,
  pinLockedUntil: null,
  pinFailedAttempts: 0,
  ...overrides,
});

describe("admin.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
    tx.user.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("setUserTier", () => {
    it("moves the user to the new tier, records from/to and why, and tells the user their new limits", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target());

      await setUserTier("admin1", "u2", "TIER_2", "ID checked on a call");

      expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: "u2", tier: { not: "TIER_2" } }, data: { tier: "TIER_2" } });
      expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: "admin1",
          action: "user.tier_change",
          targetType: "User",
          targetId: "u2",
          reason: "ID checked on a call",
          details: { from: "TIER_1", to: "TIER_2" },
        },
      });
      const alert = (notify as jest.Mock).mock.calls[0][0];
      expect(alert).toMatchObject({ userId: "u2", type: "account.tier_changed" });
      expect(alert.body).toContain("Tier 2");
      expect(alert.body).toContain("₦500,000 per payment");
      expect(alert.body).toContain("no limit on your balance");
    });

    it("refuses to change the admin's own tier", async () => {
      await expectAdminError(setUserTier("admin1", "admin1", "TIER_2", "testing"), 400);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("reports 409 and writes no audit entry when the user is already on that tier", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target());
      tx.user.updateMany.mockResolvedValue({ count: 0 });

      await expectAdminError(setUserTier("admin1", "u2", "TIER_1", "again"), 409, "This account is already on Tier 1");
      expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("freezeUser", () => {
    it("freezes the account, records who and why, and tells the user without the internal reason", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target());

      await freezeUser("admin1", "u2", "Chargeback investigation");

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u2", frozenAt: null },
        data: { frozenAt: expect.any(Date), frozenReason: "Chargeback investigation" },
      });
      expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
        data: { adminId: "admin1", action: "user.freeze", targetType: "User", targetId: "u2", reason: "Chargeback investigation" },
      });
      const alert = (notify as jest.Mock).mock.calls[0][0];
      expect(alert).toMatchObject({ userId: "u2", type: "security.account_frozen" });
      expect(alert.body).not.toContain("Chargeback");
    });

    it("refuses to freeze the admin's own account", async () => {
      await expectAdminError(freezeUser("admin1", "admin1", "testing"), 400, "You can't freeze your own account");
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to freeze another admin", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target({ role: "ADMIN" }));

      await expectAdminError(freezeUser("admin1", "u2", "testing"), 400);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it("reports 409 and writes no audit entry when the account is already frozen", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target());
      tx.user.updateMany.mockResolvedValue({ count: 0 });

      await expectAdminError(freezeUser("admin1", "u2", "again"), 409);
      expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it("404s for an unknown user", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expectAdminError(freezeUser("admin1", "ghost", "testing"), 404);
    });
  });

  describe("unfreezeUser", () => {
    it("lifts the hold, audits it and tells the user", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target({ frozenAt: new Date() }));

      await unfreezeUser("admin1", "u2", "Investigation closed");

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: "u2", frozenAt: { not: null } },
        data: { frozenAt: null, frozenReason: null },
      });
      expect(tx.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "user.unfreeze", reason: "Investigation closed" });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "security.account_unfrozen" }));
    });

    it("reports 409 when the account isn't frozen", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target());
      tx.user.updateMany.mockResolvedValue({ count: 0 });

      await expectAdminError(unfreezeUser("admin1", "u2", "testing"), 409);
    });
  });

  describe("unlockPin", () => {
    it("clears an active lockout and audits it", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target({ pinLockedUntil: new Date(Date.now() + 60_000) }));

      await unlockPin("admin1", "u2", "Verified by phone");

      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u2" }, data: { pinFailedAttempts: 0, pinLockedUntil: null } });
      expect(tx.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: "user.unlock_pin" });
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "security.pin_unlocked" }));
    });

    it("reports 409 when the lock has already expired", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(target({ pinLockedUntil: new Date(Date.now() - 1000) }));

      await expectAdminError(unlockPin("admin1", "u2", "testing"), 409);
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe("recheckDeposit", () => {
    it("rechecks through the normal settlement code and audits before and after", async () => {
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue({ id: "d1", status: "PENDING" });
      (confirmDeposit as jest.Mock).mockResolvedValue({ status: "SUCCESSFUL" });

      const result = await recheckDeposit("admin1", "dep_1");

      expect(confirmDeposit).toHaveBeenCalledWith("dep_1");
      expect(result).toEqual({ reference: "dep_1", before: "PENDING", after: "SUCCESSFUL" });
      expect(tx.adminAuditLog.create.mock.calls[0][0].data).toMatchObject({
        action: "deposit.recheck",
        targetType: "Deposit",
        targetId: "d1",
        details: { reference: "dep_1", before: "PENDING", after: "SUCCESSFUL" },
      });
    });

    it("turns a Paystack failure into a 502", async () => {
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue({ id: "d1", status: "PENDING" });
      (confirmDeposit as jest.Mock).mockRejectedValue(new PaystackError("Service unavailable", 503));

      await expectAdminError(recheckDeposit("admin1", "dep_1"), 502, "Paystack: Service unavailable");
      expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
    });

    it("404s for an unknown reference", async () => {
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue(null);

      await expectAdminError(recheckDeposit("admin1", "nope"), 404);
      expect(confirmDeposit).not.toHaveBeenCalled();
    });
  });

  describe("searchUsers", () => {
    it("pages with a cursor and reports balances as strings", async () => {
      const row = (id: string) => ({ id, name: id, email: `${id}@x.com`, role: "USER", createdAt: new Date(), frozenAt: null, wallet: { balance: 12.5 } });
      (prisma.user.findMany as jest.Mock).mockResolvedValue([row("a"), row("b"), row("c")]);

      const page = await searchUsers("ada", 2);

      expect(page.items.map((u) => u.id)).toEqual(["a", "b"]);
      expect(page.nextCursor).toBe("b");
      expect(page.items[0].balance).toBe("12.50");
      expect((prisma.user.findMany as jest.Mock).mock.calls[0][0].take).toBe(3);
    });
  });

  describe("getReconciliation", () => {
    beforeEach(() => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { userId: "u1", name: "Ada", email: "ada@x.com", stored: "100.00", computed: "90.00" },
      ]);
      (prisma.wallet.aggregate as jest.Mock).mockResolvedValue({ _sum: { balance: "5000.00" } });
      (prisma.wallet.count as jest.Mock).mockResolvedValue(3);
    });

    it("lists mismatches with the difference and compares with the Paystack balance", async () => {
      (isPaystackConfigured as jest.Mock).mockReturnValue(true);
      (fetchBalance as jest.Mock).mockResolvedValue([{ currency: "NGN", balance: 450000 }]);

      const result = await getReconciliation();

      expect(result.totalHeld).toBe("5000.00");
      expect(result.paystack).toEqual({ available: true, balance: "4500.00" });
      expect(result.mismatches[0]).toMatchObject({ stored: "100.00", computed: "90.00", difference: "10.00" });
      expect(result.ledger).toMatchObject({ trialBalance: "0.00", paystackClearing: "4500.00" });
      expect(result.offLedger).toEqual([]);
    });

    it("lists any wallet whose stored balance has drifted from its ledger account", async () => {
      (walletsOffLedger as jest.Mock).mockResolvedValueOnce([{ userId: "u9", name: "Bo", email: "bo@x.com", stored: "50.00", ledger: "40.00" }]);
      (isPaystackConfigured as jest.Mock).mockReturnValue(false);

      const result = await getReconciliation();

      expect(result.offLedger).toEqual([{ userId: "u9", name: "Bo", email: "bo@x.com", stored: "50.00", ledger: "40.00", difference: "10.00" }]);
    });

    it("still reports wallets when Paystack can't be reached", async () => {
      (isPaystackConfigured as jest.Mock).mockReturnValue(true);
      (fetchBalance as jest.Mock).mockRejectedValue(new Error("timeout"));

      const result = await getReconciliation();

      expect(result.paystack).toEqual({ available: false, message: "timeout" });
      expect(result.wallets).toBe(3);
    });
  });
});

describe("admin.service listAuditLog", () => {
  it("adds the target user's name and email in a single lookup", async () => {
    (prisma.adminAuditLog.findMany as jest.Mock).mockResolvedValue([
      { id: "a1", targetType: "User", targetId: "u2", admin: null },
      { id: "a2", targetType: "User", targetId: "u2", admin: null },
      { id: "a3", targetType: "Deposit", targetId: "d1", admin: null },
    ]);
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: "u2", name: "Grace", email: "grace@x.com" }]);

    const page = await listAuditLog({ limit: 25 });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect((prisma.user.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ id: { in: ["u2"] } });
    expect(page.items.map((entry) => entry.targetUser)).toEqual([
      { id: "u2", name: "Grace", email: "grace@x.com" },
      { id: "u2", name: "Grace", email: "grace@x.com" },
      null,
    ]);
  });
});
