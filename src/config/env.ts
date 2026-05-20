import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(4000),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Auth — enforce a strong secret in production
  JWT_SECRET: z
    .string()
    .min(1, "JWT_SECRET is required")
    .refine(
      (val) => process.env.NODE_ENV !== "production" || val.length >= 32,
      "JWT_SECRET must be at least 32 characters in production"
    ),

  // Logging
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:\n");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error(`\nCheck your .env.${process.env.NODE_ENV || "development"} file.`);
  process.exit(1);
}

export const env = parsed.data;
