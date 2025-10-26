import express, { Request, Response, NextFunction } from "express";
import prisma from "./config/db";
import authRoutes from "./routes/auth.routes";
import walletRoutes from "./routes/wallet.routes";
import dotenv from "dotenv";
import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { swaggerOptions } from "./swagger-docs/swagger";

// To make app dynamically pick the environment based on the NODE_ENV
dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });

const app = express();

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const specs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// ✅ Health check route
app.get("/", (_req: Request, res: Response) =>
  res.status(200).json({ message: "💰 Wallet API running 🚀" })
);

// ✅ Routes
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);

// ✅ Error Handler
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("🔥 Server Error:", err.stack);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
);

// ✅ Service connections (Prisma + Redis)
export const connectServices = async () => {
  try {
    await prisma.$connect();
    console.log("✅ Database and Redis connected successfully");
  } catch (error) {
    console.error("❌ Service Connection Error:", error);
    process.exit(1);
  }
};

// ✅ Graceful shutdown
export const disconnectServices = async () => {
  await prisma.$disconnect();
  console.log("🧹 Disconnected all services cleanly");
};

export default app;
