import { z } from "zod";

export const MIN_DEPOSIT = 100;
export const MAX_DEPOSIT = 10_000_000;

// Amounts go to Paystack in kobo, so anything beyond 2 decimal places can't be charged
const hasAtMostTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

export const depositSchema = z.object({
  amount: z
    .number({ error: "Amount must be a number" })
    .min(MIN_DEPOSIT, `The minimum deposit is ₦${MIN_DEPOSIT}`)
    .max(MAX_DEPOSIT, "The maximum deposit is ₦10,000,000")
    .refine(hasAtMostTwoDecimals, "Amount can have at most 2 decimal places"),
});

export const MIN_WITHDRAWAL = 100;
export const MAX_WITHDRAWAL = 5_000_000;

export const bankAccountSchema = z.object({
  bankCode: z.string().regex(/^\d{3,6}$/, "Choose a bank"),
  accountNumber: z.string().regex(/^\d{10}$/, "Account numbers are 10 digits"),
});

export const withdrawalSchema = z.object({
  bankAccountId: z.uuid("Choose a bank account"),
  amount: z
    .number({ error: "Amount must be a number" })
    .min(MIN_WITHDRAWAL, `The minimum withdrawal is ₦${MIN_WITHDRAWAL}`)
    .max(MAX_WITHDRAWAL, "The maximum withdrawal is ₦5,000,000")
    .refine(hasAtMostTwoDecimals, "Amount can have at most 2 decimal places"),
});
