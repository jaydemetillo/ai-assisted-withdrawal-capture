'use client';

import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-5">
      <button
        type="button"
        onClick={onBack ?? (() => router.back())}
        aria-label="Go back"
        className="rounded-full p-2 transition-colors hover:bg-brand-50"
      >
        <Icon name="left-arrow-alt" size={24} />
      </button>
      <h1 className="text-xl font-semibold tracking-[-0.12px] text-brand-600">{title}</h1>
      <span className="size-10" aria-hidden />
    </header>
  );
}
