import pino from "pino";
import { env } from "./env";

const isDev = env.NODE_ENV === "development";

const logger = pino({
  level: env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),
});

export default logger;
