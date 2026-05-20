import { Request, Response } from "express";
import prisma from "../config/db";
import redisClient from "../services/redis.service";

const PROBE_TIMEOUT_MS = 2000;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    ),
  ]);

const checkDatabase = async (): Promise<"ok" | "error"> => {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, PROBE_TIMEOUT_MS);
    return "ok";
  } catch {
    return "error";
  }
};

const checkRedis = async (): Promise<"ok" | "error"> => {
  try {
    await withTimeout(redisClient.ping(), PROBE_TIMEOUT_MS);
    return "ok";
  } catch {
    return "error";
  }
};

export const healthCheck = async (_req: Request, res: Response) => {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const status = database === "ok" && redis === "ok" ? "ok" : "degraded";

  return res.status(status === "ok" ? 200 : 503).json({
    status,
    uptime: process.uptime(),
    services: { database, redis },
  });
};
