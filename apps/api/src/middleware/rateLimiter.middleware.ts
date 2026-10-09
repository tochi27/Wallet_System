import rateLimit from "express-rate-limit";
import { env } from "../config/env";

const skipInTest = () => env.NODE_ENV === "test";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
});

// Writes that move money (and webhook changes) — kept tight
export const walletLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
});

// Reads (balance, history, stats, profile, webhook lists). A single dashboard view makes
// several of these, so they get a looser budget than writes. Counted separately from writes.
export const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: skipInTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later" },
});
