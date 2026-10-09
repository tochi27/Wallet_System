import { createHash } from "crypto";
import redisClient from "../services/redis.service";

const blacklistKey = (token: string) =>
  `blacklist:${createHash("sha256").update(token).digest("hex")}`;

export const isBlacklisted = async (token: string): Promise<boolean> => {
  const result = await redisClient.get(blacklistKey(token));
  return result !== null;
};

export const addToBlacklistWithExpiry = async (
  token: string,
  expiresIn: number
): Promise<void> => {
  if (expiresIn <= 0) return;
  await redisClient.set(blacklistKey(token), "1", "EX", expiresIn);
};
