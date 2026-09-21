'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Item = { id: string; displayName: string; isRestricted: boolean };

/**
 * A reviewer's five moves: take the case, match it, change the quantity, reject the
 * line, or send someone to count the shelf. Plus, when nothing is left unresolved,
 * approve the corrected transaction — which runs the same confirm service a nurse uses,
 * recorded against the reviewer's own role.
 */
export function CaseClient({
  caseId,
  submissionId,
  status,
  hasCandidate,
  defaultItemId,
  defaultQuantity,
  suggestedItemIds,
  items,
  canConfirmSubmission,
  blockers,
}: {
  caseId: string;
  submissionId: string | null;
  status: string;
  hasCandidate: boolean;
  defaultItemId: string;
  defaultQuantity: number | null;
  suggestedItemIds: string[];
  items: Item[];
  canConfirmSubmission: boolean;
  blockers: { message: string }[];
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState(defaultItemId);
  const [quantity, setQuantity] = useState(defaultQuantity ? String(defaultQuantity) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closed = status === 'resolved' || status === 'rejected';
  const suggestions = items.filter((item) => suggestedItemIds.includes(item.id));
  const quantityValue = Number(quantity);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/review-cases/${caseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, note: note || undefined, ...extra }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? 'That did not work.');
      return;
    }
    router.refresh();
  }

  async function approveTransaction() {
    if (!submissionId) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/withdrawals/${submissionId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: `case-${caseId}` }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? 'That could not be approved.');
      return;
    }
    router.push(`/withdrawals/${submissionId}/confirmed`);
  }

  if (closed) {
    return (
      <section className="card mt-4 p-4">
        <p className="font-semibold">This case is {status}.</p>
        <p className="mt-1 text-sm text-ink-muted">Closed cases are kept as part of the audit trail.</p>
      </section>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {hasCandidate ? (
        <section className="card p-4">
          <h3 className="font-semibold">Match this line</h3>

          {suggestions.length > 0 ? (
            <div className="mt-3">
              <p className="label mb-1.5">Possible matches</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className={`min-h-tap rounded-xl border px-3 text-sm font-semibold ${
                      itemId === suggestion.id
                        ? 'border-brand-600 bg-brand-50 text-brand-900'
                        : 'border-line-strong bg-canvas'
                    }`}
                    onClick={() => setItemId(suggestion.id)}
                  >
                    {suggestion.displayName}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="label mt-3" htmlFor="case-item">
            Item
          </label>
          <select
            id="case-item"
            className="field mt-1.5"
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
          >
            <option value="">Choose an item…</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName}
                {item.isRestricted ? ' — controlled/high-risk' : ''}
              </option>
            ))}
          </select>

          <label className="label mt-3" htmlFor="case-qty">
            Quantity
          </label>
          <input
            id="case-qty"
            className="field mt-1.5"
            type="number"
            inputMode="numeric"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />

          <button
            type="button"
            className="btn-primary mt-4 w-full"
            disabled={busy || !itemId || !Number.isInteger(quantityValue) || quantityValue <= 0}
            onClick={() => act('match', { itemId, quantity: quantityValue })}
          >
            Save this match
          </button>
        </section>
      ) : null}

      <section className="card p-4">
        <label className="label" htmlFor="case-note">
          Note (goes into the audit trail)
        </label>
        <textarea
          id="case-note"
          className="field mt-1.5 min-h-[5rem] py-3"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What you found, and what you did about it."
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => act('claim')}>
            Take this case
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => act('request_physical_check')}
          >
            Request a physical check
          </button>
          {hasCandidate ? (
            <button type="button" className="btn-danger" disabled={busy} onClick={() => act('reject')}>
              Reject this line
            </button>
          ) : null}
          <button type="button" className="btn-quiet" disabled={busy} onClick={() => act('close')}>
            Close without changes
          </button>
        </div>
      </section>

      {submissionId ? (
        <section className="card p-4">
          <h3 className="font-semibold">Approve the corrected withdrawal</h3>
          <p className="mt-1 text-sm text-ink-muted">
            This deducts stock. It runs the same checks a nurse's confirmation does, recorded against your
            reviewer role.
          </p>
          {blockers.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn-900">
              {blockers.map((blocker) => (
                <li key={blocker.message}>{blocker.message}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="btn-primary mt-3 w-full"
            disabled={busy || !canConfirmSubmission}
            onClick={approveTransaction}
          >
            Approve and update stock
          </button>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-stop-600/30 bg-stop-50 px-4 py-3 text-sm text-stop-900" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
