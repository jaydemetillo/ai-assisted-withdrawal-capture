import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { currentUser } from '@/lib/auth/session';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { loadDecisionConfig } from '@/lib/decision/config';
import { evaluateSubmission, type CandidateState } from '@/lib/decision/submission';
import { signImageToken } from '@/lib/storage/signing';
import { CaseClient } from './CaseClient';

export const dynamic = 'force-dynamic';

/**
 * One case, with the evidence a reviewer needs to settle it: the original photo, the raw
 * text, what the model proposed, and what the rules decided. Everything they do here is
 * audited with a before and an after.
 */
export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role === 'nurse') redirect('/withdrawals/new');

  const { caseId } = await params;
  const reviewCase = await prisma.reviewCase.findUnique({
    where: { id: caseId },
    include: {
      location: true,
      candidate: true,
      item: true,
      submission: {
        include: { submitter: true, candidates: { orderBy: { sequence: 'asc' } } },
      },
    },
  });
  if (!reviewCase) notFound();

  const catalogue = await catalogueForLocation(reviewCase.locationId);
  const config = loadDecisionConfig();

  const submission = reviewCase.submission;
  let canConfirmSubmission = false;
  let blockers: { message: string }[] = [];

  if (submission) {
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
    canConfirmSubmission = evaluation.canConfirm;
    blockers = evaluation.blockers.map((b) => ({ message: b.message }));
  }

  const imageUrl = submission
    ? `/api/images/${submission.imageKey}?t=${signImageToken(submission.imageKey, user.id)}`
    : null;

  return (
    <div className="min-h-dvh">
      <AppHeader title="Review case" back={{ href: '/supply-review', label: 'Back to queue' }} user={user} />
      <main className="mx-auto max-w-2xl px-4 py-5">
        <section className="card p-4">
          <h2 className="text-lg font-bold">{reviewCase.item?.displayName ?? 'Unidentified line'}</h2>
          <p className="mt-1 text-ink-muted">{reviewCase.summary}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-ink-subtle">Location</dt>
              <dd className="font-medium">{reviewCase.location.name}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Raised</dt>
              <dd className="font-medium">{reviewCase.createdAt.toLocaleString('en-GB')}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Status</dt>
              <dd className="font-medium">{reviewCase.status.replace(/_/g, ' ')}</dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Submitted by</dt>
              <dd className="font-medium">{submission?.submitter.name ?? '—'}</dd>
            </div>
          </dl>
        </section>

        {imageUrl ? (
          <section className="card mt-4 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="The submitted photo" className="aspect-square w-full object-cover" />
          </section>
        ) : null}

        {submission?.rawText ? (
          <section className="card mt-4 p-4">
            <h3 className="font-semibold">What was read from the photo</h3>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-canvas-sunken p-3 text-sm text-ink-muted">
              {submission.rawText}
            </pre>
          </section>
        ) : null}

        {reviewCase.candidate ? (
          <section className="card mt-4 p-4">
            <h3 className="font-semibold">What the reader proposed</h3>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Written</dt>
                <dd className="text-right font-medium">“{reviewCase.candidate.rawText}”</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Quantity read</dt>
                <dd className="text-right font-medium">{reviewCase.candidate.proposedQuantity ?? 'not readable'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Model said</dt>
                <dd className="text-right font-medium">
                  {reviewCase.candidate.providerStatus.replace(/_/g, ' ')} (
                  {Math.round(reviewCase.candidate.providerConfidence * 100)}%)
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-subtle">Rules decided</dt>
                <dd className="text-right font-medium">{reviewCase.candidate.decisionReasonCode}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <CaseClient
          caseId={reviewCase.id}
          submissionId={reviewCase.submissionId}
          status={reviewCase.status}
          hasCandidate={Boolean(reviewCase.candidate)}
          defaultItemId={reviewCase.candidate?.resolvedItemId ?? reviewCase.candidate?.matchedItemId ?? ''}
          defaultQuantity={reviewCase.candidate?.resolvedQuantity ?? reviewCase.candidate?.proposedQuantity ?? null}
          suggestedItemIds={reviewCase.candidate?.suggestedItemIds ?? []}
          items={catalogue.items.map((item) => ({
            id: item.id,
            displayName: item.displayName,
            isRestricted: item.isControlled || item.isHighRisk,
          }))}
          canConfirmSubmission={canConfirmSubmission}
          blockers={blockers}
        />

        {submission ? (
          <p className="mt-4 text-center text-sm">
            <Link href={`/withdrawals/${submission.id}/review`} className="text-brand-700 underline">
              Open the whole submission
            </Link>
          </p>
        ) : null}
      </main>
    </div>
  );
}
