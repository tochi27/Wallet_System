import { Prisma, TransactionStatus, TransactionType } from "@prisma/client";
import prisma from "../../../config/db";
import { withLock } from "../../../utils/lock.utils";
import { invalidateBalance } from "../../../utils/cache.utils";
import { enqueueTransactionEvent } from "../../../queues/transaction.queue";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../../../utils/idempotency.utils";
import {
  creditWallet,
  debitWallet,
  getBalance,
  computeBalance,
  getTransactions,
} from "../../../services/wallet.service";

jest.mock("../../../config/db", () => ({
  __esModule: true,
  default: {
    transaction: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    wallet: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("../../../utils/lock.utils", () => ({
  withLock: jest.fn(),
  withMultiLock: jest.fn(),
}));

jest.mock("../../../utils/cache.utils", () => ({
  getCachedBalance: jest.fn(),
  setCachedBalance: jest.fn(),
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
  userId: "user-001",
  type: TransactionType.CREDIT,
  status: TransactionStatus.SUCCESSFUL,
  amount: new Prisma.Decimal(100),
  balanceBefore: new Prisma.Decimal(0),
  balanceAfter: new Prisma.Decimal(100),
  description: null,
  reference: "ref-001",
  timestamp: new Date(),
  transferId: null,
  reversalOf: null,
  ...overrides,
});

describe("wallet.service — unit", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (withLock as jest.Mock).mockImplementation(
      (_id: string, fn: () => Promise<unknown>) => fn()
    );
    (prisma.$transaction as jest.Mock).mockImplementation(
      (fn: (tx: typeof mockTxClient) => unknown) => fn(mockTxClient)
    );
  });

  // ── creditWallet ──────────────────────────────────────────────────────────

  describe("creditWallet", () => {
    it("credits wallet and returns updated transaction", async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const result = makeTx();

      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "user-001",
        balance: new Prisma.Decimal(0),
      });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      const res = await creditWallet("user-001", 100);

      expect(res).toBe(result);
      expect(prisma.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: TransactionType.CREDIT,
            status: TransactionStatus.PENDING,
          }),
        })
      );
      expect(invalidateBalance).toHaveBeenCalledWith("user-001");
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "CREDIT", userId: "user-001" }),
        result.id
      );
    });

    it("marks transaction FAILED and rethrows when wallet not found", async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue(null);
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});

      await expect(creditWallet("user-001", 100)).rejects.toThrow("Wallet not found");
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: pending.id },
          data: { status: TransactionStatus.FAILED },
        })
      );
    });

    it("returns cached response immediately when idempotency key already exists", async () => {
      const cached = makeTx();
      (getIdempotencyRecord as jest.Mock).mockResolvedValue({ response: cached });

      const res = await creditWallet("user-001", 100, undefined, "key-abc");

      expect(res).toBe(cached);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it("saves idempotency record after successful credit", async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const result = makeTx();

      (getIdempotencyRecord as jest.Mock).mockResolvedValue(null);
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({ userId: "user-001", balance: new Prisma.Decimal(0) });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      await creditWallet("user-001", 100, undefined, "key-abc");

      expect(saveIdempotencyRecord).toHaveBeenCalledWith("key-abc", "user-001", result);
    });

    it("does not save idempotency record when no key is provided", async () => {
      const pending = makeTx({ status: TransactionStatus.PENDING });
      const result = makeTx();

      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({ userId: "user-001", balance: new Prisma.Decimal(0) });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      await creditWallet("user-001", 100);

      expect(saveIdempotencyRecord).not.toHaveBeenCalled();
    });
  });

  // ── debitWallet ───────────────────────────────────────────────────────────

  describe("debitWallet", () => {
    it("debits wallet and returns updated transaction", async () => {
      const pending = makeTx({
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });
      const result = makeTx({
        type: TransactionType.DEBIT,
        balanceBefore: new Prisma.Decimal(200),
        balanceAfter: new Prisma.Decimal(150),
      });

      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "user-001",
        balance: new Prisma.Decimal(200),
      });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      const res = await debitWallet("user-001", 50);

      expect(res).toBe(result);
      expect(invalidateBalance).toHaveBeenCalledWith("user-001");
      expect(enqueueTransactionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "DEBIT" }),
        result.id
      );
    });

    it("throws Insufficient funds and marks FAILED", async () => {
      const pending = makeTx({
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({
        userId: "user-001",
        balance: new Prisma.Decimal(50),
      });
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});

      await expect(debitWallet("user-001", 200)).rejects.toThrow("Insufficient funds");
      expect(prisma.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TransactionStatus.FAILED } })
      );
    });

    it("throws Wallet not found and marks FAILED", async () => {
      const pending = makeTx({
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
      });
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue(null);
      (prisma.transaction.update as jest.Mock).mockResolvedValue({});

      await expect(debitWallet("user-001", 100)).rejects.toThrow("Wallet not found");
    });

    it("returns cached response immediately when idempotency key already exists", async () => {
      const cached = makeTx({ type: TransactionType.DEBIT });
      (getIdempotencyRecord as jest.Mock).mockResolvedValue({ response: cached });

      const res = await debitWallet("user-001", 50, undefined, "key-xyz");

      expect(res).toBe(cached);
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it("saves idempotency record after successful debit", async () => {
      const pending = makeTx({ type: TransactionType.DEBIT, status: TransactionStatus.PENDING });
      const result = makeTx({ type: TransactionType.DEBIT, balanceBefore: new Prisma.Decimal(200), balanceAfter: new Prisma.Decimal(150) });

      (getIdempotencyRecord as jest.Mock).mockResolvedValue(null);
      (prisma.transaction.create as jest.Mock).mockResolvedValue(pending);
      mockTxClient.wallet.findUnique.mockResolvedValue({ userId: "user-001", balance: new Prisma.Decimal(200) });
      mockTxClient.wallet.update.mockResolvedValue({});
      mockTxClient.transaction.update.mockResolvedValue(result);

      await debitWallet("user-001", 50, undefined, "key-xyz");

      expect(saveIdempotencyRecord).toHaveBeenCalledWith("key-xyz", "user-001", result);
    });
  });

  // ── getBalance ────────────────────────────────────────────────────────────

  describe("getBalance", () => {
    it("returns wallet record for user", async () => {
      const wallet = { userId: "user-001", balance: new Prisma.Decimal(300) };
      (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(wallet);

      const res = await getBalance("user-001");

      expect(res).toEqual(wallet);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId: "user-001" },
      });
    });
  });

  // ── computeBalance ────────────────────────────────────────────────────────

  describe("computeBalance", () => {
    it("computes credits minus debits", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(500) } })
        .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(200) } });

      const balance = await computeBalance("user-001");
      expect(balance.toString()).toBe("300");
    });

    it("returns 0 when both sums are null", async () => {
      (prisma.transaction.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });

      const balance = await computeBalance("user-001");
      expect(balance.toString()).toBe("0");
    });
  });

  // ── getTransactions ───────────────────────────────────────────────────────

  describe("getTransactions", () => {
    it("returns items and null nextCursor when results fit within limit", async () => {
      const txs = [makeTx({ id: "tx-1" }), makeTx({ id: "tx-2" })];
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue(txs);

      const res = await getTransactions("user-001", 20);

      expect(res.items).toEqual(txs);
      expect(res.nextCursor).toBeNull();
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-001" },
          take: 21,
          orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        })
      );
    });

    it("returns nextCursor and trims items when there is a next page", async () => {
      // Return limit+1 items to signal more pages exist
      const txs = Array.from({ length: 6 }, (_, i) => makeTx({ id: `tx-${i}` }));
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue(txs);

      const res = await getTransactions("user-001", 5);

      expect(res.items).toHaveLength(5);
      expect(res.nextCursor).toBe("tx-4");
    });

    it("passes cursor and skip:1 when a cursor is provided", async () => {
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);

      await getTransactions("user-001", 20, "cursor-id-abc");

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: "cursor-id-abc" },
          skip: 1,
        })
      );
    });

    it("omits cursor and skip when no cursor is provided", async () => {
      (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);

      await getTransactions("user-001", 20);

      const call = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0];
      expect(call.cursor).toBeUndefined();
      expect(call.skip).toBeUndefined();
    });
  });
});
