'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { StatusBar } from '@/components/PhoneFrame';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScanModePill } from '@/components/ScanModePill';
import { Icon } from '@/components/Icon';
import { isReason } from '@/lib/constants';
import {
  deviceReaderSupported,
  prewarmDeviceReader,
  readOnDevice,
  type ReadProgress,
} from '@/lib/ocr/device';
import { looksLikeAnItemLine, type DeviceLine } from '@/lib/ocr/device-text';

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

/**
 * What the screen is doing.
 *
 *  framing  - the camera is up, waiting for a photo
 *  reading  - the phone is reading the photo it just took
 *  checking - it has read something and is showing it back to be confirmed or fixed
 *  sending  - the confirmed list is being turned into a draft capture
 */
type Phase = 'framing' | 'reading' | 'checking' | 'sending';

type Shot = {
  prepared: PreparedPhoto;
  /** Something to show the photo back with while the list is checked. */
  preview: string;
  /** Set when this came from the bundled sample rather than a camera. */
  sampleSlug?: string;
};

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
  const objectUrlRef = useRef<string | null>(null);

  const [camera, setCamera] = useState<CameraState>('idle');
  const [readingLive, setReadingLive] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('framing');
  const [progress, setProgress] = useState<ReadProgress | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [readText, setReadText] = useState('');
  const [readLines, setReadLines] = useState<DeviceLine[]>([]);
  const [engine, setEngine] = useState<string | null>(null);
  const [readerBroke, setReaderBroke] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /**
   * Let go of the camera once a photo has been taken.
   *
   * The reading and the check step can take a while, and holding a live stream through
   * them keeps the lens light on and the battery draining for no reason. Retaking starts
   * it again.
   */
  const pauseCamera = useCallback(() => {
    stopCamera();
    setCamera('idle');
  }, [stopCamera]);

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

  /**
   * Start fetching the reader while the person is still lining up the shot.
   *
   * It is about 6.8MB the first time. Downloading it after the shutter would put those
   * seconds in front of someone who is standing at a storeroom shelf waiting; doing it
   * now means it is usually already there.
   */
  useEffect(() => {
    prewarmDeviceReader();
  }, []);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  // Whether the server could ALSO read a photo with a paid vision call. Only used to
  // decide what to say when the on-device reader cannot run at all.
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

  /** Turn the confirmed text and the photo into a draft capture. */
  const send = useCallback(
    async (current: Shot, text: string, lines: DeviceLine[], usedEngine: string | null) => {
      setPhase('sending');
      setError(null);
      try {
        const form = new FormData();
        form.append(
          'photo',
          new File([current.prepared.upload], current.prepared.filename, {
            type: current.prepared.upload.type || 'image/jpeg',
          }),
        );
        form.append('reason', reason);
        if (current.prepared.thumbnail) form.append('thumbnail', current.prepared.thumbnail);

        if (text.trim()) {
          form.append('text', text);
          form.append('read', JSON.stringify(lines));
          if (usedEngine) form.append('engine', usedEngine);
        } else if (current.sampleSlug) {
          // Nothing was read and this is the bundled sample, so the server can fall back
          // to the fixture for that note - which the review screen labels as a fixture.
          form.append('sample', current.sampleSlug);
        }

        const response = await fetch('/api/captures', { method: 'POST', body: form });
        const data = (await response.json()) as { id?: string; error?: string };
        if (!response.ok || !data.id) throw new Error(data.error ?? 'Could not record that list');

        stopCamera();
        router.push(`/scan/review/${data.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record that list');
        setPhase('checking');
      }
    },
    [reason, router, stopCamera],
  );

  /**
   * Read a photo on this phone, then show what it read.
   *
   * The check step is not politeness, it is the thing that makes a free reader usable:
   * the engine reads words, not meaning, so `Masks` can come back as `Maske`. Two
   * seconds of looking at the text - and a tap to fix a letter - is the difference
   * between a reader that mostly works and one nobody trusts.
   */
  const readAndCheck = useCallback(
    async (current: Shot) => {
      setShot(current);
      setReadText('');
      setReadLines([]);
      setError(null);

      if (!deviceReaderSupported()) {
        setReaderBroke(true);
        setPhase('checking');
        return;
      }

      setPhase('reading');
      setProgress({ stage: 'loading', percent: 0, label: 'Getting the reader ready' });
      try {
        const reading = await readOnDevice(current.prepared.upload, setProgress);
        setReadText(reading.text);
        setReadLines(reading.lines);
        setEngine(reading.engine);
        setReaderBroke(false);
        setPhase('checking');
      } catch (err) {
        // The reader could not run - no signal on the first use, or a browser without
        // WebAssembly. Say so and let them type it; do not pretend to have read it.
        console.error('[device-ocr]', err);
        setReaderBroke(true);
        // A key IS configured on the server, so there is a paid reader to fall back to.
        // Only in that case is uploading an unread photo worth doing.
        if (readingLive === true) {
          await send(current, '', [], null);
          return;
        }
        setPhase('checking');
      }
    },
    [readingLive, send],
  );

  const capture = useCallback(
    async (blob: Blob, filename: string, sampleSlug?: string) => {
      setPhase('reading');
      setProgress({ stage: 'loading', percent: 0, label: 'Preparing the photo' });
      try {
        const prepared = await preparePhoto(blob, filename);
        pauseCamera();
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        let preview = prepared.thumbnail;
        if (!preview) {
          preview = URL.createObjectURL(prepared.upload);
          objectUrlRef.current = preview;
        }
        await readAndCheck({ prepared, preview, sampleSlug });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not use that photo');
        setPhase('framing');
      }
    },
    [pauseCamera, readAndCheck],
  );

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset the input so picking the same file twice still fires a change event.
      event.target.value = '';
      if (file) void capture(file, file.name);
    },
    [capture],
  );

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || camera !== 'live') return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) await capture(blob, 'capture.jpg');
  }, [camera, capture]);

  const useSample = useCallback(async () => {
    // Lets the flow be demoed on a laptop with no camera, and gives testers a known note.
    // It goes through the same on-device read as a real photo - the note is a real image
    // of handwriting, so there is no reason to fake the reading of it.
    const response = await fetch('/samples/withdraw-basic.png');
    await capture(await response.blob(), 'withdraw-basic.png', 'withdraw-basic');
  }, [capture]);

  const retake = useCallback(() => {
    setShot(null);
    setReadText('');
    setReadLines([]);
    setReaderBroke(false);
    setError(null);
    setPhase('framing');
    if (!streamRef.current) void startCamera();
  }, [startCamera]);

  const recognisedCount = readText.split('\n').filter(looksLikeAnItemLine).length;
  const busy = phase === 'reading' || phase === 'sending';

  return (
    <>
      <StatusBar />
      <ScreenHeader
        title="Capture List"
        onBack={() => {
          stopCamera();
          router.push('/scan');
        }}
      />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-6 pb-[calc(1.5rem+var(--safe-b))] pt-4">
        {phase === 'framing' && (
          readerBroke && readingLive === false ? (
            <div role="status" className="w-full rounded-xl border-2 border-warning bg-warning/25 px-3.5 py-2.5 text-[12px] leading-snug text-content-strong">
              <span className="font-bold">This phone could not load the reader.</span> A photo will
              not be read here &mdash; you&rsquo;ll get a fixed sample list instead.{' '}
              <button
                type="button"
                onClick={() => router.push(`/scan/type?reason=${reason}`)}
                className="font-bold underline"
              >
                Type or paste the list
              </button>{' '}
              to record it for real.
            </div>
          ) : (
            <div className="w-full rounded-xl bg-brand-50 px-3.5 py-2.5 text-[12px] leading-snug text-content-strong">
              <span className="font-bold">This phone reads the handwriting itself.</span> Free, and
              the photo is read on the device rather than sent to an AI service. You check what it
              read before anything is recorded.
            </div>
          )
        )}

        {/* Square, because a stock list is written down a page rather than across it -
            a letterbox frame cut the bottom items out of shot. */}
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-3xl bg-[#121316]">
          {phase === 'framing' ? (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`absolute inset-0 size-full object-cover ${camera === 'live' ? 'opacity-100' : 'opacity-0'}`}
              />
              {/* The dashed alignment frame from the design, sized to the square. */}
              <div className="pointer-events-none relative flex size-[76%] items-center justify-center rounded-2xl border border-dashed border-brand-50">
                {camera === 'live' ? (
                  <span className="absolute inset-x-6 h-0.5 animate-scan-sweep rounded-full bg-brand-50/80" />
                ) : (
                  <Icon name="scan-line" size={40} />
                )}
              </div>
              {camera === 'starting' && (
                <p className="absolute bottom-4 text-xs text-white/70">Starting camera…</p>
              )}
            </>
          ) : (
            <>
              {shot?.preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shot.preview}
                  alt="The list you photographed"
                  className="absolute inset-0 size-full object-contain"
                />
              )}
              {phase === 'reading' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center">
                  <span className="size-8 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
                  <p className="text-sm font-semibold text-white">{progress?.label ?? 'Reading'}…</p>
                  <div className="h-1 w-40 overflow-hidden rounded-full bg-white/25">
                    <span
                      className="block h-full rounded-full bg-white transition-[width] duration-300"
                      style={{ width: `${progress?.percent ?? 0}%` }}
                    />
                  </div>
                  <p className="text-[11px] leading-snug text-white/70">
                    On this phone, offline. The first read also downloads the reader.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {phase === 'framing' && (
          <>
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
                <span className="flex size-14 items-center justify-center rounded-full border border-[#ededed] bg-white shadow-shutter" />
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
                  Already photographed your note? Pick it above.{' '}
                  <button
                    type="button"
                    onClick={() => router.push(`/scan/type?reason=${reason}`)}
                    className="font-semibold text-brand-600 underline"
                  >
                    Type or paste it instead
                  </button>
                  {' · '}
                  <button
                    type="button"
                    onClick={useSample}
                    className="font-semibold text-brand-600 underline"
                  >
                    Use a sample note
                  </button>
                </p>
              </div>
            </div>

            <ScanModePill active="photo" />
          </>
        )}

        {(phase === 'checking' || phase === 'sending') && (
          <div className="flex w-full flex-col gap-3">
            {readerBroke ? (
              <div role="status" className="rounded-xl border-2 border-warning bg-warning/25 px-3.5 py-2.5 text-[12px] leading-snug text-content-strong">
                <span className="font-bold">The reader could not run on this phone.</span> Nothing
                was read from your photo. Write the list out below and it will still be recorded
                against this photo.
              </div>
            ) : readText.trim() ? (
              <div className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-[12px] leading-snug text-content-strong">
                <span className="font-bold">Read on this phone.</span> Check it against your note
                and fix anything that came out wrong &mdash; a wrong letter is normal, a wrong
                number is not.
              </div>
            ) : (
              <div role="status" className="rounded-xl border-2 border-warning bg-warning/25 px-3.5 py-2.5 text-[12px] leading-snug text-content-strong">
                <span className="font-bold">Nothing legible was found.</span> Retake it with the
                note flat and well lit, or write the list out below.
              </div>
            )}

            <label className="text-xs font-semibold text-content-strong" htmlFor="read">
              What it read {recognisedCount > 0 && `· ${recognisedCount} line${recognisedCount === 1 ? '' : 's'} with a quantity`}
            </label>
            <textarea
              id="read"
              value={readText}
              onChange={(e) => setReadText(e.target.value)}
              rows={7}
              spellCheck={false}
              autoCapitalize="none"
              placeholder={'3x Masks\n4x Syringes\n5x Saline\n\nWithdrawn'}
              className="w-full rounded-xl border border-divider-medium bg-white p-3 text-base leading-relaxed text-content-strong placeholder:text-content-medium/60"
            />
            <p className="text-[11px] leading-snug text-content-medium">
              One item per line. Include <em>Withdrawn</em> or <em>Disposed</em> and it will pick the
              right one. You still confirm every row on the next screen before stock moves.
            </p>

            {error && <p className="text-xs text-critical">{error}</p>}

            <button
              type="button"
              onClick={() => shot && void send(shot, readText, readLines, engine)}
              disabled={phase === 'sending' || readText.trim().length === 0}
              className="w-full rounded-full bg-brand-600 py-4 text-base font-semibold text-white disabled:bg-divider-strong"
            >
              {phase === 'sending' ? 'Matching to the catalogue…' : 'Use this list'}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={retake}
                disabled={phase === 'sending'}
                className="flex-1 rounded-full border border-brand-600 bg-white py-3 text-sm font-semibold text-brand-600 disabled:opacity-50"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => shot && void readAndCheck(shot)}
                disabled={phase === 'sending' || !shot}
                className="flex-1 rounded-full border border-divider-strong bg-white py-3 text-sm font-semibold text-content-strong disabled:opacity-50"
              >
                Read it again
              </button>
            </div>
          </div>
        )}

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
