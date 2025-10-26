import { PrismaClient } from "@prisma/client";
import prisma from "../config/db";

// Credit service
export const creditWallet = async (userId: string, amount: number) => {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });
    await tx.transaction.create({
      data: { userId, type: "credit", amount },
    });
    return wallet;
  });
};

// Debit service
export const debitWallet = async (userId: string, amount: number) => {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.balance < amount) throw new Error("Insufficient funds");

    const updatedWallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });

    await tx.transaction.create({
      data: { userId, type: "debit", amount },
    });

    return updatedWallet;
  });
};

// Balance service
export const getBalance = async (userId: string) => {
  return prisma.wallet.findUnique({ where: { userId } });
};

// Get Transaction service
export const getTransactions = async (userId: string) => {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { timestamp: "desc" },
  });
};
