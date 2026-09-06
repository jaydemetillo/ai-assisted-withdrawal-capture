'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import jsQR from 'jsqr';
import { StatusBar } from '@/components/PhoneFrame';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScanModePill } from '@/components/ScanModePill';

type Detected = { value: string; format: string };

/**
 * QR / barcode mode.
 *
 * Uses the browser's native BarcodeDetector where it exists (Chrome on Android reads
 * QR *and* 1D barcodes with it), and falls back to jsQR decoding video frames on
 * canvas everywhere else - which covers iOS Safari, but QR codes only.
 */
function QrInner() {
  const router = useRouter();
  const mode = useSearchParams().get('mode') === 'barcode' ? 'barcode' : 'qr';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [detected, setDetected] = useState<Detected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeSupport, setNativeSupport] = useState<boolean | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (o?: { formats?: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string; format: string }[]> } }).BarcodeDetector;
      setNativeSupport(Boolean(BarcodeDetectorCtor));

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        setError(
          typeof window !== 'undefined' && !window.isSecureContext
            ? 'Scanning needs HTTPS. Run `npm run dev:https` or open the deployed URL.'
            : 'Could not open the camera.',
        );
        return;
      }

      const detector = BarcodeDetectorCtor
        ? new BarcodeDetectorCtor({ formats: mode === 'barcode' ? ['code_128', 'ean_13', 'code_39', 'itf'] : ['qr_code'] })
        : null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      async function tick() {
        const video = videoRef.current;
        if (!cancelled && video && video.readyState === video.HAVE_ENOUGH_DATA) {
          try {
            if (detector) {
              const hits = await detector.detect(video);
              if (hits[0]) { setDetected({ value: hits[0].rawValue, format: hits[0].format }); stop(); return; }
            } else if (ctx) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const hit = jsQR(frame.data, frame.width, frame.height);
              if (hit) { setDetected({ value: hit.data, format: 'qr_code' }); stop(); return; }
            }
          } catch {
            // A single bad frame is not worth stopping the loop for.
          }
        }
        if (!cancelled) rafRef.current = requestAnimationFrame(() => void tick());
      }
      void tick();
    }

    void run();
    return () => { cancelled = true; stop(); };
  }, [mode, stop]);

  return (
    <>
      <StatusBar />
      <ScreenHeader title={mode === 'barcode' ? 'Scan Barcode' : 'Scan QR'} onBack={() => { stop(); router.push('/'); }} />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center justify-between gap-4 overflow-y-auto px-6 pb-[calc(1.5rem+var(--safe-b))] pt-4">
        <div className="relative flex h-[380px] w-full items-center justify-center overflow-hidden rounded-3xl bg-[#121316]">
          <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
          <div className="pointer-events-none relative size-[260px] rounded-2xl border border-dashed border-brand-50" />
        </div>

        <div className="w-full text-center">
          {detected ? (
            <div className="rounded-xl border border-brand-600 bg-brand-50 p-4">
              <p className="text-[11px] uppercase tracking-wide text-content-medium">{detected.format}</p>
              <p className="mt-1 break-all text-sm font-semibold text-content-strong">{detected.value}</p>
              <p className="mt-2 text-[11px] text-content-medium">
                Codes are read here, but this prototype records stock from photographed lists.
                Switch to photo mode to log a withdrawal.
              </p>
              <button type="button" onClick={() => router.push('/scan')} className="mt-3 w-full rounded-full bg-brand-600 py-3 text-sm font-semibold text-white">
                Go to photo mode
              </button>
            </div>
          ) : (
            <p className="text-sm leading-5 text-content-medium">
              {error ?? `Point the camera at a ${mode === 'barcode' ? 'barcode' : 'QR code'}`}
              {nativeSupport === false && !error && (
                <span className="mt-1 block text-[11px]">
                  This browser has no barcode support, so only QR codes will scan.
                </span>
              )}
            </p>
          )}
        </div>

        <ScanModePill active={mode === 'barcode' ? 'barcode' : 'qr'} />
      </div>
    </>
  );
}

export default function QrPage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-content-medium">Loading…</div>}>
      <QrInner />
    </Suspense>
  );
}
