'use client';

import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';

export type ScanMode = 'qr' | 'barcode' | 'photo';

const MODES: { mode: ScanMode; icon: IconName; label: string; href: string }[] = [
  { mode: 'qr', icon: 'qr', label: 'Scan a QR code', href: '/scan/qr' },
  { mode: 'barcode', icon: 'qr-scan', label: 'Scan a barcode', href: '/scan/qr?mode=barcode' },
  { mode: 'photo', icon: 'camera', label: 'Photograph a written list', href: '/scan' },
];

/** The three-way switch pinned to the bottom of every scanning screen. */
export function ScanModePill({ active }: { active: ScanMode }) {
  const router = useRouter();

  return (
    <div className="flex h-12 w-[210px] items-center justify-center gap-1 rounded-full bg-brand-50 p-1">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          onClick={() => router.push(m.href)}
          aria-label={m.label}
          aria-pressed={active === m.mode}
          className={`flex h-full flex-1 items-center justify-center rounded-full p-2 transition-colors ${
            active === m.mode ? 'bg-brand-600' : ''
          }`}
        >
          <Icon
            name={m.icon}
            size={24}
            // The active tab sits on brand purple, so its glyph is inverted to white.
            style={active === m.mode ? { filter: 'brightness(0) invert(1)' } : undefined}
          />
        </button>
      ))}
    </div>
  );
}
