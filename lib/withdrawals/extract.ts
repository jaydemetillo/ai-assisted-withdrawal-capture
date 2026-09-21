import type { Decision, EvidenceKind, ProviderStatus, ReviewCaseKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { loadDecisionConfig } from '@/lib/decision/config';
import { evaluateCandidate } from '@/lib/decision/rules';
import { extractionResultSchema } from '@/lib/domain/extraction';
import { buildExtractionContext, extractionProvider } from '@/lib/extraction';
import { storage } from '@/lib/storage';
import { normaliseBox } from '@/lib/vision/boxes';
import { recogniseLines } from '@/lib/vision/recognize';
import { NO_RECOGNITION, type VisualRecognition } from '@/lib/vision/similarity';
import { log } from '@/lib/log';

/**
 * Read a submission's photo and turn it into proposals.
 *
 * Safe to call repeatedly and safe to abandon. The nurse's phone fires this when the
 * processing screen opens, and may fire it again on a refresh or a retry; the
 * compare-and-set below means only one call does the work and the rest report the
 * current state.
 *
 * Nothing here writes to InventoryBalance. Extraction produces ExtractedCandidate rows
 * and nothing else — that separation is what makes "AI cannot change stock" structural
 * rather than a promise.
 */
export type ExtractOutcome = { status: 'started' | 'already_running' | 'already_done' | 'failed' };

/** Which kind of review case an unresolved decision opens. */
const CASE_KIND: Partial<Record<Decision, ReviewCaseKind>> = {
  ambiguous: 'ambiguous_candidate',
  unmatched: 'unmatched_candidate',
  unreadable: 'unreadable_candidate',
  restricted: 'restricted_candidate',
};

export async function runExtraction(submissionId: string): Promise<ExtractOutcome> {
  // Compare-and-set: whoever flips pending/failed to running owns this extraction. No
  // queue, no lock table, and a double-tap on the retry button is harmless.
  const claimed = await prisma.withdrawalSubmission.updateMany({
    where: { id: submissionId, extractionStatus: { in: ['pending', 'failed'] } },
    data: { extractionStatus: 'running', status: 'extracting', extractionStartedAt: new Date() },
  });

  if (claimed.count === 0) {
    const current = await prisma.withdrawalSubmission.findUnique({ where: { id: submissionId } });
    return { status: current?.extractionStatus === 'succeeded' ? 'already_done' : 'already_running' };
  }

  const submission = await prisma.withdrawalSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { submitter: true },
  });

  await recordAudit({
    action: AUDIT_ACTIONS.extractionStarted,
    entityType: 'WithdrawalSubmission',
    entityId: submission.id,
    submissionId: submission.id,
    locationId: submission.locationId,
    afterValue: { extractionStatus: 'running' },
  });

  const provider = extractionProvider();

  try {
    const catalogue = await catalogueForLocation(submission.locationId);
    const context = buildExtractionContext(catalogue, submission.demoScenario);
    const image = await storage().get(submission.imageKey);

    const raw = await provider.extract(
      { key: submission.imageKey, mediaType: image.mediaType, data: image.data },
      context,
    );
    // Parsed again here even though providers parse their own output: this is the
    // boundary the rest of the application trusts, and it must not depend on a provider
    // having remembered to validate.
    const result = extractionResultSchema.parse(raw);

    const config = loadDecisionConfig();

    // Validated here, once, so everything downstream — the overlay, the crop, the audit
    // row — reads the same repaired box rather than each re-deciding what to make of an
    // inverted rectangle.
    const boxes = result.candidates.map((candidate) => normaliseBox(candidate.box));

    // What the LEARNED index makes of each line. A boxed line is matched on its own crop,
    // so a tray of four items now produces four honest recognitions; an unboxed line is
    // matched on the whole photo only when it is the only thing in it. See
    // recognitionBasis() for why anything else gets nothing rather than a guess.
    const seenByLine = await recogniseLines({
      locationId: submission.locationId,
      image: { data: image.data, mediaType: image.mediaType },
      lines: result.candidates.map((candidate, index) => ({
        key: String(index),
        evidence: candidate.evidence,
        box: boxes[index],
      })),
    });

    const decided = result.candidates.map((candidate, index) => {
      // Passed only to visual lines. evaluateCandidate ignores it for written text, but
      // saying so here as well means the reason survives somebody reading only one file.
      const visual: VisualRecognition | null =
        candidate.evidence === 'visible_item' ? (seenByLine.get(String(index)) ?? null) : null;
      return {
        candidate,
        index,
        box: boxes[index],
        visual,
        outcome: evaluateCandidate(candidate, catalogue, config, visual),
      };
    });

    await prisma.$transaction(async (db) => {
      await db.extractedCandidate.deleteMany({ where: { submissionId: submission.id } });

      for (const { candidate, index, outcome, box, visual: lineVisual } of decided) {
        const seen = lineVisual ?? NO_RECOGNITION;
        await db.extractedCandidate.create({
          data: {
            submissionId: submission.id,
            sequence: index,
            rawText: candidate.rawText,
            evidence: candidate.evidence as EvidenceKind,
            proposedQuantity: candidate.proposedQuantity,
            proposedItemId: catalogue.items.some((i) => i.id === candidate.proposedItemId)
              ? candidate.proposedItemId
              : null,
            matchedItemId: outcome.matchedItemId,
            providerConfidence: candidate.confidence,
            providerStatus: candidate.status as ProviderStatus,
            providerReason: candidate.reason,
            decision: outcome.decision as Decision,
            decisionReasonCode: outcome.reasonCode,
            decisionMessage: outcome.message,
            suggestedItemIds: outcome.suggestedItemIds,
            // All four together or all four null. A half-written box would render as a
            // rectangle anchored at the origin, which looks like a bug in the overlay
            // rather than like missing data.
            boxX: box?.x ?? null,
            boxY: box?.y ?? null,
            boxWidth: box?.width ?? null,
            boxHeight: box?.height ?? null,
            // Recorded whatever the rules then did with it. The three-column audit —
            // what the model proposed, what our matcher found, what the learned index
            // thought — is only worth having if the third column is written down even
            // when it was overruled.
            visualMatchItemId: catalogue.items.some((i) => i.id === seen.itemId) ? seen.itemId : null,
            visualMatchScore: seen.score,
            visualMatchPhotoIds: seen.matchedPhotoIds,
          },
        });
      }

      await db.withdrawalSubmission.update({
        where: { id: submission.id },
        data: {
          extractionStatus: 'succeeded',
          status: 'awaiting_review',
          rawText: result.rawText,
          extractionProvider: provider.name,
          extractionModel: provider.model,
          extractionEndedAt: new Date(),
          extractionError: null,
        },
      });
    });

    // Review cases are opened outside the transaction above so a case-creation problem
    // cannot lose the extraction itself.
    await openCasesForUnresolved(submission.id);

    await recordAudit({
      action: AUDIT_ACTIONS.extractionSucceeded,
      entityType: 'WithdrawalSubmission',
      entityId: submission.id,
      submissionId: submission.id,
      locationId: submission.locationId,
      afterValue: {
        provider: provider.name,
        model: provider.model,
        candidates: decided.length,
        // The decisions, not the text. Enough to audit the outcome without the evidence.
        decisions: decided.map((d) => d.outcome.decision).join(','),
      },
    });

    for (const { outcome } of decided) {
      await recordAudit({
        action: AUDIT_ACTIONS.candidateDecided,
        entityType: 'WithdrawalSubmission',
        entityId: submission.id,
        submissionId: submission.id,
        locationId: submission.locationId,
        afterValue: { decision: outcome.decision, reasonCode: outcome.reasonCode },
      });
    }

    return { status: 'started' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed.';

    await prisma.withdrawalSubmission.update({
      where: { id: submission.id },
      data: {
        extractionStatus: 'failed',
        status: 'failed',
        extractionError: message.slice(0, 500),
        extractionEndedAt: new Date(),
        extractionProvider: provider.name,
        extractionModel: provider.model,
      },
    });

    // A failed read is still a durable submission with the photo attached. That is the
    // whole point of storing the image first: a human can still work it.
    await prisma.reviewCase.create({
      data: {
        submissionId: submission.id,
        locationId: submission.locationId,
        kind: 'extraction_failed',
        priority: 'normal',
        summary: 'The photo could not be read automatically.',
      },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.extractionFailed,
      entityType: 'WithdrawalSubmission',
      entityId: submission.id,
      submissionId: submission.id,
      locationId: submission.locationId,
      afterValue: { provider: provider.name, reason: message.slice(0, 200) },
    });

    log.error('extraction failed', { submissionId: submission.id, provider: provider.name });
    return { status: 'failed' };
  }
}

