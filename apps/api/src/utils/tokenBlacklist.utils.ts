import { createHash } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";
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

// Blacklists a token until it would have expired anyway
export const revokeToken = async (token: string): Promise<void> => {
  const decoded = jwt.decode(token) as JwtPayload | null;
  const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
  await addToBlacklistWithExpiry(token, expiresIn);
};
