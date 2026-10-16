import { env } from "./env";

const rawUrl = env.REDIS_URL;
const parsed = new URL(rawUrl);

export const bullmqConnection = {
  host: parsed.hostname,
  port: Number(parsed.port) || 6379,
  // redis://host:6379/1 selects database 1, as ioredis does for the main client. The browser tests
  // use their own database so their queued jobs never reach a development server's workers.
  ...(parsed.pathname.length > 1 ? { db: Number(parsed.pathname.slice(1)) } : {}),
  ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  ...(parsed.username && parsed.username !== "default"
    ? { username: decodeURIComponent(parsed.username) }
    : {}),
};
