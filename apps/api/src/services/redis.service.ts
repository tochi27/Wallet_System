import Redis from "ioredis";
import logger from "../config/logger";
import { env } from "../config/env";

const redisClient = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

redisClient.on("error", (err) => logger.error({ err }, "Redis connection error"));
redisClient.on("connect", () => logger.info("Redis connected"));

export default redisClient;
