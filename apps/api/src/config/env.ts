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

  // CORS — comma-separated list of browser origins allowed to call the API
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((val) =>
      val
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    )
    .pipe(z.array(z.url("CORS_ORIGINS must be a comma-separated list of URLs"))),

  // Paystack. Payments respond 503 until a secret key is set.
  PAYSTACK_SECRET_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^sk_(test|live)_/, "PAYSTACK_SECRET_KEY must be a Paystack secret key (sk_test_… or sk_live_…)")
      .optional()
  ),
  PAYSTACK_BASE_URL: z.url().default("https://api.paystack.co"),
  // Where Paystack sends the user after checkout: the web app's deposit callback page
  PAYSTACK_CALLBACK_URL: z.url().default("http://localhost:5173/deposit/callback"),
  // Development only: fake Paystack's transfer side (recipients, payouts) so withdrawals can be
  // exercised before the Paystack account is approved for payouts. Bank lists and account lookups
  // still use the real (test) API. Refused in production and with a live key — see below.
  PAYSTACK_SIMULATE_PAYOUTS: z.stringbool().default(false),

  // Endpoints that move money with no real payment behind them: POST /api/wallet/credit,
  // POST /api/wallet/debit and user-initiated reversals. On by default outside production (for
  // development and tests); off in production unless explicitly set to true.
  DIRECT_FUNDING_ENABLED: z.stringbool().optional(),

  // Logging
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),
});

const parsed = envSchema
  .refine(
    (config) =>
      !config.PAYSTACK_SIMULATE_PAYOUTS ||
      (config.NODE_ENV !== "production" && !config.PAYSTACK_SECRET_KEY?.startsWith("sk_live_")),
    {
      message: "PAYSTACK_SIMULATE_PAYOUTS is only allowed outside production, with a test key",
      path: ["PAYSTACK_SIMULATE_PAYOUTS"],
    }
  )
  .transform((config) => ({
    ...config,
    DIRECT_FUNDING_ENABLED: config.DIRECT_FUNDING_ENABLED ?? config.NODE_ENV !== "production",
  }))
  .safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:\n");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error(`\nCheck your .env.${process.env.NODE_ENV || "development"} file.`);
  process.exit(1);
}

export const env = parsed.data;
