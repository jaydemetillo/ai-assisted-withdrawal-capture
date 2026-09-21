-- AlterTable
ALTER TABLE "ExtractedCandidate" ADD COLUMN     "visualMatchItemId" TEXT,
ADD COLUMN     "visualMatchPhotoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "visualMatchScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "ExtractedCandidate" ADD CONSTRAINT "ExtractedCandidate_visualMatchItemId_fkey" FOREIGN KEY ("visualMatchItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
