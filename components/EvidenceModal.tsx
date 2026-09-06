'use client';

import { useEffect } from 'react';
import { OcrOverlay, type OverlayChip } from '@/components/OcrOverlay';

/**
 * The photo, full size, with what the model read drawn over it - so an admin questioning
 * a row can see the original handwriting rather than take the number on trust.
 */
export function EvidenceModal({
  open, onClose, photo, chips, transcript, meta,
}: {
  open: boolean;
  onClose: () => void;
  photo: string;
  chips: OverlayChip[];
  transcript: string;
  meta: { reference: string; capturedBy: string; capturedAt: string; reason: string; provider: string; model: string };
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Stop the page behind the scrim from scrolling under the dialog.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Evidence for ${meta.reference}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 flex-[3] items-center justify-center bg-[#121316] p-4">
          <OcrOverlay src={photo} chips={chips} className="max-h-[80vh] w-full" />
        </div>

        <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-divider-medium p-5">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold text-brand-600">Evidence</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-content-medium hover:bg-canvas-alt">✕</button>
          </div>

          <dl className="mt-4 flex flex-col gap-2.5 text-[13px]">
            {[
              ['Transaction', meta.reference],
              ['Captured by', meta.capturedBy],
              ['When', meta.capturedAt],
              ['Stated reason', meta.reason],
              ['Read by', meta.provider === 'claude' ? meta.model : 'Demo fixture (no API key set)'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="shrink-0 text-content-medium">{label}</dt>
                <dd className="text-right font-medium text-content-strong">{value}</dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-5 text-[13px] font-semibold text-content-strong">What was written</h3>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-canvas-alt p-3 font-sans text-xs leading-relaxed text-content">
            {transcript || 'No transcript recorded.'}
          </pre>

          <h3 className="mt-5 text-[13px] font-semibold text-content-strong">Lines read</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {chips.map((chip) => (
              <li key={chip.id} className="flex items-center justify-between gap-2 rounded-lg bg-canvas-alt px-2.5 py-1.5 text-xs">
                <span className="min-w-0 truncate text-content-strong">{chip.label}</span>
                <span className={`shrink-0 font-semibold ${chip.needsReview ? 'text-content-medium' : 'text-brand-600'}`}>
                  {chip.quantity > 0 ? `x${chip.quantity}` : 'unread'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
