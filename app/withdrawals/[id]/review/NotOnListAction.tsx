'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * "It's not on the list" — on the card of the line it is about.
 *
 * This used to live only in the separate "+ Add an item" panel at the bottom, which adds
 * a NEW line. That left an unidentified line with exactly two options: pick from a list
 * that does not contain it, or delete it. Four unidentified lines meant four dead ends
 * and no way to confirm anything.
 *
 * What happens depends on who you are, and both paths settle THIS line:
 *
 *   reviewer/admin → the item is added to the catalogue and this line is pointed at it.
 *   nurse          → supply review is asked to add it, and this line is marked as moving
 *                    no stock, because an item the catalogue does not have has nothing to
 *                    deduct from. The request keeps the record of what was taken.
 */
export function NotOnListAction({
  submissionId,
  candidateId,
  suggestedName,
  suggestedQuantity,
  locationId,
  locationName,
  canCreateItems,
}: {
  submissionId: string;
  candidateId: string;
  suggestedName: string;
  suggestedQuantity: number | null;
  locationId: string;
  locationName: string;
  canCreateItems: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [unit, setUnit] = useState('each');
  const [quantity, setQuantity] = useState(String(suggestedQuantity ?? 1));
  const [isControlled, setIsControlled] = useState(false);
  const [isHighRisk, setIsHighRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty > 0;

  async function addToCatalogue() {
    setBusy(true);
    setError(null);

    const created = await fetch('/api/catalogue/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        displayName: name.trim(),
        unit: unit.trim() || 'each',
        quantityOnHand: qty,
        isControlled,
        isHighRisk,
      }),
    });
    const createdData = (await created.json().catch(() => ({}))) as {
      error?: string;
      item?: { id: string };
    };
    if (!created.ok || !createdData.item) {
      setBusy(false);
      setError(createdData.error ?? 'That item could not be added.');
      return;
    }

    // Point THIS line at the item we just created, rather than adding a second line.
    const resolved = await fetch(`/api/withdrawals/${submissionId}/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', itemId: createdData.item.id, quantity: qty }),
    });
    const resolvedData = (await resolved.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!resolved.ok) {
      setError(resolvedData.error ?? 'The item was added, but this line was not updated.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function requestItem() {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/catalogue/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId,
        candidateId,
        description: name.trim(),
        quantity: qtyValid ? qty : undefined,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? 'That request could not be sent.');
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary w-full text-sm" onClick={() => setOpen(true)}>
        It&apos;s not on the list
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-canvas-sunken p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold">Not on the list</h4>
        <button type="button" className="btn-quiet px-2 text-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <label className="label mt-3" htmlFor={`nol-name-${candidateId}`}>
        What was it?
      </label>
      <input
        id={`nol-name-${candidateId}`}
        className="field mt-1.5"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Chest drain kit 28Fr"
      />

      <label className="label mt-3" htmlFor={`nol-qty-${candidateId}`}>
        How many
      </label>
      <input
        id={`nol-qty-${candidateId}`}
        className="field mt-1.5"
        type="number"
        inputMode="numeric"
        min={1}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />

      {canCreateItems ? (
        <>
          <label className="label mt-3" htmlFor={`nol-unit-${candidateId}`}>
            Unit
          </label>
          <input
            id={`nol-unit-${candidateId}`}
            className="field mt-1.5"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex min-h-tap items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={isControlled}
                onChange={(event) => setIsControlled(event.target.checked)}
              />
              Controlled drug
            </label>
            <label className="flex min-h-tap items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={isHighRisk}
                onChange={(event) => setIsHighRisk(event.target.checked)}
              />
              High-risk item
            </label>
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            Adds it to {locationName}&apos;s catalogue permanently and uses it for this line.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          Supply review will be asked to add it. This line will not change stock, and the request
          keeps a record of what you took.
        </p>
      )}

      {error ? (
        <p className="mt-3 rounded-xl border border-stop-600/30 bg-stop-50 px-3 py-2 text-sm text-stop-900" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary mt-3 w-full text-sm"
        disabled={busy || name.trim().length < 2 || (canCreateItems && !qtyValid)}
        onClick={() => void (canCreateItems ? addToCatalogue() : requestItem())}
      >
        {busy
          ? 'Saving…'
          : canCreateItems
            ? 'Add to catalogue and use it here'
            : 'Ask supply review to add it'}
      </button>
    </div>
  );
}
