-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- AlterTable: cast balance from DoublePrecision to Decimal
ALTER TABLE "Wallet" ALTER COLUMN "balance" SET DATA TYPE DECIMAL(18,2);

-- AlterTable: cast amount from DoublePrecision to Decimal
ALTER TABLE "Transaction" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable: migrate type column from TEXT to TransactionType enum
-- Add a nullable enum column, backfill from existing lowercase strings, then swap
ALTER TABLE "Transaction" ADD COLUMN "type_new" "TransactionType";
UPDATE "Transaction" SET "type_new" = UPPER("type")::"TransactionType";
ALTER TABLE "Transaction" DROP COLUMN "type";
ALTER TABLE "Transaction" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "Transaction" ALTER COLUMN "type" SET NOT NULL;
