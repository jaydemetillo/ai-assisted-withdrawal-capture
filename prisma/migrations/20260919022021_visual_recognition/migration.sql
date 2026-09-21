-- CreateEnum
CREATE TYPE "ReferencePhotoSource" AS ENUM ('taught', 'learned_from_correction');

-- CreateTable
CREATE TABLE "ItemReferencePhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "embedding" DOUBLE PRECISION[],
    "embeddingModel" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL DEFAULT 0,
    "source" "ReferencePhotoSource" NOT NULL,
    "labelledById" TEXT,
    "submissionId" TEXT,
    "sourceCandidateId" TEXT,
    "timesAgreed" INTEGER NOT NULL DEFAULT 0,
    "timesOverruled" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "retiredAt" TIMESTAMP(3),
    "retiredReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemReferencePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemReferencePhoto_sourceCandidateId_key" ON "ItemReferencePhoto"("sourceCandidateId");

-- CreateIndex
CREATE INDEX "ItemReferencePhoto_locationId_isActive_embeddingModel_idx" ON "ItemReferencePhoto"("locationId", "isActive", "embeddingModel");

-- CreateIndex
CREATE INDEX "ItemReferencePhoto_itemId_locationId_isActive_idx" ON "ItemReferencePhoto"("itemId", "locationId", "isActive");

-- CreateIndex
CREATE INDEX "ItemReferencePhoto_locationId_createdAt_idx" ON "ItemReferencePhoto"("locationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ItemReferencePhoto" ADD CONSTRAINT "ItemReferencePhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemReferencePhoto" ADD CONSTRAINT "ItemReferencePhoto_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemReferencePhoto" ADD CONSTRAINT "ItemReferencePhoto_labelledById_fkey" FOREIGN KEY ("labelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemReferencePhoto" ADD CONSTRAINT "ItemReferencePhoto_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WithdrawalSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemReferencePhoto" ADD CONSTRAINT "ItemReferencePhoto_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "ExtractedCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
