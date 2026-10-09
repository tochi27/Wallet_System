import { Prisma, TransactionStatus, TransactionType, WithdrawalStatus } from "@prisma/client";
import prisma from "../../../config/db";
import { scheduleWithdrawalCheck } from "../../../queues/payments.queue";
import { enqueueTransactionEvent } from "../../../queues/transaction.queue";
import { invalidateBalance } from "../../../utils/cache.utils";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../../../utils/idempotency.utils";
import { getActiveBankAccount } from "../../../services/payments/bank-account.service";
import { initiateTransfer, PaystackError, verifyTransfer } from "../../../services/payments/paystack.client";
import {
  confirmWithdrawal,
  createWithdrawal,
  InsufficientFundsError,
  WithdrawalNotFoundError,
} from "../../../services/payments/withdrawal.service";

const tx = {
  wallet: { findUnique: jest.fn(), update: jest.fn() },
  transaction: { create: jest.fn(), update: jest.fn() },
  withdrawal: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
};

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    withdrawal: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../../utils/lock.utils", () => ({
  withLock: jest.fn((_userId: string, fn: () => Promise<unknown>) => fn()),
}));
jest.mock("../../../utils/cache.utils", () => ({ invalidateBalance: jest.fn() }));
jest.mock("../../../queues/transaction.queue", () => ({ enqueueTransactionEvent: jest.fn() }));
jest.mock("../../../queues/payments.queue", () => ({ scheduleWithdrawalCheck: jest.fn() }));
jest.mock("../../../utils/idempotency.utils", () => ({
  getIdempotencyRecord: jest.fn(),
  saveIdempotencyRecord: jest.fn(),
}));
jest.mock("../../../services/payments/bank-account.service", () => ({ getActiveBankAccount: jest.fn() }));
jest.mock("../../../services/payments/paystack.client", () => ({
  ...jest.requireActual("../../../services/payments/paystack.client"),
  initiateTransfer: jest.fn(),
  verifyTransfer: jest.fn(),
}));

const d = (value: number | string) => new Prisma.Decimal(value);

const account = {
  id: "acct-1",
  userId: "user-1",
  bankCode: "057",
  bankName: "Zenith Bank",
  accountNumberLast4: "1234",
  accountName: "ADA LOVELACE",
  recipientCode: "RCP_1",
  isActive: true,
  createdAt: new Date(),
};

