'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatusBar } from '@/components/PhoneFrame';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScanModePill } from '@/components/ScanModePill';
import { Icon } from '@/components/Icon';
import { isReason } from '@/lib/constants';

/**
 * Decode whatever the user gave us and re-encode it as JPEG before upload.
 *
 * This is not an optimisation, it is what makes the photo usable at all:
 *
 *  - iOS hands back HEIC from the photo library. The vision call only accepts PNG,
 *    JPEG, GIF and WebP, and most non-Safari browsers cannot decode HEIC either, so an
 *    untouched library pick can fail on the server and produce no thumbnail on the
 *    client - which is exactly how a capture ends up with no evidence photo.
 *  - A 12MP phone photo is several megabytes of upload for no extra legibility.
 *
 * Returns the full-size JPEG to be read, plus a small one to keep as evidence. If the
 * browser cannot decode the file at all we hand back the original and let the server
 * give a clear error rather than silently dropping the capture.
 */
type PreparedPhoto = { upload: Blob; filename: string; thumbnail: string | null };

async function decode(blob: Blob): Promise<HTMLImageElement | ImageBitmap | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through - Safari can refuse some sources here that <img> still handles.
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function toJpeg(
  source: HTMLImageElement | ImageBitmap,
  longestEdge: number,
  quality: number,
): { canvas: HTMLCanvasElement } | null {
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!sw || !sh) return null;
  const scale = Math.min(1, longestEdge / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  void quality;
  return { canvas };
}

async function preparePhoto(blob: Blob, filename: string): Promise<PreparedPhoto> {
  const source = await decode(blob);
  if (!source) return { upload: blob, filename, thumbnail: null };

  try {
    // Big enough for the model to read handwriting, small enough to upload on 4G.
    const full = toJpeg(source, 1600, 0.85);
    const small = toJpeg(source, 420, 0.6);
    if ('close' in source) source.close();
    if (!full || !small) return { upload: blob, filename, thumbnail: null };

    const upload = await new Promise<Blob | null>((resolve) =>
      full.canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    let thumbnail: string | null = null;
    try {
      const url = small.canvas.toDataURL('image/jpeg', 0.6);
      thumbnail = url.length < 260_000 ? url : null;
    } catch {
      thumbnail = null;
    }

    return {
      upload: upload ?? blob,
      filename: upload ? filename.replace(/\.[^.]+$/, '') + '.jpg' : filename,
      thumbnail,
    };
  } catch {
    return { upload: blob, filename, thumbnail: null };
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
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

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
        setError('The camera needs HTTPS. Run `npm run dev:https`, or pick a photo from your library below.');
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
        const prepared = await preparePhoto(blob, filename);

        const form = new FormData();
        form.append(
          'photo',
          new File([prepared.upload], prepared.filename, {
            type: prepared.upload.type || 'image/jpeg',
          }),
        );
        form.append('reason', reason);
        if (sample) form.append('sample', sample);
        if (prepared.thumbnail) form.append('thumbnail', prepared.thumbnail);

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

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so picking the same file twice still fires a change event.
      event.target.value = '';
      if (file) void upload(file, file.name);
    },
    [upload],
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

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center justify-between gap-4 overflow-y-auto px-6 pb-[calc(1.5rem+var(--safe-b))] pt-4">
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
            onClick={camera === 'live' ? shoot : () => cameraRef.current?.click()}
            disabled={busy}
            aria-label={camera === 'live' ? 'Take photo' : 'Take a photo'}
            className="flex size-[76px] items-center justify-center rounded-full border-[5px] border-brand-600 p-1 disabled:opacity-50"
          >
            <span className="flex size-14 items-center justify-center rounded-full border border-[#ededed] bg-white shadow-shutter">
              {busy && <span className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />}
            </span>
          </button>

          {/* Two equally reachable routes. The library one used to be a small underlined
              link next to the shutter and people simply did not see it - they tapped the
              obvious control, got the camera, and concluded the library was unavailable. */}
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              disabled={busy}
              className="w-full rounded-full border border-brand-600 bg-white py-3 text-sm font-semibold text-brand-600 disabled:opacity-50"
            >
              Choose from photo library
            </button>
            <p className="text-center text-[11px] text-content-medium">
              {busy ? (
                'Reading your handwriting…'
              ) : (
                <>
                  Already photographed your note? Pick it above.{' '}
                  <button
                    type="button"
                    onClick={useSample}
                    disabled={busy}
                    className="font-semibold text-brand-600 underline"
                  >
                    Use a sample note
                  </button>
                </>
              )}
            </p>
          </div>

          {/* `capture` forces the camera and hides the photo library, so the two paths
              need separate inputs: this one opens the camera... */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPick}
          />
          {/* ...and this one, with no `capture`, opens the OS picker so an existing
              photo of a note can be re-used instead of writing a new one every test. */}
          <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
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
