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
  pin: z.string().optional(),
});

export const transactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export const isValidTimeZone = (timeZone: string) => {
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

const MAX_STATEMENT_DAYS = 366;
const isoDate = z.iso.date("Use dates in the form YYYY-MM-DD");
const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const statementQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    format: z.enum(["pdf", "csv"], { error: "format must be pdf or csv" }).optional().default("pdf"),
    timezone: z
      .string()
      .optional()
      .default("UTC")
      .refine(isValidTimeZone, "timezone must be a valid IANA timezone, e.g. Africa/Lagos"),
  })
  .refine((query) => query.to >= query.from, "The end date must be on or after the start date")
  .refine((query) => daysBetween(query.from, query.to) < MAX_STATEMENT_DAYS, "A statement can cover up to one year");
