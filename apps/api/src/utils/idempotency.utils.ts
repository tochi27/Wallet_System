import redisClient from "../services/redis.service";

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours

const idempotencyKey = (userId: string, key: string) =>
  `idempotency:${userId}:${key}`;

export const getIdempotencyRecord = async (
  key: string,
  userId: string
): Promise<{ response: unknown } | null> => {
  const value = await redisClient.get(idempotencyKey(userId, key));
  if (!value) return null;
  return { response: JSON.parse(value) };
};

export const saveIdempotencyRecord = async (
  key: string,
  userId: string,
  response: object
): Promise<void> => {
  await redisClient.set(
    idempotencyKey(userId, key),
    JSON.stringify(response),
    "EX",
    IDEMPOTENCY_TTL_SECONDS
  );
};
