'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type { ItemRecognitionState } from '@/lib/vision/similarity';
import { prepareForUpload } from '@/lib/client-image';

export type ReferencePhotoView = {
  id: string;
  url: string;
  source: 'taught' | 'learned_from_correction';
  labelledByName: string | null;
  timesAgreed: number;
  timesOverruled: number;
  isActive: boolean;
  takenAt: string;
};

export type ItemRecognitionView = {
  id: string;
  displayName: string;
  sku: string;
  isRestricted: boolean;
  state: ItemRecognitionState;
  diversity: number;
  timesAgreed: number;
  timesOverruled: number;
  lookAlikes: string[];
  photos: ReferencePhotoView[];
};

/**
 * Every label on this screen is a statement about what the system CAN do, not a score.
 *
 * "Good" does not mean accurate and is not allowed to imply it — it means there are
 * enough varied photographs that a match is worth showing a person. The one number
 * anywhere on the page is the example count, which is a fact about the index rather
 * than a claim about the world.
 */
const STATE_LABEL: Record<ItemRecognitionState, { label: string; tone: string; blurb: string }> = {
  untaught: {
    label: 'No photos yet',
    tone: 'border-line-strong bg-canvas-sunken text-ink-muted',
    blurb: 'Photograph one to get started. One photo is enough to begin.',
  },
  learning: {
    label: 'Learning',
    tone: 'border-brand-600/30 bg-brand-50 text-brand-900',
    blurb: 'It has seen this, but not often enough or from enough angles to lean on.',
  },
  good: {
    label: 'Good',
    tone: 'border-ok-600/30 bg-ok-50 text-ok-900',
    blurb: 'Enough varied photos to make a useful suggestion. A person still confirms it.',
  },
  saturated: {
    label: 'As good as it gets',
    tone: 'border-line-strong bg-canvas-sunken text-ink-muted',
    blurb:
      'At the example limit, and every photo looks much like the others. More of the same will not improve it — a photo from a genuinely different angle might.',
  },
  confusable: {
    label: 'Looks like something else',
    tone: 'border-warn-600/30 bg-warn-50 text-warn-900',
    blurb:
      'Another item stocked here is not distinguishable from this one in a photograph. It will always ask rather than guess, and no number of extra photos changes that.',
  },
  stale: {
    label: 'Photos are old',
    tone: 'border-warn-600/30 bg-warn-50 text-warn-900',
    blurb:
      'Every example is over a year old. If the packaging has changed since, these are now actively misleading — take a fresh one.',
  },
};

const ORDER: ItemRecognitionState[] = ['confusable', 'stale', 'untaught', 'learning', 'saturated', 'good'];

