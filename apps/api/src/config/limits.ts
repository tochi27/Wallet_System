import type { AccountTier } from "@prisma/client";

/**
 * How much money each account tier can move, in naira. Change the numbers here; nothing else
 * needs to change. An account whose email isn't verified can't move money at all (see
 * middleware/verified.middleware.ts), so these apply only to verified accounts.
 *
 * - perTransaction: the most one transfer or withdrawal can be
 * - dailyOut: the most that can leave the wallet (transfers and withdrawals together) in one day,
 *   from midnight to midnight Nigerian time
 * - maxBalance: the most the wallet can hold, checked before adding money; null for no cap.
 *   Money that has already been paid (a Paystack deposit, a transfer from someone else) is
 *   always credited, even past the cap: refusing money that has already moved is worse.
 */
export const TIER_LIMITS: Record<AccountTier, { perTransaction: number; dailyOut: number; maxBalance: number | null }> = {
  TIER_1: { perTransaction: 50_000, dailyOut: 200_000, maxBalance: 500_000 },
  TIER_2: { perTransaction: 500_000, dailyOut: 2_000_000, maxBalance: null },
};

// Daily limits reset at midnight in Lagos (UTC+1 all year, no daylight saving)
export const LIMITS_UTC_OFFSET_HOURS = 1;
