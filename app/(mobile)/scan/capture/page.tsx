'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatusBar } from '@/components/PhoneFrame';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScanModePill } from '@/components/ScanModePill';
import { Icon } from '@/components/Icon';
import { isReason } from '@/lib/constants';

/**
 * A small JPEG of the shot, made in the browser.
 *
 * When the app runs somewhere with no file storage, this thumbnail is what gets kept as
 * the evidence image - so the capture flow works with a database and nothing else. The
 * full-resolution photo is still what the model reads; it just isn't stored.
 */
async function makeThumbnail(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const width = 420;
    const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const url = canvas.toDataURL('image/jpeg', 0.6);
    // Guard against a runaway data URL ending up in a database row.
    return url.length < 260_000 ? url : null;
  } catch {
    return null;
  }
}

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unavailable';

/** "Capture List" - Figma node 8792:28616. */
function CaptureInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reasonParam = params.get('reason');
  const reason = isReason(reasonParam) ? reasonParam : 'EMERGENCY';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [camera, setCamera] = useState<CameraState>('idle');
  const [readingLive, setReadingLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCamera('live');
    } catch (err) {
      // getUserMedia also rejects on plain http:// - which is the usual reason this
      // fails when someone opens the dev server from their phone.
      const insecure = typeof window !== 'undefined' && !window.isSecureContext;
      setCamera(insecure ? 'unavailable' : 'denied');
      if (insecure) {
        setError('The camera needs HTTPS. Run `npm run dev:https`, or use "Choose a photo" below.');
      } else if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Camera permission was declined. You can still pick a photo below.');
      } else {
        setError('No camera available on this device. You can still pick a photo below.');
      }
    }
  }, []);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  // Tell people the photo won't be read BEFORE they bother taking one.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/read')
      .then((r) => (r.ok ? r.json() : null))
      .then((info: { live?: boolean } | null) => {
        if (!cancelled) setReadingLive(Boolean(info?.live));
      })
      .catch(() => {
        if (!cancelled) setReadingLive(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = useCallback(
    async (blob: Blob, filename: string, sample?: string) => {
      setBusy(true);
      setError(null);
      try {
        const thumbnail = await makeThumbnail(blob);

        const form = new FormData();
        form.append('photo', new File([blob], filename, { type: blob.type || 'image/jpeg' }));
        form.append('reason', reason);
        if (sample) form.append('sample', sample);
        if (thumbnail) form.append('thumbnail', thumbnail);

        const response = await fetch('/api/captures', { method: 'POST', body: form });
        const data = (await response.json()) as { id?: string; error?: string };
        if (!response.ok || !data.id) throw new Error(data.error ?? 'Could not read that photo');

        stopCamera();
        router.push(`/scan/review/${data.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that photo');
        setBusy(false);
      }
    },
    [reason, router, stopCamera],
  );

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || camera !== 'live') return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) await upload(blob, 'capture.jpg');
  }, [camera, upload]);

  const useSample = useCallback(async () => {
    // Lets the flow be demoed on a laptop with no camera, and gives testers a known note.
    const response = await fetch('/samples/withdraw-basic.png');
    await upload(await response.blob(), 'withdraw-basic.png', 'withdraw-basic');
  }, [upload]);

  return (
    <>
      <StatusBar />
      <ScreenHeader title="Capture List" onBack={() => { stopCamera(); router.push('/scan'); }} />

      <div className="flex flex-1 flex-col items-center justify-between px-6 pb-6 pt-4">
        {readingLive === false && (
          <div role="status" className="mb-3 w-full rounded-xl border-2 border-warning bg-warning/25 px-3.5 py-2.5 text-[12px] leading-snug text-content-strong">
            <span className="font-bold">Handwriting reading is off.</span> No API key is set on this
            deployment, so whatever you photograph will not be read &mdash; you&rsquo;ll get a fixed
            sample list instead, clearly marked.
          </div>
        )}
        <div className="relative flex h-[380px] w-full items-center justify-center overflow-hidden rounded-3xl bg-[#121316]">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`absolute inset-0 size-full object-cover ${camera === 'live' ? 'opacity-100' : 'opacity-0'}`}
          />
          {/* The dashed alignment frame from the design. */}
          <div className="pointer-events-none relative flex size-[260px] items-center justify-center rounded-2xl border border-dashed border-brand-50">
            {camera === 'live' ? (
              <span className="absolute inset-x-6 h-0.5 animate-scan-sweep rounded-full bg-brand-50/80" />
            ) : (
              <Icon name="scan-line" size={40} />
            )}
          </div>
          {camera === 'starting' && (
            <p className="absolute bottom-4 text-xs text-white/70">Starting camera…</p>
          )}
        </div>

        <p className="px-2 text-center text-sm leading-5 text-content-medium">
          {camera === 'live'
            ? 'Position the item list within the frame'
            : (error ?? 'Position the item list within the frame')}
        </p>

        <div className="flex w-full flex-col items-center gap-3">
          <button
            type="button"
            onClick={camera === 'live' ? shoot : () => fileRef.current?.click()}
            disabled={busy}
            aria-label={camera === 'live' ? 'Take photo' : 'Choose a photo'}
            className="flex size-[76px] items-center justify-center rounded-full border-[5px] border-brand-600 p-1 disabled:opacity-50"
          >
            <span className="flex size-14 items-center justify-center rounded-full border border-[#ededed] bg-white shadow-shutter">
              {busy && <span className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />}
            </span>
          </button>

          <p className="text-[11px] text-content-medium">
            {busy ? 'Reading your handwriting…' : (
              <>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="font-semibold text-brand-600 underline">
                  Choose a photo
                </button>
                {' · '}
                <button type="button" onClick={useSample} disabled={busy} className="font-semibold text-brand-600 underline">
                  Use a sample note
                </button>
              </>
            )}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file, file.name);
            }}
          />
        </div>

        <ScanModePill active="photo" />
      </div>
    </>
  );
}

export default function CapturePage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-content-medium">Loading…</div>}>
      <CaptureInner />
    </Suspense>
  );
}
