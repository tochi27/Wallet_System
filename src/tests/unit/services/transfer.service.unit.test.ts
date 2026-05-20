import { Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../../config/db";
import { withMultiLock } from "../../../utils/lock.utils";
import { invalidateBalance } from "../../../utils/cache.utils";
import { enqueueTransactionEvent } from "../../../queues/transaction.queue";
import {
  getIdempotencyRecord,
  saveIdempotencyRecord,
} from "../../../utils/idempotency.utils";
import { transferFunds } from "../../../services/transfer.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    transaction: { create: jest.fn(), update: jest.fn() },
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

jest.mock("../../../utils/idempotency.utils", () => ({
  getIdempotencyRecord: jest.fn(),
  saveIdempotencyRecord: jest.fn(),
}));

const mockTxClient = {
  wallet: { findUnique: jest.fn(), update: jest.fn() },
  transaction: { update: jest.fn() },
};

const makeTx = (overrides: object = {}) => ({
  id: "tx-001",
  userId: "sender-001",
  type: TransactionType.DEBIT,
  status: TransactionStatus.SUCCESSFUL,
  amount: new Prisma.Decimal(100),
  balanceBefore: new Prisma.Decimal(500),
  balanceAfter: new Prisma.Decimal(400),
  reference: "ref-001",
  timestamp: new Date(),
  transferId: "transfer-001",
  reversalOf: null,
  description: null,
  ...overrides,
});

const mockReceiver = {
  id: "receiver-001",
  email: "receiver@example.com",
  wallet: { userId: "receiver-001", balance: new Prisma.Decimal(0) },
};

describe("transfer.service — unit", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (withMultiLock as jest.Mock).mockImplementation(
      (_ids: string[], fn: () => Promise<unknown>) => fn()
    );
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: typeof mockTxClient) => unknown) => fn(mockTxClient)
    );
    (getIdempotencyRecord as jest.Mock).mockResolvedValue(null);
    (saveIdempotencyRecord as jest.Mock).mockResolvedValue(undefined);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("transfers funds and returns transferId with both transactions", async () => {
      const senderPending = makeTx({ status: TransactionStatus.PENDING });
      const receiverPending = makeTx({
        id: "tx-002",
        userId: "receiver-001",
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
      });
      const senderResult = makeTx();
      const receiverResult = makeTx({
        id: "tx-002",
        userId: "receiver-001",
        type: TransactionType.CREDIT,
        balanceBefore: new Prisma.Decimal(0),
        balanceAfter: new Prisma.Decimal(100),
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockReceiver);
      (prisma.transaction.create as jest.Mock)
        .mockResolvedValueOnce(senderPending)
        .mockResolvedValueOnce(receiverPending);
      mockTxClient.wallet.findUnique
        .mockResolvedValueOnce({ userId: "sender-001", balance: new Prisma.Decimal(500) })
        .mockResolvedValueOnce({ userId: "receiver-001", balance: new Prisma.Decimal(0) });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update
        .mockResolvedValueOnce(senderResult)
        .mockResolvedValueOnce(receiverResult);

      const res = await transferFunds("sender-001", "receiver@example.com", 100);

      expect(res.transferId).toBeTruthy();
      expect(res.sender).toBe(senderResult);
      expect(res.receiver).toBe(receiverResult);
      expect(invalidateBalance).toHaveBeenCalledWith("sender-001");
      expect(invalidateBalance).toHaveBeenCalledWith("receiver-001");
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "TRANSFER", senderId: "sender-001" }),
        expect.any(String)
      );
    });
  });

  // ── Validation errors ─────────────────────────────────────────────────────

  describe("validation errors", () => {
    it("throws Receiver not found", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        transferFunds("sender-001", "ghost@example.com", 100)
      ).rejects.toThrow("Receiver not found");
    });

    it("throws Receiver has no wallet", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "receiver-001",
        wallet: null,
      });

      await expect(
        transferFunds("sender-001", "ghost@example.com", 100)
      ).rejects.toThrow("Receiver has no wallet");
    });

    it("throws Cannot transfer to yourself", async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        ...mockReceiver,
        id: "sender-001",
      });

      await expect(
        transferFunds("sender-001", "sender@example.com", 100)
      ).rejects.toThrow("Cannot transfer to yourself");
    });

    it("throws Insufficient funds and marks both pending transactions FAILED", async () => {
      const senderPending = makeTx({ status: TransactionStatus.PENDING });
      const receiverPending = makeTx({
        id: "tx-002",
        userId: "receiver-001",
        status: TransactionStatus.PENDING,
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockReceiver);
      (prisma.transaction.create as jest.Mock)
        .mockResolvedValueOnce(senderPending)
        .mockResolvedValueOnce(receiverPending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "sender-001",
        balance: new Prisma.Decimal(50),
      });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});

      await expect(
        transferFunds("sender-001", "receiver@example.com", 200)
      ).rejects.toThrow("Insufficient funds");

      expect(prisma.transaction.update).toHaveBeenCalledTimes(2);
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TransactionStatus.FAILED } })
      );
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  describe("idempotency", () => {
    it("returns cached response on duplicate idempotency key", async () => {
      const cached = {
        transferId: "cached-id",
        sender: makeTx(),
        receiver: makeTx({ id: "tx-r" }),
      };
      (getIdempotencyRecord as jest.Mock).mockResolvedValue({ response: cached });

      const res = await transferFunds(
        "sender-001",
        "receiver@example.com",
        100,
        undefined,
        "idem-key-123"
      );

      expect(res).toEqual(cached);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("saves idempotency record after a successful transfer", async () => {
      const senderPending = makeTx({ status: TransactionStatus.PENDING });
      const receiverPending = makeTx({
        id: "tx-002",
        userId: "receiver-001",
        status: TransactionStatus.PENDING,
      });
      const senderResult = makeTx();
      const receiverResult = makeTx({ id: "tx-002", userId: "receiver-001" });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockReceiver);
      (prisma.transaction.create as jest.Mock)
        .mockResolvedValueOnce(senderPending)
        .mockResolvedValueOnce(receiverPending);
      mockTxClient.wallet.findUnique
        .mockResolvedValueOnce({ userId: "sender-001", balance: new Prisma.Decimal(500) })
        .mockResolvedValueOnce({ userId: "receiver-001", balance: new Prisma.Decimal(0) });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update
        .mockResolvedValueOnce(senderResult)
        .mockResolvedValueOnce(receiverResult);

      await transferFunds("sender-001", "receiver@example.com", 100, undefined, "idem-key-456");

      expect(saveIdempotencyRecord).toHaveBeenCalledWith(
        "idem-key-456",
        "sender-001",
        expect.objectContaining({ transferId: expect.any(String) })
      );
    });
  });
});
