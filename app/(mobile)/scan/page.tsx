'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatusBar } from '@/components/PhoneFrame';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScanModePill } from '@/components/ScanModePill';
import { REASON_LABELS, REASONS, type Reason } from '@/lib/constants';

/**
 * "Why are you taking a photo of the list?" - Figma node 8792:28573.
 *
 * The reason is captured before the camera opens, not after, because it is the thing
 * people skip once they have the photo they came for.
 */
export default function ScanReasonPage() {
  const router = useRouter();
  const [reason, setReason] = useState<Reason>('EMERGENCY');

  return (
    <>
      <StatusBar />
      <ScreenHeader title="Photo Mode" onBack={() => router.push('/')} />

      <div className="flex flex-1 flex-col px-6 pb-[calc(1.5rem+var(--safe-b))]">
        <h2 className="text-base text-content-strong">Why are you taking a photo of the list?</h2>

        <fieldset className="mt-16 flex flex-col gap-3">
          <legend className="sr-only">Reason for capturing this list</legend>
          {REASONS.map((value) => {
            const selected = reason === value;
            const copy = REASON_LABELS[value];
            return (
              <label
                key={value}
                className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3.5 transition-colors ${
                  selected ? 'border-brand-600 bg-brand-50' : 'border-divider-medium bg-white'
                }`}
              >
                <span className="flex flex-col">
                  <span className={`text-base ${selected ? 'font-medium text-brand-600' : 'text-content-strong'}`}>
                    {copy.title}
                  </span>
                  <span className="mt-0.5 text-xs text-content-medium">{copy.blurb}</span>
                </span>
                <input
                  type="radio"
                  name="reason"
                  value={value}
                  checked={selected}
                  onChange={() => setReason(value)}
                  className="size-6 accent-brand-600"
                />
              </label>
            );
          })}
        </fieldset>

        <button
          type="button"
          onClick={() => router.push(`/scan/capture?reason=${reason}`)}
          className="mt-12 w-full rounded-full bg-brand-600 py-4 text-base font-semibold text-white transition-opacity active:opacity-80"
        >
          Continue
        </button>

        <div className="mt-auto flex justify-center pt-8">
          <ScanModePill active="photo" />
        </div>
      </div>
    </>
  );
}
