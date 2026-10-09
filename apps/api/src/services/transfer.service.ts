import { randomUUID } from "crypto";
import { TransactionType, TransactionStatus, Prisma, Transaction } from "@prisma/client";
import prisma from "../config/db";
import { getIdempotencyRecord, saveIdempotencyRecord } from "../utils/idempotency.utils";
import { withMultiLock } from "../utils/lock.utils";
import { invalidateBalance } from "../utils/cache.utils";
import { enqueueTransactionEvent } from "../queues/transaction.queue";

type TransferResult = {
  transferId: string;
  sender: Transaction;
  receiver: Transaction;
};

export const transferFunds = async (
  senderId: string,
  receiverEmail: string,
  amount: number,
  description?: string,
  idempotencyKey?: string
): Promise<TransferResult> => {
  if (idempotencyKey) {
    const existing = await getIdempotencyRecord(idempotencyKey, senderId);
    if (existing) return existing.response as unknown as TransferResult;
  }

  const receiver = await prisma.user.findUnique({
    where: { email: receiverEmail },
    include: { wallet: true },
  });

  if (!receiver) throw new Error("Receiver not found");
  if (!receiver.wallet) throw new Error("Receiver has no wallet");
  if (receiver.id === senderId) throw new Error("Cannot transfer to yourself");

  const transferId = randomUUID();

  const [senderPending, receiverPending] = await Promise.all([
    prisma.transaction.create({
      data: {
        userId: senderId,
        type: TransactionType.DEBIT,
        status: TransactionStatus.PENDING,
        amount,
        description: description ?? `Transfer to ${receiverEmail}`,
        transferId,
      },
    }),
    prisma.transaction.create({
      data: {
        userId: receiver.id,
        type: TransactionType.CREDIT,
        status: TransactionStatus.PENDING,
        amount,
        description: description ?? `Transfer from ${receiverEmail}`,
        transferId,
      },
    }),
  ]);

  try {
    const result = await withMultiLock([senderId, receiver.id], async () => {
      const txResult = await prisma.$transaction(async (tx) => {
        const senderWallet = await tx.wallet.findUnique({ where: { userId: senderId } });
        if (!senderWallet) throw new Error("Sender wallet not found");

        if (new Prisma.Decimal(senderWallet.balance).lt(amount)) {
          throw new Error("Insufficient funds");
        }

        const receiverWallet = await tx.wallet.findUnique({ where: { userId: receiver.id } });
        if (!receiverWallet) throw new Error("Receiver wallet not found");

        const senderBefore = senderWallet.balance;
        const senderAfter = new Prisma.Decimal(senderBefore).sub(amount);
        const receiverBefore = receiverWallet.balance;
        const receiverAfter = new Prisma.Decimal(receiverBefore).add(amount);

        await Promise.all([
          tx.wallet.update({ where: { userId: senderId }, data: { balance: senderAfter } }),
          tx.wallet.update({ where: { userId: receiver.id }, data: { balance: receiverAfter } }),
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

        return { transferId, sender: senderTx, receiver: receiverTx };
      });

      await Promise.all([
        invalidateBalance(senderId),
        invalidateBalance(receiver.id),
      ]);
      await enqueueTransactionEvent(
        {
          event: "TRANSFER",
          senderId,
          receiverId: receiver.id,
          transferId: txResult.transferId,
          amount: txResult.sender.amount.toString(),
          senderRef: txResult.sender.reference,
          receiverRef: txResult.receiver.reference,
          timestamp: txResult.sender.timestamp.toISOString(),
        },
        txResult.transferId
      );

      return txResult;
    });

    if (idempotencyKey) {
      await saveIdempotencyRecord(idempotencyKey, senderId, result);
    }

    return result;
  } catch (error) {
    await Promise.all([
      prisma.transaction.update({ where: { id: senderPending.id }, data: { status: TransactionStatus.FAILED } }),
      prisma.transaction.update({ where: { id: receiverPending.id }, data: { status: TransactionStatus.FAILED } }),
    ]);
    throw error;
  }
};
