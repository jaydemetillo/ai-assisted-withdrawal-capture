'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

type Item = { id: string; sku: string; displayName: string; unit: string; isRestricted: boolean };

/**
 * Adding a line the reader did not produce.
 *
 * Two different situations behind one button, because from the nurse's side they feel
 * identical — "the app hasn't got what I took":
 *
 *   1. The item IS stocked here and the photo just missed it. Pick it, set a number, done.
 *   2. The item is not in the catalogue at all. A reviewer or admin can add it on the
 *      spot; a nurse asks for it to be added, which files a case with the photo attached.
 *      Either way the record keeps what was taken instead of losing it.
 */
export function AddItemPanel({
  submissionId,
  locationId,
  locationName,
  items,
  canCreateItems,
}: {
  submissionId: string;
  locationId: string;
  locationName: string;
  items: Item[];
  canCreateItems: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('each');
  const [isControlled, setIsControlled] = useState(false);
  const [isHighRisk, setIsHighRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items.slice(0, 8);
    return items.filter((i) => i.displayName.toLowerCase().includes(needle)).slice(0, 8);
  }, [items, search]);

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty > 0;

  function reset() {
    setSearch('');
    setItemId('');
    setQuantity('1');
    setNewName('');
    setIsControlled(false);
    setIsHighRisk(false);
    setError(null);
  }

  async function addExisting() {
    if (!itemId || !qtyValid) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/withdrawals/${submissionId}/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, quantity: qty }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? 'That could not be added.');
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  }

  async function createAndAdd() {
    if (!newName.trim() || !qtyValid) return;
    setBusy(true);
    setError(null);

    const created = await fetch('/api/catalogue/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        displayName: newName.trim(),
        unit: newUnit.trim() || 'each',
        // Stocked with what was taken, so the withdrawal does not immediately go
        // negative on an item nobody has counted yet.
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
      setError(createdData.error ?? 'That item could not be added to the catalogue.');
      return;
    }

    const added = await fetch(`/api/withdrawals/${submissionId}/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: createdData.item.id, quantity: qty }),
    });
    const addedData = (await added.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!added.ok) {
      setError(addedData.error ?? 'The item was added to the catalogue, but the line was not.');
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  }

  async function requestItem() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    const response = await fetch('/api/catalogue/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId,
        description: newName.trim(),
        quantity: qtyValid ? qty : undefined,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? 'That request could not be sent.');
      return;
    }
    setDone(`Supply review has been asked to add "${newName.trim()}". It will not change stock.`);
    reset();
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {done ? (
          <p className="rounded-xl border border-ok-600/30 bg-ok-50 px-4 py-3 text-sm text-ok-900" role="status">
            {done}
          </p>
        ) : null}
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          + Add an item
        </button>
      </div>
    );
  }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">Add an item</h3>
        <button type="button" className="btn-quiet px-3 text-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <div className="mt-3 flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'existing'}
          className={`min-h-tap flex-1 rounded-xl border px-3 text-sm font-semibold ${
            mode === 'existing' ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-line-strong bg-canvas'
          }`}
          onClick={() => setMode('existing')}
        >
          Already stocked here
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'new'}
          className={`min-h-tap flex-1 rounded-xl border px-3 text-sm font-semibold ${
            mode === 'new' ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-line-strong bg-canvas'
          }`}
          onClick={() => setMode('new')}
        >
          Not on the list
        </button>
      </div>

      {mode === 'existing' ? (
        <div className="mt-4">
          <label className="label" htmlFor="add-search">
            Find the item
          </label>
          <input
            id="add-search"
            className="field mt-1.5"
            placeholder="Start typing — gauze, cannula, gloves…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ul className="mt-2 flex flex-col gap-1.5">
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`min-h-tap w-full rounded-xl border px-3 py-2 text-left text-sm ${
                    itemId === item.id ? 'border-brand-600 bg-brand-50' : 'border-line bg-canvas'
                  }`}
                  onClick={() => setItemId(item.id)}
                >
                  <span className="font-semibold">{item.displayName}</span>
                  {item.isRestricted ? (
                    <span className="block text-xs text-stop-900">needs supply review</span>
                  ) : null}
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-1 py-2 text-sm text-ink-muted">
                Nothing here matches that. Try “Not on the list”.
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <div className="mt-4">
          <label className="label" htmlFor="add-name">
            What did you take?
          </label>
          <input
            id="add-name"
            className="field mt-1.5"
            placeholder="e.g. Chest drain kit 28Fr"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />

          {canCreateItems ? (
            <>
              <label className="label mt-3" htmlFor="add-unit">
                Unit
              </label>
              <input
                id="add-unit"
                className="field mt-1.5"
                value={newUnit}
                onChange={(event) => setNewUnit(event.target.value)}
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
                This adds it to {locationName}&apos;s catalogue permanently. Flagging it correctly matters:
                a controlled or high-risk item can never be self-confirmed by a nurse.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">
              Adding to the catalogue is a supply reviewer&apos;s job. This sends them a request with your
              photo attached. It will not change stock.
            </p>
          )}
        </div>
      )}

      <label className="label mt-3" htmlFor="add-qty">
        How many
      </label>
      <input
        id="add-qty"
        className="field mt-1.5"
        type="number"
        inputMode="numeric"
        min={1}
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />

      {error ? (
        <p className="mt-3 rounded-xl border border-stop-600/30 bg-stop-50 px-3 py-2 text-sm text-stop-900" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary mt-4 w-full"
        disabled={busy || (mode === 'existing' ? !itemId || !qtyValid : !newName.trim())}
        onClick={() => {
          if (mode === 'existing') return void addExisting();
          return void (canCreateItems ? createAndAdd() : requestItem());
        }}
      >
        {busy
          ? 'Saving…'
          : mode === 'existing'
            ? 'Add this line'
            : canCreateItems
              ? 'Add to catalogue and to this withdrawal'
              : 'Ask supply review to add it'}
      </button>
    </section>
  );
}
