-- AlterTable: link a reversal transaction back to the transaction it reverses
ALTER TABLE "Transaction" ADD COLUMN "reversalOf" TEXT;
CREATE INDEX "Transaction_reversalOf_idx" ON "Transaction"("reversalOf");
