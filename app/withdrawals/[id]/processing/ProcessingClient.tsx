'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

type Status = 'pending' | 'running' | 'succeeded' | 'failed';

/**
 * Kick off the reading, then poll for it.
 *
 * Both calls are safe to repeat: the extract endpoint is a compare-and-set, and the
 * status endpoint is a read. Nothing here holds the submission — it exists in the
 * database already, which is what lets this screen say "you can leave this page" and
 * mean it.
 */
export function ProcessingClient({
  submissionId,
  locationName,
  initialStatus,
  initialError,
}: {
  submissionId: string;
  locationName: string;
  initialStatus: Status;
  initialError: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [error, setError] = useState<string | null>(initialError);
  const [retrying, setRetrying] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    await fetch(`/api/withdrawals/${submissionId}/extract`, { method: 'POST' }).catch(() => undefined);
  }, [submissionId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialStatus === 'pending' || initialStatus === 'failed') void start();
  }, [initialStatus, start]);

  useEffect(() => {
    if (status === 'succeeded' || status === 'failed') return;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/withdrawals/${submissionId}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as { extractionStatus: Status; error: string | null };
        setStatus(data.extractionStatus);
        setError(data.error);
        if (data.extractionStatus === 'succeeded') {
          router.replace(`/withdrawals/${submissionId}/review`);
        }
      } catch {
        // A dropped poll is not an error worth showing. The next tick tries again.
      }
    }, 1200);

    return () => clearInterval(timer);
  }, [status, submissionId, router]);

  async function retry() {
    setRetrying(true);
    setError(null);
    setStatus('pending');
    await start();
    setRetrying(false);
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col gap-4">
        <div className="card p-5">
          <h2 className="text-lg font-bold">We could not read this photo</h2>
          <p className="mt-2 text-ink-muted">
            Your submission is saved — the photo has not been lost. You can try reading it again, or send
            it to supply review for a person to work through.
          </p>
          {error ? (
            <div className="mt-3 rounded-xl bg-canvas-sunken p-3">
              <p className="text-sm font-semibold text-ink">What went wrong</p>
              <p className="mt-1 break-words text-sm text-ink-muted">{error}</p>
              <p className="mt-2 text-xs text-ink-subtle">
                If this mentions a missing key or database, open <code>/api/health</code> — it names
                exactly what is not set up.
              </p>
            </div>
          ) : null}
        </div>
        <button type="button" className="btn-primary w-full" onClick={retry} disabled={retrying}>
          {retrying ? 'Trying again…' : 'Try reading it again'}
        </button>
        <Link href={`/withdrawals/${submissionId}/review`} className="btn-secondary w-full">
          Open it anyway
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div
        className="h-14 w-14 animate-spin rounded-full border-4 border-line border-t-brand-600"
        role="progressbar"
        aria-label="Reading your photo"
      />
      <div>
        <h2 className="text-lg font-bold">Reading your photo</h2>
        <p className="mt-1 text-ink-muted">{locationName}</p>
      </div>
      <div className="card w-full p-4 text-left text-sm text-ink-muted">
        <p className="font-semibold text-ink">You can leave this screen.</p>
        <p className="mt-1">
          Your photo is saved. Nothing has been deducted from stock, and nothing will be until you confirm
          a summary yourself.
        </p>
      </div>
      <Link href="/withdrawals/new" className="btn-quiet">
        Record another withdrawal
      </Link>
    </div>
  );
}
