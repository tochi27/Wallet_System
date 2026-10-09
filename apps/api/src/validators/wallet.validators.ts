import { z } from "zod";

const amount = z
  .number({ error: "Amount must be a number" })
  .positive("Amount must be greater than zero");

const description = z.string().max(255).optional();

export const creditSchema = z.object({ amount, description });

export const debitSchema = z.object({ amount, description });

export const transferSchema = z.object({
  amount,
  description,
  // Validates format when present; the controller guards the required case
  // so the "receiverEmail is required" error message is preserved for callers.
  receiverEmail: z.email("Invalid email address").optional(),
});

export const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
  timezone: z
    .string()
    .optional()
    .default("UTC")
    .refine(isValidTimeZone, "timezone must be a valid IANA timezone, e.g. Africa/Lagos"),
});
