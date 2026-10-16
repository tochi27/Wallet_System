import { AccountTier, AdjustmentDirection, AdjustmentKind, AdjustmentStatus, DepositStatus, JournalEntryType, Role, WithdrawalStatus } from "@prisma/client";
import { z } from "zod";

const flag = z.enum(["true", "false"]).transform((value) => value === "true");

const page = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
};

export const listQuerySchema = z.object(page);

export const depositsQuerySchema = z.object({
  ...page,
  status: z.enum(DepositStatus).optional(),
  stuck: flag.optional(),
});

export const withdrawalsQuerySchema = z.object({
  ...page,
  status: z.enum(WithdrawalStatus).optional(),
  stuck: flag.optional(),
});

export const eventsQuerySchema = z.object({
  ...page,
  processed: flag.optional(),
  event: z.string().max(100).optional(),
});

// Every admin action that changes a user is recorded with why it was done
export const reasonSchema = z.object({
  reason: z
    .string({ error: "Give a reason for this action" })
    .trim()
    .min(3, "Give a reason for this action (at least 3 characters)")
    .max(500, "Keep the reason under 500 characters"),
});

// Re-entered for anything that moves money or changes staff roles
const password = z.string({ error: "Enter your password to confirm" }).min(1, "Enter your password to confirm");

export const adjustmentSchema = z.object({
  direction: z.enum(AdjustmentDirection, { error: "direction must be CREDIT or DEBIT" }),
  kind: z.enum(AdjustmentKind, { error: "kind must be REFUND, GOODWILL or CORRECTION" }),
  amount: z.number({ error: "Enter an amount" }).positive("Enter an amount above zero").max(10_000_000, "The most is ₦10,000,000"),
  reason: reasonSchema.shape.reason,
  password,
});

export const approveSchema = z.object({ password, note: z.string().trim().max(500).optional() });
export const rejectSchema = z.object({ password, reason: reasonSchema.shape.reason });

export const adjustmentsQuerySchema = z.object({
  ...page,
  status: z.enum(AdjustmentStatus).optional(),
  userId: z.string().max(100).optional(),
});

export const roleSchema = z.object({
  role: z.enum(Role, { error: "role must be USER, VIEWER, SUPPORT, FINANCE or OWNER" }),
  reason: reasonSchema.shape.reason,
  password,
});

export const tierSchema = z.object({
  tier: z.enum(AccountTier, { error: "tier must be TIER_1 or TIER_2" }),
  reason: reasonSchema.shape.reason,
});

export const ledgerEntriesQuerySchema = z.object({
  ...page,
  type: z.enum(JournalEntryType).optional(),
  userId: z.string().max(100).optional(),
});
