'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScreenHeader } from '@/components/ScreenHeader';
import { OcrOverlay } from '@/components/OcrOverlay';
import { DemoOcrBanner } from '@/components/DemoOcrBanner';
import { ACTION_COPY, type Action } from '@/lib/constants';

type CatalogueItem = { id: string; sku: string; name: string; unit: string; quantity: number };
type Line = {
  id: string;
  rawText: string;
  itemId: string | null;
  itemGuess: string;
  quantity: number;
  confidence: number;
  needsReview: boolean;
  bbox: [number, number, number, number] | null;
};

export function ReviewClient({
  captureId, committed, photo, action: initialAction, provider, transcript, storeroomName, catalogue, lines: initialLines,
}: {
  captureId: string;
  committed: boolean;
  photo: string;
  action: Action;
  provider: string;
  transcript: string;
  storeroomName: string;
  catalogue: CatalogueItem[];
  lines: Line[];
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action>(initialAction);
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(catalogue.map((c) => [c.id, c])), [catalogue]);
  // Fixture rows have fixture coordinates. Painting them over the photo someone just
  // took reads as a confident misreading of their handwriting, so the overlay is only
  // ever shown for a real read.
  const isDemo = provider === 'mock';
  // A typed list has no photograph, so there is nothing to overlay - show the words instead.
  const isTyped = provider === 'typed' || !photo;
  const ready = lines.filter((l) => l.itemId && l.quantity > 0);
  const unresolved = lines.filter((l) => !l.itemId || l.quantity <= 0);
  const copy = ACTION_COPY[action];

  function patch(id: string, next: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...next, needsReview: false } : l)));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      // Persist every edit, then commit. Two calls so a failed commit leaves the
      // corrected draft intact rather than losing the user's fixes.
      const save = await fetch(`/api/captures/${captureId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          lines: lines.map((l) => ({ id: l.id, itemId: l.itemId, quantity: l.quantity })),
        }),
      });
      if (!save.ok) throw new Error(((await save.json()) as { error?: string }).error ?? 'Could not save your changes');

      const commit = await fetch(`/api/captures/${captureId}/commit`, { method: 'POST' });
      const data = (await commit.json()) as { transactionId?: string; error?: string };
      if (!commit.ok || !data.transactionId) throw new Error(data.error ?? 'Could not submit');

      router.push(`/scan/done/${data.transactionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit');
      setSubmitting(false);
    }
  }

  if (committed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-semibold text-content-strong">This list has already been submitted.</p>
        <button type="button" onClick={() => router.push('/')} className="rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white">
          Back to home
        </button>
      </div>
    );
  }

  return (
    <>
      <ScreenHeader title="Review list" onBack={() => router.push('/scan')} />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(11rem+var(--safe-b))]">
        {provider === 'mock' && <DemoOcrBanner className="mb-3" />}

        {isTyped ? (
          <div className="rounded-2xl border border-divider-medium bg-white p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-content-medium">
              What you entered
            </p>
            <pre className="mt-1.5 whitespace-pre-wrap font-sans text-sm leading-relaxed text-content-strong">
              {transcript || '—'}
            </pre>
          </div>
        ) : (
        <div className="relative">
          <OcrOverlay
            src={photo}
            chips={lines.map((l) => ({
              id: l.id,
              bbox: l.bbox,
              label: l.itemId ? byId.get(l.itemId)!.name : l.itemGuess,
              quantity: l.quantity,
              needsReview: !l.itemId || l.quantity <= 0,
            }))}
            className="h-56 w-full"
            showOverlay={showOverlay && !isDemo}
            activeId={activeId}
            onChipClick={(id) => {
              setActiveId(id);
              document.getElementById(`line-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          />
          {isDemo && (
            <span className="absolute bottom-2 left-2 rounded-md bg-content-strong/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
              Your photo &middot; not read
            </span>
          )}
        </div>
        )}

        <div className="mt-2 flex items-center justify-between">
          {isTyped ? (
            <span className="text-[11px] text-content-medium">Read from your text</span>
          ) : isDemo ? (
            <span className="text-[11px] text-content-medium">Sample rows below</span>
          ) : (
            <label className="flex items-center gap-2 text-[11px] text-content-medium">
              <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} className="accent-brand-600" />
              Show what was read
            </label>
          )}
          <span className="text-[11px] text-content-medium">{storeroomName}</span>
        </div>

        {/* Withdraw vs Dispose: prefilled from the note's own wording, always overridable. */}
        <div className="mt-4">
          <p className="text-xs font-semibold text-content-strong">These items were…</p>
          <div className="mt-2 flex gap-2">
            {(['WITHDRAW', 'DISPOSE'] as Action[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAction(value)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  action === value ? 'border-brand-600 bg-brand-50' : 'border-divider-medium bg-white'
                }`}
              >
                <span className={`block text-sm font-semibold ${action === value ? 'text-brand-600' : 'text-content-strong'}`}>
                  {ACTION_COPY[value].past}
                </span>
                <span className="mt-0.5 block text-[10px] leading-tight text-content-medium">
                  {ACTION_COPY[value].sentence}
                </span>
              </button>
            ))}
          </div>
        </div>

        {unresolved.length > 0 && (
          <p className="mt-4 rounded-lg bg-warning/30 px-3 py-2 text-[11px] text-content-strong">
            {unresolved.length} row{unresolved.length === 1 ? '' : 's'} need{unresolved.length === 1 ? 's' : ''} your
            confirmation before this can be submitted.
          </p>
        )}

        <ul className="mt-4 flex flex-col gap-2.5">
          {lines.map((line) => {
            const item = line.itemId ? byId.get(line.itemId) : undefined;
            const flagged = !line.itemId || line.quantity <= 0;
            const after = item ? item.quantity - line.quantity : null;

            return (
              <li
                key={line.id}
                id={`line-${line.id}`}
                onMouseEnter={() => setActiveId(line.id)}
                onMouseLeave={() => setActiveId(null)}
                className={`rounded-xl border bg-white p-3 transition-colors ${
                  flagged ? 'border-warning' : 'border-divider-medium'
                } ${activeId === line.id ? 'ring-2 ring-brand-600/30' : ''}`}
              >
                <p className="text-[10px] uppercase tracking-wide text-content-medium">
                  {isDemo ? 'Sample row · ' : 'Written: '}
                  &ldquo;{line.rawText}&rdquo;
                  {!isDemo && line.confidence > 0 && ` · ${Math.round(line.confidence * 100)}% sure`}
                </p>

                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={line.itemId ?? ''}
                    onChange={(e) => patch(line.id, { itemId: e.target.value || null })}
                    className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-base ${
                      line.itemId ? 'border-divider-medium text-content-strong' : 'border-warning text-content-medium'
                    }`}
                  >
                    <option value="">Pick an item…</option>
                    {catalogue.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>

                  <div className="flex shrink-0 items-center rounded-lg border border-divider-medium">
                    <button type="button" aria-label="Decrease" onClick={() => patch(line.id, { quantity: Math.max(0, line.quantity - 1) })} className="px-2.5 py-2 text-content-medium">−</button>
                    <input
                      type="number" min={0} inputMode="numeric" value={line.quantity}
                      onChange={(e) => patch(line.id, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-11 border-x border-divider-medium py-2 text-center text-base font-semibold"
                    />
                    <button type="button" aria-label="Increase" onClick={() => patch(line.id, { quantity: line.quantity + 1 })} className="px-2.5 py-2 text-content-medium">+</button>
                  </div>
                </div>

                {item && line.quantity > 0 && (
                  <p className="mt-2 text-[11px] text-content-medium">
                    {item.quantity} → <strong className={`font-semibold ${after! < 0 ? 'text-critical' : 'text-content-strong'}`}>{after}</strong>{' '}
                    {item.unit}{after === 1 ? '' : 's'} in stock after this
                    {after! < 0 && ' · more than the storeroom holds'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {lines.length === 0 && (
          <p className="mt-6 rounded-xl border border-dashed border-divider-strong p-6 text-center text-sm text-content-medium">
            Nothing legible was found on that photo. Go back and retake it with the list flat and well lit.
          </p>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-divider-medium bg-white/95 px-5 pb-[calc(1.5rem+var(--safe-b))] pt-3 backdrop-blur">
        {error && <p className="mb-2 text-xs text-critical">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={submitting || ready.length === 0 || unresolved.length > 0}
          className="w-full rounded-full bg-brand-600 py-4 text-base font-semibold text-white disabled:bg-divider-strong"
        >
          {submitting ? 'Submitting…' : `Confirm ${copy.noun} of ${ready.length} item${ready.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </>
  );
}
