import { TransactionType, TransactionStatus, Prisma, Transaction } from "@prisma/client";
import prisma from "../config/db";
import { withLock, withMultiLock } from "../utils/lock.utils";
import { invalidateBalance } from "../utils/cache.utils";
import { enqueueTransactionEvent } from "../queues/transaction.queue";

export const reverseTransaction = async (transactionId: string, userId: string) => {
  const original = await prisma.transaction.findUnique({ where: { id: transactionId } });

  if (!original || original.userId !== userId) {
    throw new Error("Transaction not found");
  }
  if (original.reversalOf) {
    throw new Error("Cannot reverse a reversal");
  }
  if (original.status !== TransactionStatus.SUCCESSFUL) {
    throw new Error(`Cannot reverse a ${original.status.toLowerCase()} transaction`);
  }

  const existingReversal = await prisma.transaction.findFirst({
    where: { reversalOf: transactionId, status: { not: TransactionStatus.FAILED } },
  });
  if (existingReversal) throw new Error("Transaction has already been reversed");

  if (original.transferId) {
    return reverseTransfer(original, userId);
  }

  return reverseSingle(original);
};

// ─── Single transaction reversal ────────────────────────────────────────────

const reverseSingle = async (original: Transaction) => {
  const reversalType =
    original.type === TransactionType.CREDIT
      ? TransactionType.DEBIT
      : TransactionType.CREDIT;

  const pending = await prisma.transaction.create({
    data: {
      userId: original.userId,
      type: reversalType,
      status: TransactionStatus.PENDING,
      amount: original.amount,
      description: `Reversal of ${original.reference}`,
      reversalOf: original.id,
    },
  });

  try {
    return await withLock(original.userId, async () => {
      const result = await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId: original.userId } });
        if (!wallet) throw new Error("Wallet not found");

        const balanceBefore = wallet.balance;
        const balanceAfter =
          reversalType === TransactionType.CREDIT
            ? new Prisma.Decimal(balanceBefore).add(original.amount)
            : new Prisma.Decimal(balanceBefore).sub(original.amount);

        if (
          reversalType === TransactionType.DEBIT &&
          new Prisma.Decimal(balanceBefore).lt(original.amount)
        ) {
          throw new Error("Insufficient funds to reverse this transaction");
        }

        await tx.wallet.update({ where: { userId: original.userId }, data: { balance: balanceAfter } });
        await tx.transaction.update({ where: { id: original.id }, data: { status: TransactionStatus.REVERSED } });

        return tx.transaction.update({
          where: { id: pending.id },
          data: { status: TransactionStatus.SUCCESSFUL, balanceBefore, balanceAfter },
        });
      });

      await invalidateBalance(original.userId);
      await enqueueTransactionEvent(
        {
          event: "REVERSAL",
          userId: original.userId,
          transactionId: result.id,
          originalId: original.id,
          amount: result.amount.toString(),
          reference: result.reference,
          timestamp: result.timestamp.toISOString(),
        },
        result.id
      );
      return result;
    });
  } catch (error) {
    await prisma.transaction.update({ where: { id: pending.id }, data: { status: TransactionStatus.FAILED } });
    throw error;
  }
};

// ─── Transfer reversal (both sides reversed atomically) ──────────────────────

const reverseTransfer = async (senderOriginal: Transaction, senderId: string) => {
  const receiverOriginal = await prisma.transaction.findFirst({
    where: { transferId: senderOriginal.transferId!, type: TransactionType.CREDIT },
  });

  if (!receiverOriginal) throw new Error("Paired transfer transaction not found");
  if (receiverOriginal.status !== TransactionStatus.SUCCESSFUL) {
    throw new Error("Paired transfer transaction is not reversible");
  }

  const [senderPending, receiverPending] = await Promise.all([
    prisma.transaction.create({
      data: {
        userId: senderId,
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
        amount: senderOriginal.amount,
        description: `Reversal of transfer ${senderOriginal.transferId}`,
        reversalOf: senderOriginal.id,
        transferId: senderOriginal.transferId,
      },
    }),
    prisma.transaction.create({
      data: {
        userId: receiverOriginal.userId,
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
        amount: receiverOriginal.amount,
        description: `Reversal of transfer ${receiverOriginal.transferId}`,
        reversalOf: receiverOriginal.id,
        transferId: receiverOriginal.transferId,
      },
    }),
  ]);

  try {
    return await withMultiLock([senderId, receiverOriginal.userId], async () => {
      const result = await prisma.$transaction(async (tx) => {
        const [senderWallet, receiverWallet] = await Promise.all([
          tx.wallet.findUnique({ where: { userId: senderId } }),
          tx.wallet.findUnique({ where: { userId: receiverOriginal.userId } }),
        ]);

        if (!senderWallet || !receiverWallet) throw new Error("Wallet not found");

        if (new Prisma.Decimal(receiverWallet.balance).lt(receiverOriginal.amount)) {
          throw new Error("Receiver has insufficient funds for reversal");
        }

        const senderBefore = senderWallet.balance;
        const senderAfter = new Prisma.Decimal(senderBefore).add(senderOriginal.amount);
        const receiverBefore = receiverWallet.balance;
        const receiverAfter = new Prisma.Decimal(receiverBefore).sub(receiverOriginal.amount);

        await Promise.all([
          tx.wallet.update({ where: { userId: senderId }, data: { balance: senderAfter } }),
          tx.wallet.update({ where: { userId: receiverOriginal.userId }, data: { balance: receiverAfter } }),
          tx.transaction.update({ where: { id: senderOriginal.id }, data: { status: TransactionStatus.REVERSED } }),
          tx.transaction.update({ where: { id: receiverOriginal.id }, data: { status: TransactionStatus.REVERSED } }),
        ]);

        const [senderTx, receiverTx] = await Promise.all([
          tx.transaction.update({
            where: { id: senderPending.id },
            data: { status: TransactionStatus.SUCCESSFUL, balanceBefore: senderBefore, balanceAfter: senderAfter },
          }),
          tx.transaction.update({
            where: { id: receiverPending.id },
            data: { status: TransactionStatus.SUCCESSFUL, balanceBefore: receiverBefore, balanceAfter: receiverAfter },
          }),
        ]);

        return { sender: senderTx, receiver: receiverTx };
      });

      await Promise.all([
        invalidateBalance(senderId),
        invalidateBalance(receiverOriginal.userId),
      ]);
      await enqueueTransactionEvent(
        {
          event: "REVERSAL",
          userId: senderId,
          transactionId: result.sender.id,
          originalId: senderOriginal.id,
          amount: result.sender.amount.toString(),
          reference: result.sender.reference,
          timestamp: result.sender.timestamp.toISOString(),
        },
        result.sender.id
      );

      return result;
    });
  } catch (error) {
    await Promise.all([
      prisma.transaction.update({ where: { id: senderPending.id }, data: { status: TransactionStatus.FAILED } }),
      prisma.transaction.update({ where: { id: receiverPending.id }, data: { status: TransactionStatus.FAILED } }),
    ]);
    throw error;
  }
};