export function RecognitionClient({
  locationId,
  locationName,
  items,
  canDelete,
  maxExamples,
  confidentExamples,
  provider,
}: {
  locationId: string;
  locationName: string;
  items: ItemRecognitionView[];
  canDelete: boolean;
  maxExamples: number;
  confidentExamples: number;
  provider: { ok: boolean; enabled: boolean; name: string; model: string; isDescriptorOnly: boolean; error: string | null };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const sorted = [...items].sort(
    (a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.displayName.localeCompare(b.displayName),
  );
  const untaught = items.filter((i) => i.state === 'untaught').length;
  const taught = items.length - untaught;

  async function teach(itemId: string, file: File) {
    setBusy(itemId);
    setError(null);

    const form = new FormData();
    form.set('photo', await prepareForUpload(file));
    form.set('itemId', itemId);
    form.set('locationId', locationId);

    const response = await fetch('/api/catalogue/reference-photos', { method: 'POST', body: form });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(data.error ?? 'That photo could not be added.');
      return;
    }
    router.refresh();
  }

  async function remove(photoId: string) {
    setBusy(photoId);
    setError(null);
    const response = await fetch(`/api/catalogue/reference-photos/${photoId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Removed from the recognition screen.' }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setError(data.error ?? 'That photo could not be removed.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <section className="card p-4">
        <h2 className="text-base font-bold">{locationName}</h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          {taught} of {items.length} items have reference photos here. Photographs taken at one
          location are never used at another — different bays stock different things.
        </p>

        {/* Stated up front rather than discovered in week six. */}
        <p className="mt-3 rounded-xl bg-canvas-sunken px-3 py-2 text-sm text-ink-muted">
          Recognising an item never moves stock on its own. However many photos it has seen, a
          line identified from a picture always waits for a person to confirm it.
        </p>

        {!provider.enabled ? (
          <p className="mt-3 rounded-xl border border-warn-600/30 bg-warn-50 px-3 py-2 text-sm text-warn-900">
            Visual recognition is switched off on this deployment. Existing photos are kept and
            nothing reads them.
          </p>
        ) : provider.error ? (
          <p className="mt-3 rounded-xl border border-stop-600/30 bg-stop-50 px-3 py-2 text-sm text-stop-900">
            {provider.error}
          </p>
        ) : provider.isDescriptorOnly ? (
          <p className="mt-3 rounded-xl border border-line bg-canvas-sunken px-3 py-2 text-sm text-ink-muted">
            Running on the built-in colour-and-shape fingerprint, which recognises the same pack
            photographed the same way. It does not know what a syringe is. Set{' '}
            <code className="font-mono text-xs">EMBEDDING_PROVIDER=transformers</code> for a
            trained vision model.
          </p>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-xl border border-stop-600/30 bg-stop-50 px-4 py-3 text-sm text-stop-900" role="alert">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        {sorted.map((item) => {
          const state = STATE_LABEL[item.state];
          const active = item.photos.filter((p) => p.isActive);
          const retired = item.photos.filter((p) => !p.isActive);
          const isOpen = open === item.id;

          return (
            <article key={item.id} className="card p-4" aria-busy={busy === item.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold leading-snug">{item.displayName}</h3>
                  <p className="mt-0.5 font-mono text-xs text-ink-subtle">{item.sku}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${state.tone}`}>
                  {state.label}
                </span>
              </div>

              <p className="mt-2 text-sm text-ink-muted">{state.blurb}</p>

              {item.lookAlikes.length > 0 ? (
                <p className="mt-2 text-sm text-warn-900">
                  Not separable from {item.lookAlikes.join(' or ')} by sight. Check the label.
                </p>
              ) : null}

              <p className="mt-2 text-xs text-ink-subtle">
                {active.length} of {maxExamples} photos
                {active.length > 0 && active.length < confidentExamples
                  ? ` · needs ${confidentExamples - active.length} more to read as settled`
                  : ''}
                {item.timesAgreed > 0 ? ` · agreed with ${item.timesAgreed}×` : ''}
                {item.timesOverruled > 0 ? ` · overruled ${item.timesOverruled}×` : ''}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TeachButton
                  itemId={item.id}
                  busy={busy === item.id}
                  full={active.length >= maxExamples}
                  onPick={(file) => void teach(item.id, file)}
                />
                {item.photos.length > 0 ? (
                  <button
                    type="button"
                    className="btn-quiet px-3 text-sm"
                    onClick={() => setOpen(isOpen ? null : item.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? 'Hide photos' : `Show ${item.photos.length} photos`}
                  </button>
                ) : null}
              </div>

              {isOpen ? (
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {item.photos.map((photo) => (
                    <figure
                      key={photo.id}
                      className={`overflow-hidden rounded-xl border border-line ${photo.isActive ? '' : 'opacity-50'}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
                      <figcaption className="px-2 py-1.5 text-xs text-ink-subtle">
                        {photo.source === 'taught' ? 'Taught' : 'Learned from a withdrawal'}
                        {photo.labelledByName ? ` by ${photo.labelledByName}` : ''}
                        {photo.timesOverruled > 0 ? (
                          <span className="block text-stop-900">overruled {photo.timesOverruled}×</span>
                        ) : null}
                        {!photo.isActive ? <span className="block font-semibold">not in use</span> : null}
                        {canDelete && photo.isActive ? (
                          <button
                            type="button"
                            className="mt-1 block font-semibold text-stop-900 underline"
                            disabled={busy === photo.id}
                            onClick={() => void remove(photo.id)}
                          >
                            Remove
                          </button>
                        ) : null}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}

              {isOpen && retired.length > 0 ? (
                <p className="mt-2 text-xs text-ink-subtle">
                  Faded photos are no longer used — removed by a reviewer, dropped at the example
                  limit, or quarantined after being overruled too often. They are kept so that
                  &ldquo;why did it stop recognising this?&rdquo; has an answer.
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}

/**
 * Teaching is one tap and a camera. `capture="environment"` opens the rear camera
 * straight away on a phone rather than a file picker — the difference between a thing
 * somebody does while standing at the cart and a thing somebody means to do later.
 */
function TeachButton({
  itemId,
  busy,
  full,
  onPick,
}: {
  itemId: string;
  busy: boolean;
  full: boolean;
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={input}
        id={`teach-${itemId}`}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onPick(file);
        }}
      />
      <button
        type="button"
        className="btn-secondary px-3 text-sm"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Saving…' : full ? 'Replace the least useful photo' : 'Photograph this item'}
      </button>
    </>
  );
}
