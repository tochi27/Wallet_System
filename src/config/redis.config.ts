import { env } from "./env";

const rawUrl = env.REDIS_URL;
const parsed = new URL(rawUrl);

export const bullmqConnection = {
  host: parsed.hostname,
  port: Number(parsed.port) || 6379,
  ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  ...(parsed.username && parsed.username !== "default"
    ? { username: decodeURIComponent(parsed.username) }
    : {}),
};
