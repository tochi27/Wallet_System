import { DepositStatus, Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../../config/db";
import { enqueueTransactionEvent } from "../../../queues/transaction.queue";
import { invalidateBalance } from "../../../utils/cache.utils";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../../../utils/idempotency.utils";
import { initializeTransaction, verifyTransaction } from "../../../services/payments/paystack.client";
import {
  confirmDeposit,
  createDeposit,
  DEPOSIT_DESCRIPTION,
  DepositNotFoundError,
  getDeposit,
} from "../../../services/payments/deposit.service";

// The transaction client handed to prisma.$transaction callbacks
const tx = {
  deposit: { updateMany: jest.fn(), update: jest.fn() },
  wallet: { findUnique: jest.fn(), update: jest.fn() },
  transaction: { create: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    deposit: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../../config/env", () => ({
  env: { PAYSTACK_CALLBACK_URL: "http://localhost:5173/deposit/callback" },
}));

jest.mock("../../../utils/lock.utils", () => ({
  withLock: jest.fn((_userId: string, fn: () => Promise<unknown>) => fn()),
}));
jest.mock("../../../utils/cache.utils", () => ({ invalidateBalance: jest.fn() }));
jest.mock("../../../queues/transaction.queue", () => ({ enqueueTransactionEvent: jest.fn() }));
jest.mock("../../../utils/idempotency.utils", () => ({
  getIdempotencyRecord: jest.fn(),
  saveIdempotencyRecord: jest.fn(),
}));
jest.mock("../../../services/payments/paystack.client", () => ({
  ...jest.requireActual("../../../services/payments/paystack.client"),
  initializeTransaction: jest.fn(),
  verifyTransaction: jest.fn(),
}));

const d = (value: number | string) => new Prisma.Decimal(value);

const deposit = (overrides: Record<string, unknown> = {}) => ({
  id: "dep-id",
  userId: "user-1",
  reference: "dep_ref",
  amount: d("5000.00"),
  currency: "NGN",
  status: DepositStatus.PENDING,
  authorizationUrl: "https://checkout.paystack.com/x",
  accessCode: "x",
  channel: null,
  paidAt: null,
  failureReason: null,
  transactionId: null,
  createdAt: new Date("2026-10-09T10:00:00Z"),
  updatedAt: new Date("2026-10-09T10:00:00Z"),
  ...overrides,
});

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  status: "success",
  reference: "dep_ref",
  amount: 500000,
  currency: "NGN",
  channel: "card",
  paid_at: "2026-10-09T10:01:00Z",
  gateway_response: "Successful",
  ...overrides,
});

