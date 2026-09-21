-- CreateEnum
CREATE TYPE "Role" AS ENUM ('nurse', 'supply_reviewer', 'admin');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('received', 'extracting', 'awaiting_review', 'in_supply_review', 'confirmed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('high_confidence', 'ambiguous', 'unmatched', 'unreadable', 'restricted');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('eligible', 'needs_review', 'ambiguous', 'unmatched', 'unreadable', 'restricted');

-- CreateEnum
CREATE TYPE "Disposition" AS ENUM ('pending', 'confirmed', 'corrected', 'rejected', 'escalated', 'applied');

-- CreateEnum
CREATE TYPE "ReviewCaseKind" AS ENUM ('ambiguous_candidate', 'unmatched_candidate', 'unreadable_candidate', 'restricted_candidate', 'stock_discrepancy', 'extraction_failed');

-- CreateEnum
CREATE TYPE "ReviewCaseStatus" AS ENUM ('open', 'in_progress', 'awaiting_physical_check', 'resolved', 'rejected');

-- CreateEnum
CREATE TYPE "ReviewCasePriority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'ordered', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TxnType" AS ENUM ('withdrawal', 'correction', 'reversal');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'nurse',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "category" TEXT NOT NULL DEFAULT 'general',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "reorderThreshold" INTEGER NOT NULL DEFAULT 0,
    "reorderQuantity" INTEGER NOT NULL DEFAULT 0,
    "isControlled" BOOLEAN NOT NULL DEFAULT false,
    "isHighRisk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAlias" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "isApproved" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalSubmission" (
    "id" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "imageMediaType" TEXT NOT NULL,
    "imageBytes" INTEGER NOT NULL DEFAULT 0,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'received',
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'pending',
    "extractionProvider" TEXT NOT NULL DEFAULT '',
    "extractionModel" TEXT NOT NULL DEFAULT '',
    "rawText" TEXT,
    "extractionError" TEXT,
    "extractionStartedAt" TIMESTAMP(3),
    "extractionEndedAt" TIMESTAMP(3),
    "confirmationKey" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedCandidate" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "proposedQuantity" INTEGER,
    "proposedItemId" TEXT,
    "providerConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "providerStatus" "ProviderStatus" NOT NULL,
    "providerReason" TEXT NOT NULL DEFAULT '',
    "decision" "Decision" NOT NULL,
    "decisionReasonCode" TEXT NOT NULL,
    "decisionMessage" TEXT NOT NULL,
    "suggestedItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolvedItemId" TEXT,
    "resolvedQuantity" INTEGER,
    "disposition" "Disposition" NOT NULL DEFAULT 'pending',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractedCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT,
    "sourceCandidateId" TEXT,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "type" "TxnType" NOT NULL DEFAULT 'withdrawal',
    "quantityDelta" INTEGER NOT NULL,
    "quantityBefore" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "reviewCaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplenishmentTask" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "triggeredByTransactionId" TEXT,
    "quantityAtTrigger" INTEGER NOT NULL,
    "reorderThreshold" INTEGER NOT NULL,
    "suggestedQuantity" INTEGER NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReplenishmentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewCase" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT,
    "candidateId" TEXT,
    "itemId" TEXT,
    "locationId" TEXT NOT NULL,
    "kind" "ReviewCaseKind" NOT NULL,
    "status" "ReviewCaseStatus" NOT NULL DEFAULT 'open',
    "priority" "ReviewCasePriority" NOT NULL DEFAULT 'normal',
    "summary" TEXT NOT NULL DEFAULT '',
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "openedById" TEXT,
    "assignedToId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "submissionId" TEXT,
    "locationId" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "correlationId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- CreateIndex
CREATE INDEX "InventoryItem_isActive_idx" ON "InventoryItem"("isActive");

-- CreateIndex
CREATE INDEX "InventoryItem_isControlled_isHighRisk_idx" ON "InventoryItem"("isControlled", "isHighRisk");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAlias_normalizedAlias_key" ON "InventoryAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "InventoryAlias_itemId_idx" ON "InventoryAlias"("itemId");

-- CreateIndex
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_itemId_locationId_key" ON "InventoryBalance"("itemId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalSubmission_confirmationKey_key" ON "WithdrawalSubmission"("confirmationKey");

-- CreateIndex
CREATE INDEX "WithdrawalSubmission_status_createdAt_idx" ON "WithdrawalSubmission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawalSubmission_submitterId_createdAt_idx" ON "WithdrawalSubmission"("submitterId", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawalSubmission_locationId_status_idx" ON "WithdrawalSubmission"("locationId", "status");

-- CreateIndex
CREATE INDEX "ExtractedCandidate_submissionId_disposition_idx" ON "ExtractedCandidate"("submissionId", "disposition");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedCandidate_submissionId_sequence_key" ON "ExtractedCandidate"("submissionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_sourceCandidateId_key" ON "InventoryTransaction"("sourceCandidateId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemId_locationId_createdAt_idx" ON "InventoryTransaction"("itemId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_locationId_createdAt_idx" ON "InventoryTransaction"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_submissionId_idx" ON "InventoryTransaction"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransaction_submissionId_sourceCandidateId_key" ON "InventoryTransaction"("submissionId", "sourceCandidateId");

-- CreateIndex
CREATE INDEX "ReplenishmentTask_status_locationId_createdAt_idx" ON "ReplenishmentTask"("status", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplenishmentTask_itemId_locationId_idx" ON "ReplenishmentTask"("itemId", "locationId");

-- CreateIndex
CREATE INDEX "ReviewCase_status_locationId_createdAt_idx" ON "ReviewCase"("status", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewCase_kind_status_idx" ON "ReviewCase"("kind", "status");

-- CreateIndex
CREATE INDEX "ReviewCase_submissionId_idx" ON "ReviewCase"("submissionId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_submissionId_createdAt_idx" ON "AuditEvent"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "InventoryAlias" ADD CONSTRAINT "InventoryAlias_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalSubmission" ADD CONSTRAINT "WithdrawalSubmission_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalSubmission" ADD CONSTRAINT "WithdrawalSubmission_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalSubmission" ADD CONSTRAINT "WithdrawalSubmission_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedCandidate" ADD CONSTRAINT "ExtractedCandidate_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WithdrawalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedCandidate" ADD CONSTRAINT "ExtractedCandidate_proposedItemId_fkey" FOREIGN KEY ("proposedItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedCandidate" ADD CONSTRAINT "ExtractedCandidate_resolvedItemId_fkey" FOREIGN KEY ("resolvedItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedCandidate" ADD CONSTRAINT "ExtractedCandidate_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WithdrawalSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "ExtractedCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentTask" ADD CONSTRAINT "ReplenishmentTask_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentTask" ADD CONSTRAINT "ReplenishmentTask_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentTask" ADD CONSTRAINT "ReplenishmentTask_triggeredByTransactionId_fkey" FOREIGN KEY ("triggeredByTransactionId") REFERENCES "InventoryTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplenishmentTask" ADD CONSTRAINT "ReplenishmentTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WithdrawalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ExtractedCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "WithdrawalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-added constraints that Prisma's schema language cannot express.
-- ─────────────────────────────────────────────────────────────────────────────

-- At most one OPEN replenishment task per item and location. Five withdrawals in a
-- shift must not produce five identical tasks for the storeroom to wade through.
CREATE UNIQUE INDEX "ReplenishmentTask_one_open_per_item_location"
    ON "ReplenishmentTask" ("itemId", "locationId")
 WHERE "status" = 'open';

-- before + delta = after, always. A transaction row that does not add up is not a
-- ledger entry, it is a bug, and it should never reach the table.
ALTER TABLE "InventoryTransaction"
  ADD CONSTRAINT "InventoryTransaction_arithmetic_check"
  CHECK ("quantityBefore" + "quantityDelta" = "quantityAfter");

-- A withdrawal removes stock; it never adds it.
ALTER TABLE "InventoryTransaction"
  ADD CONSTRAINT "InventoryTransaction_withdrawal_sign_check"
  CHECK ("type" <> 'withdrawal' OR "quantityDelta" < 0);

-- Optimistic-lock versions only ever move forward.
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_version_check" CHECK ("version" >= 0);

-- A proposed or resolved quantity is a positive whole number of units, or absent.
-- "0 of something" is not a withdrawal; it is an unread number, and must stay null.
ALTER TABLE "ExtractedCandidate"
  ADD CONSTRAINT "ExtractedCandidate_proposed_quantity_check"
  CHECK ("proposedQuantity" IS NULL OR "proposedQuantity" > 0);
ALTER TABLE "ExtractedCandidate"
  ADD CONSTRAINT "ExtractedCandidate_resolved_quantity_check"
  CHECK ("resolvedQuantity" IS NULL OR "resolvedQuantity" > 0);

-- Provider confidence is a probability, not a score out of anything else.
ALTER TABLE "ExtractedCandidate"
  ADD CONSTRAINT "ExtractedCandidate_confidence_range_check"
  CHECK ("providerConfidence" >= 0 AND "providerConfidence" <= 1);
