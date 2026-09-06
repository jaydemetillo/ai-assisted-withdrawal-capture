/**
 * Shown wherever rows came from the offline fixtures rather than from the photo.
 *
 * This is deliberately loud. An earlier version was a quiet footnote next to plausible
 * item rows drawn over the user's own handwriting, and testers reasonably read that as
 * the model confidently misreading their note. Nothing was read at all.
 */
export function DemoOcrBanner({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      className={`rounded-xl border-2 border-warning bg-warning/25 px-3.5 py-3 text-[12.5px] leading-snug text-content-strong ${className}`}
    >
      <p className="text-[13px] font-bold">Your photo was not read.</p>
      <p className="mt-1">
        No <code className="font-mono text-[11px]">ANTHROPIC_API_KEY</code> is set, so handwriting
        reading is switched off. The rows below are a fixed sample so you can still walk the
        flow &mdash; they have nothing to do with what you wrote.
      </p>
    </div>
  );
}
