import { Prisma } from "@prisma/client";
import redisClient from "../services/redis.service";

const BALANCE_TTL_SECONDS = 60;

const balanceCacheKey = (userId: string) => `balance:${userId}`;

export const getCachedBalance = async (userId: string): Promise<Prisma.Decimal | null> => {
  const value = await redisClient.get(balanceCacheKey(userId));
  return value !== null ? new Prisma.Decimal(value) : null;
};

export const setCachedBalance = async (
  userId: string,
  balance: Prisma.Decimal | number
): Promise<void> => {
  await redisClient.set(
    balanceCacheKey(userId),
    balance.toString(),
    "EX",
    BALANCE_TTL_SECONDS
  );
};

export const invalidateBalance = async (userId: string): Promise<void> => {
  await redisClient.del(balanceCacheKey(userId));
};
