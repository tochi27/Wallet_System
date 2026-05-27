import express, { Request, Response, NextFunction } from "express";
import { Worker } from "bullmq";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import prisma from "./config/db";
import logger from "./config/logger";
import redisClient from "./services/redis.service";
import { createTransactionWorker } from "./workers/transaction.worker";
import { createWebhookWorker } from "./workers/webhook.worker";
import authRoutes from "./routes/auth.routes";
import walletRoutes from "./routes/wallet.routes";
import webhookRoutes from "./routes/webhook.routes";
import { healthCheck } from "./controllers/health.controller";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { swaggerOptions } from "./swagger-docs/swagger";

const app = express();

// ✅ Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  pinoHttp({
    logger,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  })
);

const specs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// ✅ Root + health
app.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ message: "💰 Wallet API running 🚀" })
);
app.get("/health", healthCheck);

// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/webhooks", webhookRoutes);

// ✅ Error Handler
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, "Unhandled request error");
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
);

let worker: Worker | null = null;
let webhookWorker: Worker | null = null;

// ✅ Service connections (Prisma + Redis + Workers)
export const connectServices = async () => {
  try {
    await Promise.all([
      prisma.$connect(),
      redisClient.connect(),
    ]);

    if (env.NODE_ENV !== "test") {
      worker = createTransactionWorker();
      webhookWorker = createWebhookWorker();
      logger.info("Transaction and webhook workers started");
    }

    logger.info("Database and Redis connected");
  } catch (error) {
    logger.error({ err: error }, "Service startup failed");
    process.exit(1);
  }
};

// ✅ Graceful shutdown
export const disconnectServices = async () => {
  await Promise.all([
    prisma.$disconnect(),
    redisClient.quit(),
    worker?.close(),
    webhookWorker?.close(),
  ]);
  logger.info("All services disconnected cleanly");
};

export default app;
