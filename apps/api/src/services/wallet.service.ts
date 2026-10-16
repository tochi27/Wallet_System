import { JournalEntryType, TransactionType, TransactionStatus, Prisma, Transaction } from "@prisma/client";
import prisma from "../config/db";
import { withLock } from "../utils/lock.utils";
import { post, SYSTEM_ACCOUNTS } from "./ledger/ledger.service";
import { invalidateBalance } from "../utils/cache.utils";
import { enqueueTransactionEvent } from "../queues/transaction.queue";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../utils/idempotency.utils";

export const creditWallet = async (
  userId: string,
  amount: number,
  description?: string,
  idempotencyKey?: string
): Promise<Transaction> => {
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyKey, userId);
    if (existing) return existing.response as unknown as Transaction;
  }

  const pending = await prisma.transaction.create({
    data: {
      userId,
      type: TransactionType.CREDIT,
      status: TransactionStatus.PENDING,
      amount,
      description,
    },
  });

  try {
    const result = await withLock(userId, async () => {
      const txResult = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new Error("Wallet not found");

        const balanceBefore = wallet.balance;
        const balanceAfter = new Prisma.Decimal(balanceBefore).add(amount);

        await tx.wallet.update({
          where: { userId },
          data: { balance: balanceAfter },
        });

        const credited = await tx.transaction.update({
          where: { id: pending.id },
          data: {
            status: TransactionStatus.SUCCESSFUL,
            balanceBefore,
            balanceAfter,
          },
        });
        // Development-only money: it comes from the dev funding account, never from a real payment
        await post(tx, {
          type: JournalEntryType.DIRECT_FUNDING,
          description: "Direct credit (development)",
          amount,
          debit: SYSTEM_ACCOUNTS.DEV_FUNDING,
          credit: { wallet: userId },
          transactionId: credited.id,
        });
        return credited;
      });

      await invalidateBalance(userId);
      await enqueueTransactionEvent(
        { event: "CREDIT", userId, transactionId: txResult.id, amount: txResult.amount.toString(), reference: txResult.reference, timestamp: txResult.timestamp.toISOString() },
        txResult.id
      );
      return txResult;
    });

    if (idempotencyKey) {
      await saveIdempotencyRecord(idempotencyKey, userId, result);
    }

    return result;
  } catch (error) {
    await prisma.transaction.update({
      where: { id: pending.id },
      data: { status: TransactionStatus.FAILED },
    });
    throw error;
  }
};

export const debitWallet = async (
  userId: string,
  amount: number,
  description?: string,
  idempotencyKey?: string
): Promise<Transaction> => {
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyKey, userId);
    if (existing) return existing.response as unknown as Transaction;
  }

  const pending = await prisma.transaction.create({
    data: {
      userId,
      type: TransactionType.DEBIT,
      status: TransactionStatus.PENDING,
      amount,
      description,
    },
  });

  try {
    const result = await withLock(userId, async () => {
      const txResult = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new Error("Wallet not found");

        const balanceBefore = wallet.balance;

        if (new Prisma.Decimal(balanceBefore).lt(amount)) {
          throw new Error("Insufficient funds");
        }

        const balanceAfter = new Prisma.Decimal(balanceBefore).sub(amount);

        await tx.wallet.update({
          where: { userId },
          data: { balance: balanceAfter },
        });

        const debited = await tx.transaction.update({
          where: { id: pending.id },
          data: {
            status: TransactionStatus.SUCCESSFUL,
            balanceBefore,
            balanceAfter,
          },
        });
        await post(tx, {
          type: JournalEntryType.DIRECT_FUNDING,
          description: "Direct debit (development)",
          amount,
          debit: { wallet: userId },
          credit: SYSTEM_ACCOUNTS.DEV_FUNDING,
          transactionId: debited.id,
        });
        return debited;
      });

      await invalidateBalance(userId);
      await enqueueTransactionEvent(
        { event: "DEBIT", userId, transactionId: txResult.id, amount: txResult.amount.toString(), reference: txResult.reference, timestamp: txResult.timestamp.toISOString() },
        txResult.id
      );
      return txResult;
    });

    if (idempotencyKey) {
      await saveIdempotencyRecord(idempotencyKey, userId, result);
    }

    return result;
  } catch (error) {
    await prisma.transaction.update({
      where: { id: pending.id },
      data: { status: TransactionStatus.FAILED },
    });
    throw error;
  }
};

export const getBalance = async (userId: string) => {
  return prisma.wallet.findUnique({ where: { userId } });
};

// A reversal marks the original REVERSED and records an opposite SUCCESSFUL entry, so both
// statuses must be counted for a reversed transaction to net to zero against the stored balance.
const BALANCE_STATUSES = [TransactionStatus.SUCCESSFUL, TransactionStatus.REVERSED];

/**
 * The balance the transaction history adds up to. A wallet that already held money when the
 * ledger started begins from its opening balance and counts only transactions since then, so gaps
 * in older history (which the opening balance already covers) don't show up as mismatches. Any
 * other wallet counts its whole history.
 */
export const computeBalance = async (userId: string): Promise<Prisma.Decimal> => {
  const opening = await prisma.ledgerLine.findFirst({
    where: { account: { userId }, entry: { type: JournalEntryType.OPENING_BALANCE } },
    select: { amount: true, entry: { select: { createdAt: true } } },
  });
  const since = opening ? { timestamp: { gt: opening.entry.createdAt } } : {};

  const [credits, debits] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, type: TransactionType.CREDIT, status: { in: BALANCE_STATUSES }, ...since },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, type: TransactionType.DEBIT, status: { in: BALANCE_STATUSES }, ...since },
      _sum: { amount: true },
    }),
  ]);

  // A wallet's line is a credit (negative): the opening balance is what we owed the user
  const openingBalance = opening ? new Prisma.Decimal(opening.amount).neg() : new Prisma.Decimal(0);
  const totalCredits = credits._sum.amount ?? new Prisma.Decimal(0);
  const totalDebits = debits._sum.amount ?? new Prisma.Decimal(0);
  return openingBalance.add(totalCredits).sub(totalDebits);
};

export const getTransactions = async (
  userId: string,
  limit: number = 20,
  cursor?: string
) => {
  const txs = await prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasNextPage = txs.length > limit;
  const items = hasNextPage ? txs.slice(0, limit) : txs;
  const nextCursor = hasNextPage ? items[items.length - 1].id : null;

  return { items, nextCursor };
};
