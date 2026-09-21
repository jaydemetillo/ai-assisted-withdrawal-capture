-- AlterEnum
ALTER TYPE "ReviewCaseKind" ADD VALUE 'catalogue_request';

-- AlterTable
ALTER TABLE "ExtractedCandidate" ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false;
