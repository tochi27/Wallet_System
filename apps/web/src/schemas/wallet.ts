import { z } from "zod"

// Amounts stay strings in the form so "10.50" isn't mangled while typing; they're
// converted with Number() only when sent. Balances are Decimal(18, 2) in the database.
const amount = z
  .string()
  .trim()
  .min(1, "Enter an amount")
  .regex(/^\d+(\.\d{1,2})?$/, "Enter a number with up to 2 decimal places")
  .refine((value) => Number(value) > 0, "Amount must be greater than zero")
  .refine((value) => Number(value) < 1e16, "Amount is too large")

// Mirrors the 255-character limit in apps/api/src/validators/wallet.validators.ts
const description = z.string().trim().max(255, "Keep the note under 255 characters")

const transferSchema = z.object({
  receiverEmail: z.email("Enter a valid email address"),
  amount,
  description,
})

export type MoneyActionValues = z.infer<typeof transferSchema>

// Deposits share the transfer form shape (the recipient field is simply unused) and mirror the
// API's deposit minimum (apps/api/src/validators/payment.validators.ts)
const depositSchema = transferSchema.extend({
  receiverEmail: z.string(),
  amount: amount.refine((value) => Number(value) >= 100, "The minimum deposit is ₦100"),
})

// Mirrors the API's withdrawal limits (apps/api/src/validators/payment.validators.ts)
export const withdrawalSchema = z.object({
  amount: amount
    .refine((value) => Number(value) >= 100, "The minimum withdrawal is ₦100")
    .refine((value) => Number(value) <= 5_000_000, "The maximum withdrawal is ₦5,000,000"),
})

export type WithdrawalValues = z.infer<typeof withdrawalSchema>

export function moneyActionSchema(action: "credit" | "transfer") {
  return action === "transfer" ? transferSchema : depositSchema
}