describe("deposit.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
  });

  // ── createDeposit ─────────────────────────────────────────────────────────

  describe("createDeposit", () => {
    beforeEach(() => {
      (getIdempotencyRecord as jest.Mock).mockResolvedValue(null);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: "ada@example.com" });
      (prisma.deposit.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve(deposit({ reference: data.reference, amount: d(data.amount), authorizationUrl: null }))
      );
    });

    it("records a pending deposit and asks Paystack for a checkout link in kobo", async () => {
      (initializeTransaction as jest.Mock).mockResolvedValue({
        authorization_url: "https://checkout.paystack.com/abc",
        access_code: "abc",
      });
      (prisma.deposit.update as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve(deposit({ authorizationUrl: data.authorizationUrl, accessCode: data.accessCode }))
      );

      const view = await createDeposit("user-1", 5000, "key-1");

      const created = (prisma.deposit.create as jest.Mock).mock.calls[0][0].data;
      expect(created).toMatchObject({ userId: "user-1", amount: 5000, currency: "NGN" });
      expect(created.reference).toMatch(/^dep_[0-9a-f]{24}$/);
      expect(initializeTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "ada@example.com",
          amount: 500000,
          currency: "NGN",
          reference: created.reference,
          callbackUrl: "http://localhost:5173/deposit/callback",
        })
      );
      expect(view.status).toBe(DepositStatus.PENDING);
      expect(view.authorizationUrl).toBe("https://checkout.paystack.com/abc");
      expect(saveIdempotencyRecord).toHaveBeenCalledWith("deposit:key-1", "user-1", view);
    });

    it("returns the stored result for a repeated idempotency key without calling Paystack", async () => {
      (getIdempotencyRecord as jest.Mock).mockResolvedValue({ response: { reference: "dep_prev" } });

      const view = await createDeposit("user-1", 5000, "key-1");

      expect(view).toEqual({ reference: "dep_prev" });
      expect(prisma.deposit.create).not.toHaveBeenCalled();
      expect(initializeTransaction).not.toHaveBeenCalled();
    });

    it("marks the deposit failed and rethrows when Paystack rejects the request", async () => {
      (initializeTransaction as jest.Mock).mockRejectedValue(new Error("Invalid key"));

      await expect(createDeposit("user-1", 5000)).rejects.toThrow("Invalid key");

      expect(prisma.deposit.update).toHaveBeenCalledWith({
        where: { id: "dep-id" },
        data: { status: DepositStatus.FAILED, failureReason: "Invalid key" },
      });
    });
  });

  // ── confirmDeposit ────────────────────────────────────────────────────────

  describe("confirmDeposit", () => {
    beforeEach(() => {
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue(deposit());
      (prisma.deposit.findUniqueOrThrow as jest.Mock).mockResolvedValue(deposit({ status: DepositStatus.SUCCESSFUL }));
      tx.wallet.findUnique.mockResolvedValue({ userId: "user-1", balance: d(100) });
      tx.transaction.create.mockResolvedValue({
        id: "ledger-1",
        amount: d(5000),
        reference: "ledger-ref",
        timestamp: new Date("2026-10-09T10:01:00Z"),
      });
    });

    it("credits the wallet once Paystack confirms a matching payment", async () => {
      (verifyTransaction as jest.Mock).mockResolvedValue(payment());
      tx.deposit.updateMany.mockResolvedValue({ count: 1 });

      await confirmDeposit("dep_ref");

      expect(tx.deposit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "dep-id", status: DepositStatus.PENDING } })
      );
      expect(tx.wallet.update).toHaveBeenCalledWith({ where: { userId: "user-1" }, data: { balance: d(5100) } });
      expect(tx.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESSFUL,
          amount: d("5000.00"),
          description: DEPOSIT_DESCRIPTION,
        }),
      });
      expect(tx.deposit.update).toHaveBeenCalledWith({ where: { id: "dep-id" }, data: { transactionId: "ledger-1" } });
      expect(invalidateBalance).toHaveBeenCalledWith("user-1");
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "CREDIT", transactionId: "ledger-1" }),
        "ledger-1"
      );
    });

    it("does not credit again when another confirmation already claimed the deposit", async () => {
      (verifyTransaction as jest.Mock).mockResolvedValue(payment());
      tx.deposit.updateMany.mockResolvedValue({ count: 0 });

      await confirmDeposit("dep_ref");

      expect(tx.wallet.update).not.toHaveBeenCalled();
      expect(tx.transaction.create).not.toHaveBeenCalled();
      expect(invalidateBalance).not.toHaveBeenCalled();
    });

    it.each([
      ["amount", { amount: 400000 }],
      ["currency", { currency: "USD" }],
      ["reference", { reference: "someone_else" }],
    ])("refuses to credit when the %s does not match", async (_field, mismatch) => {
      (verifyTransaction as jest.Mock).mockResolvedValue(payment(mismatch));

      await confirmDeposit("dep_ref");

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.deposit.updateMany).toHaveBeenCalledWith({
        where: { id: "dep-id", status: DepositStatus.PENDING },
        data: { status: DepositStatus.FAILED, failureReason: "Payment details did not match the deposit" },
      });
    });

    it("marks a failed payment as failed with Paystack's reason", async () => {
      (verifyTransaction as jest.Mock).mockResolvedValue(payment({ status: "failed", gateway_response: "Declined" }));

      await confirmDeposit("dep_ref");

      expect(prisma.deposit.updateMany).toHaveBeenCalledWith({
        where: { id: "dep-id", status: DepositStatus.PENDING },
        data: { status: DepositStatus.FAILED, failureReason: "Declined" },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("leaves an abandoned (unfinished) payment pending", async () => {
      (verifyTransaction as jest.Mock).mockResolvedValue(payment({ status: "abandoned" }));

      await confirmDeposit("dep_ref");

      expect(prisma.deposit.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("does not call Paystack for a deposit that is already settled", async () => {
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue(deposit({ status: DepositStatus.SUCCESSFUL }));

      await confirmDeposit("dep_ref");

      expect(verifyTransaction).not.toHaveBeenCalled();
    });

    it("throws DepositNotFoundError for an unknown reference", async () => {
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(confirmDeposit("nope")).rejects.toBeInstanceOf(DepositNotFoundError);
    });
  });

  // ── getDeposit ────────────────────────────────────────────────────────────

  describe("getDeposit", () => {
    it("only returns the caller's own deposits", async () => {
      (prisma.deposit.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(getDeposit("user-2", "dep_ref")).rejects.toBeInstanceOf(DepositNotFoundError);
      expect(prisma.deposit.findFirst).toHaveBeenCalledWith({ where: { reference: "dep_ref", userId: "user-2" } });
    });

    it("returns a settled deposit without calling Paystack", async () => {
      (prisma.deposit.findFirst as jest.Mock).mockResolvedValue(deposit({ status: DepositStatus.SUCCESSFUL }));

      const view = await getDeposit("user-1", "dep_ref");

      expect(view.status).toBe(DepositStatus.SUCCESSFUL);
      expect(view.amount).toBe("5000.00");
      expect(verifyTransaction).not.toHaveBeenCalled();
    });

    it("reports a pending deposit as pending if Paystack cannot be reached", async () => {
      (prisma.deposit.findFirst as jest.Mock).mockResolvedValue(deposit());
      (prisma.deposit.findUnique as jest.Mock).mockResolvedValue(deposit());
      (verifyTransaction as jest.Mock).mockRejectedValue(new Error("Could not reach Paystack"));

      const view = await getDeposit("user-1", "dep_ref");

      expect(view.status).toBe(DepositStatus.PENDING);
    });
  });
});
