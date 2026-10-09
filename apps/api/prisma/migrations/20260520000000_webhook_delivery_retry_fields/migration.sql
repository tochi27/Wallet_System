-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WebhookDelivery" ADD COLUMN "error" TEXT;
