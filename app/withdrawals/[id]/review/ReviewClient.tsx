'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Decision, Disposition, SubmissionStatus } from '@prisma/client';
import { AddItemPanel } from './AddItemPanel';
import { PhotoWithBoxes, type PhotoBox } from './PhotoWithBoxes';
import { NotOnListAction } from './NotOnListAction';
import { MockBadge } from '@/components/MockBadge';
import { offerNotOnList } from '@/lib/decision/line-state';
import { StatusPill } from '@/components/StatusPill';

type CandidateView = {
  id: string;
  rawText: string;
  decision: Decision;
  disposition: Disposition;
  decisionMessage: string;
  matchedItemId: string | null;
  resolvedItemId: string | null;
  proposedQuantity: number | null;
  resolvedQuantity: number | null;
  suggestedItemIds: string[];
  isManual: boolean;
  evidence: 'written_text' | 'visible_item';
  /** What the learned index proposed for this line, if it was consulted. */
  visualMatchItemId: string | null;
  /** Where it is in the photo, already validated. Null when it could not be placed. */
  box: { x: number; y: number; width: number; height: number } | null;
};

/** Reference photos held for an item at this location. Familiarity, not correctness. */
type ReferenceCount = { examples: number; timesAgreed: number };

type ItemView = { id: string; sku: string; displayName: string; unit: string; isRestricted: boolean };
type Blocker = { candidateId: string | null; code: string; message: string };

/**
 * The confirmation screen.
 *
 * Its job is to be boring and unambiguous: what we think you took, how sure we are in
 * words rather than a percentage, and four clearly separated things you can do about it.
 * The Confirm button is disabled while anything is unresolved, and the reason is stated
 * above it rather than left for the user to work out.
 */
