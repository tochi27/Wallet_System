import { Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../../config/db";
import { withLock, withMultiLock } from "../../../utils/lock.utils";
import { invalidateBalance } from "../../../utils/cache.utils";
import { enqueueTransactionEvent } from "../../../queues/transaction.queue";
import { reverseTransaction } from "../../../services/reversal.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    transaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../../utils/lock.utils", () => ({
  withLock: jest.fn(),
  withMultiLock: jest.fn(),
}));

jest.mock("../../../utils/cache.utils", () => ({
  invalidateBalance: jest.fn(),
}));

jest.mock("../../../queues/transaction.queue", () => ({
  enqueueTransactionEvent: jest.fn(),
}));

const mockTxClient = {
  wallet: { findUnique: jest.fn(), update: jest.fn() },
  transaction: { update: jest.fn() },
};

const makeOriginal = (overrides: object = {}) => ({
  id: "orig-001",
  userId: "user-001",
  type: TransactionType.CREDIT,
  status: TransactionStatus.SUCCESSFUL,
  amount: new Prisma.Decimal(100),
  balanceBefore: new Prisma.Decimal(0),
  balanceAfter: new Prisma.Decimal(100),
  reference: "ref-orig",
  timestamp: new Date(),
  transferId: null,
  reversalOf: null,
  description: null,
  ...overrides,
});

