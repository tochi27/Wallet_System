-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'REVERSED');

-- AlterTable: existing rows are completed transactions, so default them to SUCCESSFUL
ALTER TABLE "Transaction" ADD COLUMN "status" "TransactionStatus" NOT NULL DEFAULT 'SUCCESSFUL';
