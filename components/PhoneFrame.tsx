import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/**
 * On a phone the app fills the screen. On a desktop browser it is drawn inside a 390x844
 * device shell so the mobile flow can be demoed and reviewed without a phone - which is
 * how most people will first see this.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full bg-canvas-alt md:flex md:items-center md:justify-center md:py-8">
      <div
        className="
          relative flex h-dvh w-full flex-col overflow-hidden bg-canvas-alt
          md:h-[844px] md:w-[390px] md:rounded-4xl md:border md:border-divider-strong md:shadow-2xl
          md:[--safe-b:0px]
        "
      >
        {children}
      </div>
    </div>
  );
}

/** The iOS-style status bar from the Figma frames. Decorative only. */
export function StatusBar({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <div
      className={`flex h-11 shrink-0 items-center justify-between px-6 ${
        tone === 'light' ? 'text-white' : 'text-black'
      }`}
    >
      <span className="text-[15px] font-semibold">9:41</span>
      <span className="flex items-center gap-1.5">
        <Icon name="ios-signal" size={18} />
        <Icon name="ios-wifi" size={18} />
        <Icon name="ios-battery" size={18} style={{ width: 25 }} />
      </span>
    </div>
  );
}
