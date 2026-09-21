'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { prepareForUpload } from '@/lib/client-image';
import { MOCK_SCENARIO_LABELS, MOCK_SCENARIOS, type MockScenario } from '@/lib/extraction/scenarios';

type Location = { id: string; code: string; name: string };

/**
 * The capture form.
 *
 * Two large actions — take a photo, or choose one — and a location that is already
 * chosen. Submission is possible the moment a photo exists. The privacy instruction is
 * permanent and sits above the camera button, where it is read before the photo is taken
 * rather than after.
 */
export function NewSubmissionForm({
  locations,
  defaultLocationId,
  isMock,
}: {
  locations: Location[];
  defaultLocationId: string;
  isMock: boolean;
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [locationId, setLocationId] = useState(defaultLocationId);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scenario, setScenario] = useState<MockScenario>('high_confidence');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choosePhoto(next: File | null) {
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // Re-encoded on the phone: HEIC becomes JPEG, and an 8 MB photo becomes one that a
    // serverless upload limit will accept.
    const prepared = next ? await prepareForUpload(next) : null;
    setFile(prepared);
    setPreviewUrl(prepared ? URL.createObjectURL(prepared) : null);
  }

  async function submit() {
    if (!file || !locationId || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const body = new FormData();
      body.set('locationId', locationId);
      body.set('photo', file);
      if (isMock) body.set('demoScenario', scenario);

      const response = await fetch('/api/withdrawals', { method: 'POST', body });
      const data = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !data.id) {
        setError(data.error ?? 'That did not send. Please try again.');
        setSubmitting(false);
        return;
      }
      router.push(`/withdrawals/${data.id}/processing`);
    } catch {
      setError('That did not send. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-32">
      <section className="card p-4">
        <label className="label" htmlFor="location">
          Location
        </label>
        <select
          id="location"
          className="field mt-2"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name} ({location.code})
            </option>
          ))}
        </select>
      </section>

      <section className="card p-4">
        <h2 className="text-base font-bold">Photo</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Photograph the supply note, used-pack label, or the items themselves.{' '}
          <strong className="font-semibold text-ink">Do not include patient information.</strong>
        </p>

        {previewUrl ? (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="The photo you are about to send"
              className="aspect-square w-full rounded-xl border border-line object-cover"
            />
            <button type="button" className="btn-quiet mt-2 w-full" onClick={() => choosePhoto(null)}>
              Remove photo
            </button>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" className="btn-primary" onClick={() => cameraRef.current?.click()}>
            Take photo
          </button>
          <button type="button" className="btn-secondary" onClick={() => libraryRef.current?.click()}>
            Upload photo
          </button>
        </div>

        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => void choosePhoto(event.target.files?.[0] ?? null)}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => void choosePhoto(event.target.files?.[0] ?? null)}
        />
      </section>

      {isMock ? (
        <section className="rounded-2xl border border-warn-600/30 bg-warn-50 p-4">
          <h2 className="text-sm font-bold text-warn-900">Demo mode — choose what the reader will return</h2>
          <p className="mt-1 text-sm text-warn-900/80">
            No handwriting is read in this build. Pick which sample reading to replay, so you can walk
            through each case.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {MOCK_SCENARIOS.map((option) => (
              <label
                key={option}
                className="flex min-h-tap cursor-pointer items-start gap-3 rounded-xl border border-warn-600/20 bg-canvas px-3 py-2"
              >
                <input
                  type="radio"
                  name="scenario"
                  className="mt-1"
                  checked={scenario === option}
                  onChange={() => setScenario(option)}
                />
                <span className="text-sm">
                  <span className="block font-semibold">{MOCK_SCENARIO_LABELS[option].title}</span>
                  <span className="text-ink-muted">{MOCK_SCENARIO_LABELS[option].note}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-stop-600/30 bg-stop-50 px-4 py-3 text-sm text-stop-900" role="alert">
          {error}
        </p>
      ) : null}

      <div
        className="fixed inset-x-0 bottom-0 border-t border-line bg-canvas/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + var(--safe-b))' }}
      >
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!file || !locationId || submitting}
            onClick={submit}
          >
            {submitting ? 'Sending…' : 'Submit photo'}
          </button>
          <p className="mt-2 text-center text-xs text-ink-subtle">
            Nothing is deducted yet. You will confirm a short summary next.
          </p>
        </div>
      </div>
    </div>
  );
}