export function ReviewClient({
  submissionId,
  status,
  locationName,
  imageUrl,
  rawText,
  providerName,
  providerModel,
  isMock,
  candidates,
  items,
  referenceCounts,
  canConfirm,
  blockers,
  nothingMatched,
  looksLikePrescription,
  mayContainPatientDetails,
  locationId,
  canCreateItems,
}: {
  submissionId: string;
  status: SubmissionStatus;
  locationName: string;
  imageUrl: string;
  rawText: string | null;
  providerName: string;
  providerModel: string;
  isMock: boolean;
  candidates: CandidateView[];
  items: ItemView[];
  referenceCounts: Record<string, ReferenceCount>;
  canConfirm: boolean;
  blockers: Blocker[];
  nothingMatched: boolean;
  looksLikePrescription: boolean;
  mayContainPatientDetails: boolean;
  locationId: string;
  canCreateItems: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);

  const [focused, setFocused] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement | null>());
  const photoRef = useRef<HTMLElement | null>(null);

  const settled = status === 'confirmed' || status === 'cancelled';
  const byId = new Map(items.map((item) => [item.id, item]));

  /**
   * Cards are numbered over the WHOLE list, boxes only over the lines that have one.
   * Numbering the boxes 1..n separately would put "2" on the photo next to a card
   * labelled "3", which is worse than no number at all.
   */
  const numbered = candidates.map((candidate, index) => ({ candidate, number: index + 1 }));

  const photoBoxes: PhotoBox[] = useMemo(
    () =>
      numbered
        .filter(({ candidate }) => candidate.box !== null)
        .map(({ candidate, number }) => ({
          id: candidate.id,
          number,
          box: candidate.box as NonNullable<CandidateView['box']>,
          label: candidate.rawText,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates],
  );

  // Tapping a box brings its card to you. Selecting without scrolling leaves somebody
  // looking at a highlighted rectangle with no idea which of six cards just changed.
  const focusFromPhoto = useCallback((candidateId: string) => {
    setFocused(candidateId);
    cardRefs.current.get(candidateId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  // And the other direction, so the two never disagree about what is selected. Tapping
  // the number again clears it — a selection you cannot undo is a trap on a small screen.
  const showOnPhoto = useCallback((candidateId: string) => {
    setFocused((current) => (current === candidateId ? null : candidateId));
    photoRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  async function patch(candidateId: string, body: Record<string, unknown>) {
    setBusy(candidateId);
    setError(null);
    const response = await fetch(`/api/withdrawals/${submissionId}/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'That change did not save.');
    }
    setBusy(null);
    router.refresh();
  }

  async function post(path: string, label: string) {
    setBusy(label);
    setError(null);
    const response = await fetch(`/api/withdrawals/${submissionId}/${path}`, { method: 'POST' });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? 'That did not work. Please try again.');
      setBusy(null);
      return;
    }
    setBusy(null);
    if (path === 'confirm') router.push(`/withdrawals/${submissionId}/confirmed`);
    else router.refresh();
  }

  const applicable = candidates.filter((c) => c.disposition !== 'rejected');

  return (
    <div className="flex flex-col gap-5 pb-44">
      <section ref={photoRef} className="card overflow-hidden">
        {/* Shown whole, at its own shape. This used to be a square `object-cover` crop —
            which reads fine until you draw a box on it, at which point up to 40% of a
            portrait photo is missing and every rectangle is in the wrong place on the
            wrong scale. The letterboxing an honest aspect ratio costs is worth it. */}
        <PhotoWithBoxes
          src={imageUrl}
          alt="The photo you submitted"
          boxes={photoBoxes}
          selectedId={focused}
          onSelect={focusFromPhoto}
        />
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
          <span className="text-ink-muted">{locationName}</span>
          <span className="text-ink-subtle">
            Read by {providerName}
            {providerModel ? ` · ${providerModel}` : ''}
          </span>
        </div>
      </section>

      <section className="card p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowText((value) => !value)}
          aria-expanded={showText}
        >
          <span className="font-semibold">What we read from the photo</span>
          <span aria-hidden className="text-ink-muted">
            {showText ? '−' : '+'}
          </span>
        </button>
        {showText ? (
          <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-canvas-sunken p-3 text-sm text-ink-muted">
            {rawText?.trim() || 'Nothing legible was read.'}
          </pre>
        ) : null}
      </section>

      {/* Sits immediately above the proposals, because that is what it is about. */}
      {isMock ? <MockBadge /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold">
          {isMock
            ? 'Sample data — not from your photo'
            : applicable.length === 1
              ? 'Found 1 likely item'
              : `Found ${applicable.length} likely items`}
        </h2>

        {candidates.length === 0 ? (
          <p className="card p-4 text-ink-muted">
            Nothing could be read from this photo. Send it to supply review and a person will work it through
            with you.
          </p>
        ) : null}

        {nothingMatched ? (
          <section className="rounded-2xl border border-line bg-canvas p-4">
            <h3 className="font-bold">Nothing on this page is stocked at {locationName}</h3>
            {looksLikePrescription ? (
              <p className="mt-1.5 text-sm text-ink-muted">
                This looks like a <strong>prescription</strong>. This app records supplies taken from the cart
                — cannulas, syringes, fluids, dressings, masks — and does not handle dispensing or medication
                orders.
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-ink-muted">
                This app records supplies taken from the cart. Photograph the supply note, a used-pack label,
                or the items themselves.
              </p>
            )}
            {mayContainPatientDetails ? (
              <p className="mt-3 rounded-xl border border-stop-600/30 bg-stop-50 px-3 py-2 text-sm text-stop-900">
                <strong>This page may contain patient information.</strong> Please do not photograph patient
                details. Cancel this submission so the image is not kept alongside a stock record.
              </p>
            ) : null}
            <p className="mt-3 text-sm text-ink-muted">
              You can still choose items by hand below, or cancel this submission.
            </p>
          </section>
        ) : null}

        {numbered.map(({ candidate, number }) => {
          const chosen = candidate.resolvedItemId ?? candidate.matchedItemId;
          const item = chosen ? byId.get(chosen) : null;
          const quantity = candidate.resolvedQuantity ?? candidate.proposedQuantity;
          const rejected = candidate.disposition === 'rejected';
          const suggestions = candidate.suggestedItemIds
            .map((suggestionId) => byId.get(suggestionId))
            .filter((value): value is ItemView => Boolean(value));

          return (
            <article
              key={candidate.id}
              ref={(node) => {
                cardRefs.current.set(candidate.id, node);
              }}
              className={`card p-4 ${rejected ? 'opacity-60' : ''} ${
                focused === candidate.id ? 'ring-2 ring-brand-600' : ''
              }`}
              aria-busy={busy === candidate.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-start gap-2 text-lg font-bold leading-snug">
                    {/* The same number as the chip on the photo. A plain span when the
                        line could not be placed, so the number never promises a box that
                        is not there. */}
                    {candidate.box ? (
                      <button
                        type="button"
                        onClick={() => showOnPhoto(candidate.id)}
                        aria-label={`Show line ${number} on the photo`}
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sm tabular-nums ${
                          focused === candidate.id
                            ? 'bg-brand-600 text-white'
                            : 'bg-canvas-sunken text-ink-muted'
                        }`}
                      >
                        {number}
                      </button>
                    ) : (
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-canvas-sunken text-sm tabular-nums text-ink-subtle"
                      >
                        {number}
                      </span>
                    )}
                    <span className="min-w-0">
                      {item ? item.displayName : 'Not identified'}
                      {item && quantity ? <span className="text-ink-muted"> × {quantity}</span> : null}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-subtle">
                    {candidate.isManual
                      ? 'Added by hand'
                      : candidate.evidence === 'visible_item'
                        ? /* Never "Written:" — nobody wrote this. Saying what the model
                             SAW lets the nurse check it against the same photograph. */
                          `Seen in the photo: ${candidate.rawText}`
                        : `Written: “${candidate.rawText}”`}
                  </p>
                </div>
                {isMock ? (
                  <span className="pill-stop shrink-0">Simulated</span>
                ) : (
                  <StatusPill decision={candidate.decision} />
                )}
              </div>

              {/* Only on lines the recogniser actually spoke to, and never on its own.
                  "Confirmed 14×" is how often this bay has accepted a line matching these
                  photos — a statement about how common the item is, not about whether
                  THIS match is right. It sits next to the instruction to check precisely
                  so it cannot be read as permission to stop checking. */}
              {candidate.evidence === 'visible_item' && candidate.visualMatchItemId ? (
                <SeenBefore count={referenceCounts[candidate.visualMatchItemId]} />
              ) : null}

              {candidate.decision !== 'eligible' ? (
                <p className="mt-3 rounded-xl bg-canvas-sunken px-3 py-2 text-sm text-ink-muted">
                  {candidate.decisionMessage}
                </p>
              ) : null}

              {rejected ? (
                <p className="mt-3 text-sm font-semibold text-ink-muted">
                  Dropped — this line will not change stock.
                </p>
              ) : null}

              {!settled ? (
                <div className="mt-3 flex flex-col gap-3">
                  {candidate.decision !== 'eligible' && !rejected ? (
                    <CandidateEditor
                      candidate={candidate}
                      items={items}
                      suggestions={suggestions}
                      disabled={busy === candidate.id}
                      onSave={(itemId, qty) =>
                        patch(candidate.id, { action: 'resolve', itemId, quantity: qty })
                      }
                    />
                  ) : null}

                  {/* On the card, not in a panel further down. A line with no item chosen
                      otherwise offers only "pick from a list that does not contain it" or
                      "delete it" — a dead end, four times over on a page of four.

                      Keyed on "is there an item on this line?", NOT on which rule fired.
                      One photograph produces a mix of unmatched, needs_review and
                      ambiguous lines; they all read as "Not identified" to the person
                      looking at them, so keying on the rule made the button appear on
                      some cards and not others for no reason anybody could see. */}
                  {offerNotOnList(candidate) ? (
                    <NotOnListAction
                      submissionId={submissionId}
                      candidateId={candidate.id}
                      suggestedName={cleanName(candidate.rawText)}
                      suggestedQuantity={candidate.proposedQuantity}
                      locationId={locationId}
                      locationName={locationName}
                      canCreateItems={canCreateItems}
                    />
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {!rejected ? (
                      <button
                        type="button"
                        className="btn-quiet px-3 text-sm"
                        disabled={busy === candidate.id}
                        onClick={() => patch(candidate.id, { action: 'reject' })}
                      >
                        Drop this line
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-quiet px-3 text-sm"
                        disabled={busy === candidate.id}
                        onClick={() => patch(candidate.id, { action: 'reset' })}
                      >
                        Put it back
                      </button>
                    )}
                    {candidate.disposition === 'corrected' ? (
                      <button
                        type="button"
                        className="btn-quiet px-3 text-sm"
                        disabled={busy === candidate.id}
                        onClick={() => patch(candidate.id, { action: 'reset' })}
                      >
                        Undo my change
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
        {!settled ? (
          <AddItemPanel
            submissionId={submissionId}
            locationId={locationId}
            locationName={locationName}
            items={items}
            canCreateItems={canCreateItems}
          />
        ) : null}
      </section>

      {error ? (
        <p
          className="rounded-xl border border-stop-600/30 bg-stop-50 px-4 py-3 text-sm text-stop-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {!settled ? (
        <>
          {blockers.length > 0 ? (
            <section className="rounded-2xl border border-warn-600/30 bg-warn-50 p-4" role="status">
              <h2 className="text-sm font-bold text-warn-900">
                {blockers.length === 1
                  ? 'One thing to settle first'
                  : `${blockers.length} things to settle first`}
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn-900/90">
                {blockers.map((blocker) => (
                  <li key={`${blocker.code}-${blocker.candidateId ?? 'submission'}`}>{blocker.message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <div
            className="fixed inset-x-0 bottom-0 border-t border-line bg-canvas/95 px-4 pt-3 backdrop-blur"
            style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
          >
            <div className="mx-auto flex max-w-2xl flex-col gap-2">
              <button
                type="button"
                className="btn-primary w-full"
                disabled={!canConfirm || busy !== null}
                onClick={() => post('confirm', 'confirm')}
              >
                {busy === 'confirm' ? 'Confirming…' : 'Confirm withdrawal'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary flex-1 text-sm"
                  disabled={busy !== null}
                  onClick={() => post('escalate', 'escalate')}
                >
                  Send for supply review
                </button>
                <button
                  type="button"
                  className="btn-danger flex-1 text-sm"
                  disabled={busy !== null}
                  onClick={() => post('cancel', 'cancel')}
                >
                  Cancel submission
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A sensible starting name for "not on the list", taken from what was written.
 *
 * Strips a leading or trailing count so "3x Chest drain kit" becomes "Chest drain kit" —
 * the quantity has its own field, and leaving it in the name would put it in the
 * catalogue forever.
 */
function cleanName(rawText: string): string {
  return rawText
    .replace(/^\s*\d+\s*[x×]\s*/i, '')
    .replace(/\s*[x×]\s*\d+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Choose an item and a quantity for a line the rules could not settle. */
function CandidateEditor({
  candidate,
  items,
  suggestions,
  disabled,
  onSave,
}: {
  candidate: CandidateView;
  items: ItemView[];
  suggestions: ItemView[];
  disabled: boolean;
  onSave: (itemId: string, quantity: number) => void;
}) {
  const [itemId, setItemId] = useState(candidate.resolvedItemId ?? candidate.matchedItemId ?? '');
  const [quantity, setQuantity] = useState(
    String(candidate.resolvedQuantity ?? candidate.proposedQuantity ?? ''),
  );

  const chosen = items.find((item) => item.id === itemId);
  const quantityValue = Number(quantity);
  const valid = Boolean(itemId) && Number.isInteger(quantityValue) && quantityValue > 0;

  return (
    <div className="rounded-xl border border-line bg-canvas-sunken p-3">
      {suggestions.length > 0 ? (
        <div className="mb-3">
          <p className="label mb-1.5">Did you mean</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className={`min-h-tap rounded-xl border px-3 text-left text-sm font-semibold ${
                  itemId === suggestion.id
                    ? 'border-brand-600 bg-brand-50 text-brand-900'
                    : 'border-line-strong bg-canvas text-ink'
                }`}
                onClick={() => setItemId(suggestion.id)}
              >
                {suggestion.displayName}
                {suggestion.isRestricted ? (
                  <span className="block text-xs font-normal text-stop-900">needs supply review</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label className="label" htmlFor={`item-${candidate.id}`}>
        Item
      </label>
      <select
        id={`item-${candidate.id}`}
        className="field mt-1.5"
        value={itemId}
        onChange={(event) => setItemId(event.target.value)}
      >
        <option value="">Choose an item…</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName}
            {item.isRestricted ? ' — needs supply review' : ''}
          </option>
        ))}
      </select>

      <label className="label mt-3" htmlFor={`qty-${candidate.id}`}>
        How many
      </label>
      <input
        id={`qty-${candidate.id}`}
        className="field mt-1.5"
        type="number"
        inputMode="numeric"
        min={1}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />

      {chosen?.isRestricted ? (
        <p className="mt-2 text-sm text-stop-900">
          {chosen.displayName} is controlled or high-risk. Supply review has to confirm this one — you can
          still set it here, then send the submission for review.
        </p>
      ) : null}

      <button
        type="button"
        className="btn-secondary mt-3 w-full"
        disabled={!valid || disabled}
        onClick={() => onSave(itemId, quantityValue)}
      >
        Save this line
      </button>
    </div>
  );
}

/**
 * The familiarity badge.
 *
 * Every word here has been chosen against a specific failure: a nurse reading a rising
 * number as a rising guarantee, checking less carefully as the system gets better, and
 * the residual errors slipping through BECAUSE accuracy improved. Better accuracy does
 * not fix automation bias — it causes it — so the only defence available to a badge is
 * to state the fact and repeat the obligation in the same breath.
 *
 * Which is also why there is no percentage anywhere on this screen. A similarity score
 * invites a judgement that nobody holding a phone has the information to make.
 */
function SeenBefore({ count }: { count: ReferenceCount | undefined }) {
  if (!count || count.examples === 0) return null;
  const photos = `${count.examples} photo${count.examples === 1 ? '' : 's'} taken here`;

  return (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 rounded-xl border border-line bg-canvas-sunken px-3 py-2 text-sm">
      <span className="font-semibold text-ink">
        {count.timesAgreed > 0
          ? `Matched against ${photos} · confirmed ${count.timesAgreed}×`
          : `Matched against ${photos}`}
      </span>
      <span className="text-ink-muted">You still need to check this one.</span>
    </p>
  );
}
