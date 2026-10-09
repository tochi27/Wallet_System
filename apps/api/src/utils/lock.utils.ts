import { randomUUID } from "crypto";
import redisClient from "../services/redis.service";

const LOCK_TTL_MS = 10_000;
const LOCK_RETRY_COUNT = 50;
const LOCK_RETRY_DELAY_MS = 100;

const RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

const walletLockKey = (userId: string) => `wallet:lock:${userId}`;

const acquireLock = async (key: string): Promise<string | null> => {
  const token = randomUUID();
  const result = await redisClient.set(key, token, "PX", LOCK_TTL_MS, "NX");
  return result === "OK" ? token : null;
};

const releaseLock = async (key: string, token: string): Promise<void> => {
  await redisClient.eval(RELEASE_SCRIPT, 1, key, token);
};

export const withLock = async <T>(
  userId: string,
  fn: () => Promise<T>
): Promise<T> => {
  const key = walletLockKey(userId);
  let token: string | null = null;

  for (let attempt = 0; attempt <= LOCK_RETRY_COUNT; attempt++) {
    token = await acquireLock(key);
    if (token) break;
    if (attempt < LOCK_RETRY_COUNT) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }

  if (!token) throw new Error("Could not acquire lock — resource is busy");

  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
};

// Acquires locks in sorted key order to prevent deadlocks between concurrent callers
export const withMultiLock = async <T>(
  userIds: string[],
  fn: () => Promise<T>
): Promise<T> => {
  const sortedIds = [...new Set(userIds)].sort();
  const keys = sortedIds.map(walletLockKey);
  const tokens: string[] = [];

  try {
    for (const key of keys) {
      let token: string | null = null;

      for (let attempt = 0; attempt <= LOCK_RETRY_COUNT; attempt++) {
        token = await acquireLock(key);
        if (token) break;
        if (attempt < LOCK_RETRY_COUNT) {
          await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
        }
      }

      if (!token) throw new Error("Could not acquire lock — resource is busy");
      tokens.push(token);
    }

    return await fn();
  } finally {
    await Promise.all(keys.map((key, i) => releaseLock(key, tokens[i])));
  }
};
