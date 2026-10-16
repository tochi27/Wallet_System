-- CreateEnum
CREATE TYPE "AccountTier" AS ENUM ('TIER_1', 'TIER_2');

-- AlterTable: every existing account starts on Tier 1; staff can raise it
ALTER TABLE "User" ADD COLUMN     "tier" "AccountTier" NOT NULL DEFAULT 'TIER_1';
