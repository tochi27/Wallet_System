-- CreateEnum
CREATE TYPE "SpendingCategory" AS ENUM ('FOOD', 'BILLS', 'TRANSPORT', 'SHOPPING', 'ENTERTAINMENT', 'HEALTH', 'FAMILY_FRIENDS', 'SAVINGS', 'OTHER');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('AI', 'USER');

-- CreateEnum
CREATE TYPE "InsightSource" AS ENUM ('AI', 'TEMPLATE');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "category" "SpendingCategory",
ADD COLUMN     "categorySource" "CategorySource";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiInsightsConsentAt" TIMESTAMP(3),
ADD COLUMN     "aiInsightsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SpendingInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "source" "InsightSource" NOT NULL,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendingInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpendingInsight_userId_key" ON "SpendingInsight"("userId");

-- AddForeignKey
ALTER TABLE "SpendingInsight" ADD CONSTRAINT "SpendingInsight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

