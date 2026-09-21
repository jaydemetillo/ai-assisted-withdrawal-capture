-- AlterTable
ALTER TABLE "ExtractedCandidate" ADD COLUMN     "matchedItemId" TEXT;

-- AddForeignKey
ALTER TABLE "ExtractedCandidate" ADD CONSTRAINT "ExtractedCandidate_matchedItemId_fkey" FOREIGN KEY ("matchedItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
