/**
 * Shown wherever a reading came from the offline fixtures rather than the model, so a
 * demo is never mistaken for a real read of real handwriting.
 */
export function DemoOcrBanner({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-lg bg-warning/30 px-3 py-2 text-[11px] leading-snug text-content-strong ${className}`}>
      <strong className="font-semibold">Demo reading.</strong> No <code>ANTHROPIC_API_KEY</code> is
      set, so these rows come from bundled sample data, not from your photo. Set a key to read real
      handwriting.
    </div>
  );
}
