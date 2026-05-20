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