/**
 * Open a review case for every candidate the rules could not resolve.
 *
 * The nurse may still settle the easy ones on the review screen, which closes the case.
 * Opening it immediately means an abandoned submission still reaches a reviewer rather
 * than sitting invisible.
 */
export async function openCasesForUnresolved(submissionId: string): Promise<void> {
  const submission = await prisma.withdrawalSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { candidates: true },
  });

  for (const candidate of submission.candidates) {
    if (candidate.decision === 'eligible' || candidate.disposition !== 'pending') continue;

    const kind = CASE_KIND[candidate.decision] ?? 'unmatched_candidate';
    const existing = await prisma.reviewCase.findFirst({
      where: {
        candidateId: candidate.id,
        status: { in: ['open', 'in_progress', 'awaiting_physical_check'] },
      },
    });
    if (existing) continue;

    const created = await prisma.reviewCase.create({
      data: {
        submissionId: submission.id,
        candidateId: candidate.id,
        itemId: candidate.matchedItemId,
        locationId: submission.locationId,
        kind,
        priority: candidate.decision === 'restricted' ? 'high' : 'normal',
        summary: candidate.decisionMessage,
      },
    });

    await recordAudit({
      action: AUDIT_ACTIONS.reviewCaseOpened,
      entityType: 'ReviewCase',
      entityId: created.id,
      submissionId: submission.id,
      locationId: submission.locationId,
      afterValue: { kind, decision: candidate.decision, reasonCode: candidate.decisionReasonCode },
    });
  }
}
