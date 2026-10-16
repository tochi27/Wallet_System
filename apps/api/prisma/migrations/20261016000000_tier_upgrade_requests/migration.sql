-- CreateEnum
CREATE TYPE "UpgradeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KycIdType" AS ENUM ('NIN_SLIP', 'NATIONAL_ID', 'DRIVERS_LICENCE', 'PASSPORT', 'VOTERS_CARD');

-- CreateEnum
CREATE TYPE "KycDocumentKind" AS ENUM ('ID_FRONT', 'ID_BACK', 'SELFIE');

-- CreateEnum
CREATE TYPE "UpgradeRejectionReason" AS ENUM ('BLURRY_PHOTO', 'NAME_MISMATCH', 'EXPIRED_ID', 'SELFIE_MISMATCH', 'WRONG_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "TierUpgradeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "UpgradeStatus" NOT NULL DEFAULT 'PENDING',
    "legalName" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "idType" "KycIdType" NOT NULL,
    "idNumberEncrypted" TEXT NOT NULL,
    "idNumberLast4" TEXT NOT NULL,
    "rejectionReason" "UpgradeRejectionReason",
    "reviewMessage" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "documentsDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TierUpgradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "KycDocumentKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TierUpgradeRequest_status_createdAt_idx" ON "TierUpgradeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TierUpgradeRequest_userId_idx" ON "TierUpgradeRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KycDocument_requestId_kind_key" ON "KycDocument"("requestId", "kind");

-- AddForeignKey
ALTER TABLE "TierUpgradeRequest" ADD CONSTRAINT "TierUpgradeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierUpgradeRequest" ADD CONSTRAINT "TierUpgradeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TierUpgradeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one request under review per user, enforced by the database so two submissions at
-- once can't both go through
CREATE UNIQUE INDEX "TierUpgradeRequest_one_pending_per_user" ON "TierUpgradeRequest"("userId") WHERE "status" = 'PENDING';
