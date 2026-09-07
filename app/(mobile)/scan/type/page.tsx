'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatusBar } from '@/components/PhoneFrame';
import { ScreenHeader } from '@/components/ScreenHeader';
import { isReason } from '@/lib/constants';

/**
 * The list as text rather than as a photograph.
 *
 * Photographing the note is free too now - the capture screen reads it on the phone - so
 * this is the fallback rather than the only way to avoid paying: for a note the reader
 * cannot make out, for a browser that cannot run it, or for someone who would simply
 * rather type. Same parser, same review gate, same ledger on the other side.
 */
function TypeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reasonParam = params.get('reason');
  const reason = isReason(reasonParam) ? reasonParam : 'EMERGENCY';

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/captures/typed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reason }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? 'Could not read that list');
      router.push(`/scan/review/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that list');
      setBusy(false);
    }
  }

  return (
    <>
      <StatusBar />
      <ScreenHeader title="Type the list" onBack={() => router.push(`/scan/capture?reason=${reason}`)} />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-[calc(1.5rem+var(--safe-b))]">
        <div className="rounded-xl bg-brand-50 px-3.5 py-3 text-[12.5px] leading-snug text-content-strong">
          <p className="font-semibold">Already photographed the note?</p>
          <p className="mt-1">
            Go back and pick it from your photo library &mdash; the app reads the handwriting on
            this phone, for nothing. Or open it in Photos, tap the text-selection button in the
            corner, and paste it here instead.
          </p>
        </div>

        <label className="text-xs font-semibold text-content-strong" htmlFor="list">
          One item per line
        </label>
        <textarea
          id="list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          spellCheck={false}
          autoCapitalize="none"
          placeholder={'3x Masks\n4x Syringes\n5x Saline\n\nWithdrawn'}
          className="w-full rounded-xl border border-divider-medium bg-white p-3 text-base leading-relaxed text-content-strong placeholder:text-content-medium/60"
        />

        <p className="text-[11px] leading-snug text-content-medium">
          Quantities can be written any way you like &mdash; <em>3x Masks</em>, <em>Masks x 3</em>,{' '}
          <em>Syringe 10ml - 8</em>. Include <em>Withdrawn</em> or <em>Disposed</em> and it will pick
          the right one.
        </p>

        {error && <p className="text-xs text-critical">{error}</p>}
      </div>

      <div className="flex-none border-t border-divider-medium bg-white px-5 pb-[calc(1.5rem+var(--safe-b))] pt-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || text.trim().length === 0}
          className="w-full rounded-full bg-brand-600 py-4 text-base font-semibold text-white disabled:bg-divider-strong"
        >
          {busy ? 'Reading the list…' : 'Read this list'}
        </button>
      </div>
    </>
  );
}

export default function TypePage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-content-medium">Loading…</div>}>
      <TypeInner />
    </Suspense>
  );
}
