'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';

const MAIN: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin', label: 'Home', icon: 'home-alt' },
  { href: '/admin/history', label: 'History', icon: 'history' },
  { href: '/admin/reports', label: 'Reports', icon: 'file' },
  { href: '/admin/support', label: 'Support', icon: 'help-circle' },
  { href: '/admin/guide', label: 'Guide', icon: 'book-open' },
];

const ADMIN: { href: string; label: string; icon: IconName }[] = [
  { href: '/admin/inventory', label: 'Manage inventory', icon: 'layout' },
  { href: '/admin/storerooms', label: 'Storerooms', icon: 'sitemap' },
  { href: '/admin/teams', label: 'Teams', icon: 'user' },
  { href: '/admin/invites', label: 'Invites', icon: 'envelope-open' },
  { href: '/admin/settings', label: 'Settings', icon: 'cog' },
];

/** Desktop sidebar - Figma node 8349:19893. */
export function SidebarNav({ userName, initials }: { userName: string; initials: string }) {
  const pathname = usePathname();

  const item = (entry: { href: string; label: string; icon: IconName }) => {
    const active = entry.href === '/admin' ? pathname === '/admin' : pathname.startsWith(entry.href);
    return (
      <Link
        key={entry.href}
        href={entry.href}
        aria-current={active ? 'page' : undefined}
        className={`flex h-[38px] items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors ${
          active ? 'bg-brand-50 text-brand-600' : 'text-content-tertiary hover:bg-canvas-alt'
        }`}
      >
        <Icon name={entry.icon} size={18} />
        <span className={`text-sm ${active ? 'font-semibold' : 'font-medium'}`}>{entry.label}</span>
      </Link>
    );
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-divider-medium bg-white px-5 py-8 shadow-sm2">
      <div className="flex flex-col gap-6">
        <Link href="/admin" className="flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pulse-logo-lg.svg" alt="Pulse" className="h-[72px] w-40 object-contain" />
        </Link>

        <nav className="flex flex-col gap-2">
          {MAIN.map(item)}
          <hr className="my-2 border-divider-medium" />
          <p className="text-xs font-bold text-content-subtle">ADMIN TOOLS</p>
          {ADMIN.map(item)}
        </nav>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {initials}
          </span>
          <span className="text-[13px] font-semibold text-black">{userName}</span>
        </div>
        <Link href="/" className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-content-tertiary transition-colors hover:bg-canvas-alt">
          <Icon name="link-external" size={18} />
          <span className="text-sm font-medium">Consumer view</span>
        </Link>
      </div>
    </aside>
  );
}
