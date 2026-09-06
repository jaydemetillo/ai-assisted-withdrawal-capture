import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';

/**
 * On a phone the app fills the screen. On a desktop browser it is drawn inside a 390x844
 * device shell so the mobile flow can be demoed and reviewed without a phone - which is
 * how most people will first see this.
 *
 * On a phone the shell is FIXED to the viewport rather than sized with `h-dvh`. A
 * 100dvh-tall element still leaves the document scrollable on iOS: the toolbar collapses
 * as you scroll and the page rubber-bands, so you can drag the whole app up and reveal
 * empty space under it. Taking the shell out of flow entirely leaves the document with
 * no height to scroll, and only the inner content scrolls - which is how a native screen
 * behaves.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="bg-canvas-alt md:flex md:min-h-dvh md:items-center md:justify-center md:py-8">
      <div
        className="
          fixed inset-0 flex flex-col overflow-hidden bg-canvas-alt
          md:relative md:inset-auto md:h-[844px] md:w-[390px] md:rounded-4xl
          md:border md:border-divider-strong md:shadow-2xl md:[--safe-b:0px]
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
