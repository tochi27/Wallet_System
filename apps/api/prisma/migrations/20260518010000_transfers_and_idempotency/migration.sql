-- AlterTable: add optional transferId to link both sides of a transfer
ALTER TABLE "Transaction" ADD COLUMN "transferId" TEXT;
CREATE INDEX "Transaction_transferId_idx" ON "Transaction"("transferId");

-- CreateTable: idempotency keys scoped per user (moves to Redis in Step 5)
CREATE TABLE "IdempotencyKey" (
    "id"        TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "response"  JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_key_userId_key" ON "IdempotencyKey"("key", "userId");
CREATE INDEX "IdempotencyKey_userId_idx" ON "IdempotencyKey"("userId");
