import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { MockBadge } from '@/components/MockBadge';
import { canReview, currentUser } from '@/lib/auth/session';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { loadDecisionConfig } from '@/lib/decision/config';
import { evaluateSubmission, type CandidateState } from '@/lib/decision/submission';
import { inspectDocument } from '@/lib/decision/document';
import { signImageToken } from '@/lib/storage/signing';
import { boxFromRow } from '@/lib/vision/boxes';
import { exampleCounts } from '@/lib/vision/reference-photos';
import { ReviewClient } from './ReviewClient';

export const dynamic = 'force-dynamic';

/**
 * Screen 3 — review and confirm.
 *
 * Rendered on the server so the extracted text and the proposals never pass through a
 * client-side fetch that a browser extension or a console log could pick up.
 *
 * The Confirm button's enabled state is computed HERE by `evaluateSubmission`, and the
 * confirm endpoint runs the same function again on the way in. The disable is a courtesy;
 * the server-side re-check is the control.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const submission = await prisma.withdrawalSubmission.findUnique({
    where: { id },
    include: {
      location: true,
      candidates: { orderBy: { sequence: 'asc' } },
    },
  });
  if (!submission) notFound();
  if (submission.submitterId !== user.id && user.role === 'nurse') notFound();

  if (submission.extractionStatus === 'pending' || submission.extractionStatus === 'running') {
    redirect(`/withdrawals/${id}/processing`);
  }

  const catalogue = await catalogueForLocation(submission.locationId);
  const config = loadDecisionConfig();

  // How many reference photos this bay holds for each item, so a visually identified
  // line can say "seen before here" as a fact about the index. It is a FAMILIARITY
  // count and the card is required to say so — see ReviewClient.
  const seen = await exampleCounts(submission.locationId);

  const states: CandidateState[] = submission.candidates.map((c) => ({
    id: c.id,
    sequence: c.sequence,
    rawText: c.rawText,
    decision: c.decision,
    disposition: c.disposition,
    matchedItemId: c.matchedItemId,
    resolvedItemId: c.resolvedItemId,
    proposedQuantity: c.proposedQuantity,
    resolvedQuantity: c.resolvedQuantity,
  }));

  const evaluation = evaluateSubmission(
    { status: submission.status, candidates: states },
    { actorRole: user.role, catalogue, config },
  );

  const imageUrl = `/api/images/${submission.imageKey}?t=${signImageToken(submission.imageKey, user.id)}`;

  // Nothing here matched the cart. Say why, rather than showing a column of blank cards.
  const nothingMatched =
    submission.candidates.length > 0 &&
    submission.candidates.every((c) => c.decision === 'unmatched' || c.decision === 'unreadable');
  const hint = inspectDocument(submission.rawText);

  return (
    <div className="min-h-dvh">
      <AppHeader
        title="Check before confirming"
        back={{ href: '/withdrawals/new', label: 'Back' }}
        user={user}
      />
      <main className="mx-auto max-w-2xl px-4 py-5">
        {submission.status === 'confirmed' ? (
          <div className="card mb-5 border-ok-600/30 bg-ok-50 p-4">
            <h2 className="font-bold text-ok-900">This withdrawal was confirmed</h2>
            <p className="mt-1 text-sm text-ok-900/80">
              Stock has been updated. Nothing on this page can change it now.
            </p>
            <Link href="/inventory" className="btn-secondary mt-3">
              See stock
            </Link>
          </div>
        ) : null}

        <ReviewClient
          submissionId={submission.id}
          status={submission.status}
          locationName={submission.location.name}
          imageUrl={imageUrl}
          rawText={submission.rawText}
          providerName={submission.extractionProvider}
          providerModel={submission.extractionModel}
          isMock={submission.extractionProvider === 'mock'}
          candidates={submission.candidates.map((c) => ({
            id: c.id,
            rawText: c.rawText,
            decision: c.decision,
            disposition: c.disposition,
            decisionMessage: c.decisionMessage,
            matchedItemId: c.matchedItemId,
            resolvedItemId: c.resolvedItemId,
            proposedQuantity: c.proposedQuantity,
            resolvedQuantity: c.resolvedQuantity,
            suggestedItemIds: c.suggestedItemIds,
            isManual: c.isManual,
            evidence: c.evidence,
            visualMatchItemId: c.visualMatchItemId,
            // Re-validated rather than trusted, even though extraction already ran it
            // through the same function. The rows outlive the code that wrote them, and
            // a box that fails today's limits should stop being drawn today.
            box: boxFromRow(c),
          }))}
          referenceCounts={Object.fromEntries(
            [...seen.entries()].map(([itemId, counts]) => [itemId, counts]),
          )}
          items={catalogue.items.map((item) => ({
            id: item.id,
            sku: item.sku,
            displayName: item.displayName,
            unit: item.unit,
            isRestricted: item.isControlled || item.isHighRisk,
          }))}
          locationId={submission.locationId}
          canCreateItems={canReview(user.role)}
          canConfirm={evaluation.canConfirm}
          blockers={evaluation.blockers}
          nothingMatched={nothingMatched}
          looksLikePrescription={hint.looksLikePrescription}
          mayContainPatientDetails={hint.mayContainPatientDetails}
        />
      </main>
    </div>
  );
}
