-- Add reference column with auto-generated UUID and unique constraint
ALTER TABLE "Transaction" ADD COLUMN "reference" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_reference_key" UNIQUE ("reference");

-- Add ledger balance snapshot columns (defaulting to 0 for existing rows)
ALTER TABLE "Transaction" ADD COLUMN "balanceBefore" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "balanceAfter" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Add optional human-readable description
ALTER TABLE "Transaction" ADD COLUMN "description" TEXT;
