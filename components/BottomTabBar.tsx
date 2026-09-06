'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/Icon';

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Home', icon: 'home-alt' },
  { href: '/history', label: 'History', icon: 'history' },
  { href: '/scan', label: 'Scan', icon: 'scan' },
  { href: '/withdraw', label: 'Withdraw', icon: 'shopping-bag' },
  { href: '/support', label: 'Support', icon: 'help-circle' },
];

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="pointer-events-auto absolute inset-x-2.5 bottom-[calc(0.75rem+var(--safe-b))] z-20 flex h-[68px] items-center justify-between rounded-full bg-white px-2.5 shadow-sm2">
      {TABS.map((tab) => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex h-[50px] w-16 flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${
              active ? 'bg-brand-50' : ''
            }`}
          >
            <Icon name={tab.icon} size={24} />
            <span className={`text-[10px] font-semibold ${active ? 'text-brand-600' : 'text-content-medium'}`}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