describe("reversal.service — unit", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (withLock as jest.Mock).mockImplementation(
      (_id: string, fn: () => Promise<unknown>) => fn()
    );
    (withMultiLock as jest.Mock).mockImplementation(
      (_ids: string[], fn: () => Promise<unknown>) => fn()
    );
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: typeof mockTxClient) => unknown) => fn(mockTxClient)
    );
  });

  // ── Guard checks ──────────────────────────────────────────────────────────

  describe("guard errors", () => {
    it("throws Transaction not found when record does not exist", async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(reverseTransaction("tx-001", "user-001")).rejects.toThrow(
        "Transaction not found"
      );
    });

    it("throws Transaction not found when userId does not match", async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(
        makeOriginal({ userId: "other-user" })
      );

      await expect(reverseTransaction("tx-001", "user-001")).rejects.toThrow(
        "Transaction not found"
      );
    });

    it("throws Cannot reverse a reversal", async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(
        makeOriginal({ reversalOf: "some-other-id" })
      );

      await expect(reverseTransaction("tx-001", "user-001")).rejects.toThrow(
        "Cannot reverse a reversal"
      );
    });

    it("throws Cannot reverse a pending transaction", async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(
        makeOriginal({ status: TransactionStatus.PENDING })
      );

      await expect(reverseTransaction("tx-001", "user-001")).rejects.toThrow(
        "Cannot reverse a pending transaction"
      );
    });

    it("throws Transaction has already been reversed", async () => {
      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(makeOriginal());
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({
        id: "existing-rev",
      });

      await expect(reverseTransaction("orig-001", "user-001")).rejects.toThrow(
        "Transaction has already been reversed"
      );
    });
  });

  // ── Single reversal ───────────────────────────────────────────────────────

  describe("reverseSingle — CREDIT original", () => {
    it("creates DEBIT reversal and returns updated transaction", async () => {
      const original = makeOriginal({ type: TransactionType.CREDIT });
      const pending = makeOriginal({
        id: "rev-001",
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });
      const result = makeOriginal({ id: "rev-001", type: TransactionType.DEBIT });

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(original);
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "user-001",
        balance: new Prisma.Decimal(100),
      });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      const res = await reverseTransaction("orig-001", "user-001");

      expect(res).toBe(result);
      expect(invalidateBalance).toHaveBeenCalledWith("user-001");
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "REVERSAL", userId: "user-001" }),
        result.id
      );
    });

    it("throws Insufficient funds to reverse and marks pending FAILED", async () => {
      const original = makeOriginal({
        type: TransactionType.CREDIT,
        amount: new Prisma.Decimal(200),
      });
      const pending = makeOriginal({
        id: "rev-001",
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(original);
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "user-001",
        balance: new Prisma.Decimal(50),
      });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});

      await expect(reverseTransaction("orig-001", "user-001")).rejects.toThrow(
        "Insufficient funds to reverse this transaction"
      );
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TransactionStatus.FAILED } })
      );
    });
  });

  describe("reverseSingle — DEBIT original", () => {
    it("creates CREDIT reversal for a DEBIT original", async () => {
      const original = makeOriginal({
        type: TransactionType.DEBIT,
        balanceBefore: new Prisma.Decimal(200),
        balanceAfter: new Prisma.Decimal(100),
      });
      const pending = makeOriginal({
        id: "rev-001",
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
      });
      const result = makeOriginal({ id: "rev-001", type: TransactionType.CREDIT });

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(original);
      (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "user-001",
        balance: new Prisma.Decimal(100),
      });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      const res = await reverseTransaction("orig-001", "user-001");
      expect(res).toBe(result);
    });
  });

  // ── Transfer reversal ─────────────────────────────────────────────────────

  describe("reverseTransfer", () => {
    it("reverses both sides of a transfer atomically", async () => {
      const senderOriginal = makeOriginal({
        type: TransactionType.DEBIT,
        transferId: "transfer-001",
      });
      const receiverOriginal = makeOriginal({
        id: "orig-002",
        userId: "receiver-001",
        type: TransactionType.CREDIT,
        transferId: "transfer-001",
      });
      const senderPending = makeOriginal({
        id: "rev-s",
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
      });
      const receiverPending = makeOriginal({
        id: "rev-r",
        userId: "receiver-001",
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });
      const senderResult = makeOriginal({ id: "rev-s", type: TransactionType.CREDIT });
      const receiverResult = makeOriginal({
        id: "rev-r",
        userId: "receiver-001",
        type: TransactionType.DEBIT,
      });

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(senderOriginal);
      (prisma.transaction.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // no existing reversal
        .mockResolvedValueOnce(receiverOriginal); // paired transfer tx
      (prisma.transaction.create as jest.Mock)
        .mockResolvedValueOnce(senderPending)
        .mockResolvedValueOnce(receiverPending);

      mockTxClient.wallet.findUnique
        .mockResolvedValueOnce({ userId: "user-001", balance: new Prisma.Decimal(0) })
        .mockResolvedValueOnce({
          userId: "receiver-001",
          balance: new Prisma.Decimal(100),
        });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update
        .mockResolvedValueOnce({}) // senderOriginal → REVERSED
        .mockResolvedValueOnce({}) // receiverOriginal → REVERSED
        .mockResolvedValueOnce(senderResult) // senderPending → SUCCESSFUL
        .mockResolvedValueOnce(receiverResult); // receiverPending → SUCCESSFUL

      const res = await reverseTransaction("orig-001", "user-001");

      expect(res).toEqual({ sender: senderResult, receiver: receiverResult });
      expect(invalidateBalance).toHaveBeenCalledWith("user-001");
      expect(invalidateBalance).toHaveBeenCalledWith("receiver-001");
    });

    it("throws when paired transfer transaction is not found", async () => {
      const senderOriginal = makeOriginal({
        type: TransactionType.DEBIT,
        transferId: "transfer-001",
      });

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(senderOriginal);
      (prisma.transaction.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // no existing reversal
        .mockResolvedValueOnce(null); // no paired tx

      await expect(reverseTransaction("orig-001", "user-001")).rejects.toThrow(
        "Paired transfer transaction not found"
      );
    });

    it("throws when receiver has insufficient funds for reversal", async () => {
      const senderOriginal = makeOriginal({
        type: TransactionType.DEBIT,
        transferId: "transfer-001",
        amount: new Prisma.Decimal(200),
      });
      const receiverOriginal = makeOriginal({
        id: "orig-002",
        userId: "receiver-001",
        type: TransactionType.CREDIT,
        transferId: "transfer-001",
        amount: new Prisma.Decimal(200),
      });
      const senderPending = makeOriginal({
        id: "rev-s",
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
      });
      const receiverPending = makeOriginal({
        id: "rev-r",
        userId: "receiver-001",
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });

      (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(senderOriginal);
      (prisma.transaction.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(receiverOriginal);
      (prisma.transaction.create as jest.Mock)
        .mockResolvedValueOnce(senderPending)
        .mockResolvedValueOnce(receiverPending);

      mockTxClient.wallet.findUnique
        .mockResolvedValueOnce({ userId: "user-001", balance: new Prisma.Decimal(0) })
        .mockResolvedValueOnce({
          userId: "receiver-001",
          balance: new Prisma.Decimal(50), // less than 200
        });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});

      await expect(reverseTransaction("orig-001", "user-001")).rejects.toThrow(
        "Receiver has insufficient funds for reversal"
      );
    });
  });
});
