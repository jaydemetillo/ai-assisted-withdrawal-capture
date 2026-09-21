/**
 * Shown wherever a reading came from the offline mock.
 *
 * Not dismissible, not subtle, and present on every screen that displays mock output. A
 * demo that looks like it is reading handwriting when it is replaying a fixture is the
 * most damaging thing this prototype could do to somebody's judgement about it.
 */
export function MockBadge({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border-2 border-stop-600/40 bg-stop-50 p-4 text-stop-900 ${className}`}
      role="alert"
    >
      <p className="flex items-center gap-2 text-base font-bold">
        <span aria-hidden>⚠</span> Your photo was not read
      </p>
      <p className="mt-1.5 text-sm">
        This deployment is using the offline <strong>sample reader</strong>. It replays one of three
        fixed notes whatever you photograph, so <strong>everything below is invented</strong> and has
        nothing to do with your image. Do not confirm it as a real withdrawal.
      </p>
      <p className="mt-2 text-sm">
        To read real handwriting, set{' '}
        <code className="rounded bg-stop-600/10 px-1">EXTRACTION_PROVIDER=anthropic</code> and{' '}
        <code className="rounded bg-stop-600/10 px-1">ANTHROPIC_API_KEY</code>, ticking every
        environment.
      </p>
    </div>
  );
}