const withdrawal = (overrides: Record<string, unknown> = {}) => ({
  id: "wd-id",
  userId: "user-1",
  bankAccountId: "acct-1",
  reference: "wd_ref",
  amount: d("1000.00"),
  currency: "NGN",
  status: WithdrawalStatus.PROCESSING,
  transferCode: null,
  failureReason: null,
  debitTransactionId: "debit-1",
  refundTransactionId: null,
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const ledger = (id: string, amount = 1000) => ({
  id,
  amount: d(amount),
  reference: `${id}-ref`,
  timestamp: new Date("2026-10-09T12:00:00Z"),
});

describe("withdrawal.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation((fn: (client: typeof tx) => unknown) => fn(tx));
    (prisma.withdrawal.findUniqueOrThrow as jest.Mock).mockImplementation(({ include }) =>
      Promise.resolve(include ? { ...withdrawal(), bankAccount: account } : withdrawal())
    );
    tx.wallet.findUnique.mockResolvedValue({ userId: "user-1", balance: d(5000) });
  });

  // ── createWithdrawal ──────────────────────────────────────────────────────

  describe("createWithdrawal", () => {
    beforeEach(() => {
      (getIdempotencyRecord as jest.Mock).mockResolvedValue(null);
      (getActiveBankAccount as jest.Mock).mockResolvedValue(account);
      tx.transaction.create.mockResolvedValue(ledger("debit-1"));
      tx.withdrawal.create.mockImplementation(({ data }) => Promise.resolve(withdrawal({ reference: data.reference })));
    });

    it("debits the wallet, records the withdrawal and sends the transfer in kobo", async () => {
      (initiateTransfer as jest.Mock).mockResolvedValue({ status: "pending", transfer_code: "TRF_1", reference: "wd_ref" });

      const view = await createWithdrawal("user-1", "acct-1", 1000, "key-1");

      expect(tx.wallet.update).toHaveBeenCalledWith({ where: { userId: "user-1" }, data: { balance: d(4000) } });
      expect(tx.transaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: TransactionType.DEBIT,
          status: TransactionStatus.SUCCESSFUL,
          amount: 1000,
          description: "Withdrawal to Zenith Bank ••1234",
        }),
      });
      const reference = tx.withdrawal.create.mock.calls[0][0].data.reference;
      expect(reference).toMatch(/^wd_[0-9a-f]{24}$/);
      expect(initiateTransfer).toHaveBeenCalledWith({
        amount: 100000,
        recipient: "RCP_1",
        reference,
        reason: "Wallet withdrawal",
      });
      expect(prisma.withdrawal.update).toHaveBeenCalledWith({ where: { id: "wd-id" }, data: { transferCode: "TRF_1" } });
      expect(scheduleWithdrawalCheck).toHaveBeenCalledWith(reference);
      expect(invalidateBalance).toHaveBeenCalledWith("user-1");
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "DEBIT" }), "debit-1");
      expect(view.status).toBe(WithdrawalStatus.PROCESSING);
      expect(view.bankAccount).toEqual({ bankName: "Zenith Bank", accountNumberLast4: "1234", accountName: "ADA LOVELACE" });
      expect(saveIdempotencyRecord).toHaveBeenCalledWith("withdrawal:key-1", "user-1", view);
    });

    it("refuses when the balance is too low, before touching Paystack", async () => {
      tx.wallet.findUnique.mockResolvedValue({ userId: "user-1", balance: d(500) });

      await expect(createWithdrawal("user-1", "acct-1", 1000)).rejects.toBeInstanceOf(InsufficientFundsError);

      expect(tx.wallet.update).not.toHaveBeenCalled();
      expect(initiateTransfer).not.toHaveBeenCalled();
    });

    it("marks it successful when Paystack completes the transfer immediately", async () => {
      (initiateTransfer as jest.Mock).mockResolvedValue({ status: "success", transfer_code: "TRF_1", reference: "wd_ref" });

      await createWithdrawal("user-1", "acct-1", 1000);

      expect(prisma.withdrawal.updateMany).toHaveBeenCalledWith({
        where: { id: "wd-id", status: WithdrawalStatus.PROCESSING },
        data: { status: WithdrawalStatus.SUCCESSFUL, completedAt: expect.any(Date) },
      });
    });

    it("refunds at once when Paystack rejects the transfer, with a neutral reason for merchant-side problems", async () => {
      (initiateTransfer as jest.Mock).mockRejectedValue(
        new PaystackError("You cannot initiate third party payouts as a starter business", 400)
      );
      tx.withdrawal.updateMany.mockResolvedValue({ count: 1 });
      tx.transaction.create.mockResolvedValueOnce(ledger("debit-1")).mockResolvedValueOnce(ledger("refund-1"));

      await createWithdrawal("user-1", "acct-1", 1000);

      expect(tx.withdrawal.updateMany).toHaveBeenCalledWith({
        where: { id: "wd-id", status: { in: [WithdrawalStatus.PROCESSING] } },
        data: {
          status: WithdrawalStatus.FAILED,
          failureReason: "Withdrawals are temporarily unavailable",
          completedAt: expect.any(Date),
        },
      });
      expect(tx.transaction.update).toHaveBeenCalledWith({
        where: { id: "debit-1" },
        data: { status: TransactionStatus.REVERSED },
      });
      expect(tx.transaction.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
          type: TransactionType.CREDIT,
          amount: d("1000.00"),
          reversalOf: "debit-1",
          description: "Refund: withdrawal failed",
        }),
      });
      expect(scheduleWithdrawalCheck).not.toHaveBeenCalled();
    });

    it("leaves it processing when the outcome is unknown (timeout), for the follow-up check", async () => {
      (initiateTransfer as jest.Mock).mockRejectedValue(new PaystackError("Could not reach Paystack", 0));

      const view = await createWithdrawal("user-1", "acct-1", 1000);

      expect(view.status).toBe(WithdrawalStatus.PROCESSING);
      expect(tx.withdrawal.updateMany).not.toHaveBeenCalled();
      expect(scheduleWithdrawalCheck).toHaveBeenCalled();
    });

    it("returns the stored result for a repeated idempotency key without debiting again", async () => {
      (getIdempotencyRecord as jest.Mock).mockResolvedValue({ response: { reference: "wd_prev" } });

      const view = await createWithdrawal("user-1", "acct-1", 1000, "key-1");

      expect(view).toEqual({ reference: "wd_prev" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(initiateTransfer).not.toHaveBeenCalled();
    });
  });

  // ── confirmWithdrawal ─────────────────────────────────────────────────────

  describe("confirmWithdrawal", () => {
    beforeEach(() => {
      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(withdrawal());
      tx.transaction.create.mockResolvedValue(ledger("refund-1"));
    });

    it("marks a completed transfer as successful", async () => {
      (verifyTransfer as jest.Mock).mockResolvedValue({ status: "success", reason: null });

      await confirmWithdrawal("wd_ref");

      expect(prisma.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: WithdrawalStatus.SUCCESSFUL }) })
      );
    });

    it("refunds a failed transfer exactly once", async () => {
      (verifyTransfer as jest.Mock).mockResolvedValue({ status: "failed", reason: "Account closed" });
      tx.withdrawal.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      await confirmWithdrawal("wd_ref");
      await confirmWithdrawal("wd_ref"); // e.g. the webhook and the follow-up check racing

      expect(tx.wallet.update).toHaveBeenCalledTimes(1);
      expect(tx.wallet.update).toHaveBeenCalledWith({ where: { userId: "user-1" }, data: { balance: d(6000) } });
      expect(tx.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failureReason: "Account closed" }) })
      );
      expect(enqueueTransactionEvent).toHaveBeenCalledTimes(1);
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "REVERSAL", originalId: "debit-1" }),
        "refund-1"
      );
    });

    it("refunds a transfer that Paystack reversed after it had succeeded", async () => {
      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(withdrawal({ status: WithdrawalStatus.SUCCESSFUL }));
      (verifyTransfer as jest.Mock).mockResolvedValue({ status: "reversed", reason: null });
      tx.withdrawal.updateMany.mockResolvedValue({ count: 1 });

      await confirmWithdrawal("wd_ref");

      expect(tx.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "wd-id", status: { in: [WithdrawalStatus.PROCESSING, WithdrawalStatus.SUCCESSFUL] } },
          data: expect.objectContaining({ status: WithdrawalStatus.REVERSED }),
        })
      );
    });

    it("leaves a still-pending transfer alone", async () => {
      (verifyTransfer as jest.Mock).mockResolvedValue({ status: "pending", reason: null });

      await confirmWithdrawal("wd_ref");

      expect(prisma.withdrawal.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("waits before refunding a transfer Paystack has no record of", async () => {
      (verifyTransfer as jest.Mock).mockResolvedValue(null);

      await confirmWithdrawal("wd_ref");
      expect(prisma.$transaction).not.toHaveBeenCalled();

      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(
        withdrawal({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
      );
      tx.withdrawal.updateMany.mockResolvedValue({ count: 1 });

      await confirmWithdrawal("wd_ref");
      expect(tx.withdrawal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ failureReason: "The transfer could not be started" }) })
      );
    });

    it("does nothing for a withdrawal that already failed", async () => {
      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(withdrawal({ status: WithdrawalStatus.FAILED }));

      await confirmWithdrawal("wd_ref");

      expect(verifyTransfer).not.toHaveBeenCalled();
    });

    it("throws for an unknown reference", async () => {
      (prisma.withdrawal.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(confirmWithdrawal("nope")).rejects.toBeInstanceOf(WithdrawalNotFoundError);
    });
  });
});
