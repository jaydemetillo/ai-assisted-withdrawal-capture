import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { hasUsableDatabase } from '@/lib/deployment';
import { currentUser, defaultStoreroom } from '@/lib/session';
import { StatusBar } from '@/components/PhoneFrame';
import { BottomTabBar } from '@/components/BottomTabBar';
import { Icon } from '@/components/Icon';

export const dynamic = 'force-dynamic';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

/** Mobile home - Figma node 8791:34509. */
export default async function MobileHome() {
  // Deployed with only an API key and no database: the standalone demo is the app.
  if (!hasUsableDatabase()) redirect('/demo.html');

  const [user, storeroom] = await Promise.all([currentUser(), defaultStoreroom()]);

  const levels = await prisma.stockLevel.findMany({
    where: { storeroomId: storeroom.id },
    include: { item: true },
  });

  const outOfStock = levels.filter((l) => l.quantity <= 0);
  const low = levels.filter((l) => l.quantity > 0 && l.quantity <= l.reorderLevel);
  const optimal = levels.filter((l) => l.quantity > l.reorderLevel);

  const expiring = levels
    .filter((l) => l.item.expiryDate && daysUntil(l.item.expiryDate) <= 60)
    .sort((a, b) => a.item.expiryDate!.getTime() - b.item.expiryDate!.getTime())
    .slice(0, 3);
  const expired = levels.filter((l) => l.item.expiryDate && daysUntil(l.item.expiryDate) < 0);

  const totalUnits = (rows: typeof levels) => rows.reduce((sum, l) => sum + Math.max(0, l.quantity), 0);

  // Donut geometry: three arcs on one circle, sized by share of total units.
  const buckets = [
    { label: 'Optimal stock', color: '#9c2fa7', units: totalUnits(optimal), count: optimal.length },
    { label: 'Low/Expiring soon', color: '#ffda68', units: totalUnits(low.concat(expiring)), count: low.length + expiring.length },
    { label: 'Expired/Out of stock', color: '#ee8080', units: Math.max(totalUnits(outOfStock), 1), count: outOfStock.length + expired.length },
  ];
  const grandTotal = buckets.reduce((s, b) => s + b.units, 0) || 1;
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const latest = await prisma.transaction.findFirst({
    where: { voided: false },
    orderBy: { createdAt: 'desc' },
    include: { user: true, storeroom: true },
  });

  return (
    <>
      <div className="shrink-0 bg-white/50 shadow-header">
        <StatusBar />
        <div className="flex h-[50px] items-center justify-between px-4">
          <Icon name="menu" size={24} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/pulse-logo.svg" alt="Pulse" className="h-[38px] w-[78px] object-contain" />
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(7rem+var(--safe-b))] pt-4">
        <h1 className="text-2xl font-bold text-brand-600">
          {greeting()}, {user.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-content">
          Here is your overview for <strong className="font-bold">{storeroom.hospital}</strong>.
        </p>

        <h2 className="mt-6 text-sm font-bold text-brand-600">Quick actions</h2>
        <div className="mt-2 flex gap-2">
          <Link
            href="/scan"
            className="flex h-[90px] w-[114px] flex-col items-center gap-2 rounded-lg bg-white px-2 py-4 shadow-sm2"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-50">
              <Icon name="transfer-alt" size={24} />
            </span>
            <span className="text-xs font-medium text-brand-600">Transfer stock</span>
          </Link>
          <Link
            href="/scan"
            className="flex h-[90px] w-[114px] flex-col items-center gap-2 rounded-lg bg-white px-2 py-4 shadow-sm2"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-50">
              <Icon name="cart" size={24} />
            </span>
            <span className="text-xs font-medium text-brand-600">Withdraw</span>
          </Link>
        </div>

        <section className="mt-4 rounded-lg bg-brand-900 p-3.5 shadow-raised">
          <h2 className="text-sm font-bold text-white">Needs attention</h2>
          <div className="mt-3 flex flex-col gap-2">
            <Link href="/admin/inventory?filter=expiring" className="flex items-center justify-between rounded-lg bg-white p-2.5">
              <span className="flex items-center gap-2">
                <Icon name="error-solid" size={16} />
                <span className="text-xs text-content-strong">
                  {expired.length + expiring.length} expiring or expired batches
                </span>
              </span>
              <Icon name="chevron-right" size={16} />
            </Link>
            <Link href="/admin/inventory?filter=low" className="flex items-center justify-between rounded-lg bg-white p-2.5">
              <span className="flex items-center gap-2">
                <Icon name="warning-solid" size={16} />
                <span className="text-xs text-content-strong">
                  {low.length + outOfStock.length} essential items low or out of stock
                </span>
              </span>
              <Icon name="chevron-right" size={16} />
            </Link>
          </div>
        </section>

        {latest && (
          <section className="mt-4 rounded-xl border border-brand-600 bg-white p-3.5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-brand-600">Recent activity</h2>
                <p className="mt-1 truncate text-xs font-semibold text-content-strong">
                  {latest.reference} · {latest.storeroom.name}
                </p>
                <p className="mt-0.5 text-[10px] text-content-medium">
                  by {latest.user.name} · {new Date(latest.createdAt).toLocaleString()}
                </p>
              </div>
              <Link
                href={`/admin/transactions/${latest.id}`}
                className="shrink-0 rounded-lg bg-content-strong px-4 py-2 text-sm font-semibold text-white"
              >
                View
              </Link>
            </div>
          </section>
        )}

        <section className="mt-4 rounded-xl bg-white p-3.5 shadow-sm2">
          <h2 className="text-sm font-bold text-brand-600">Inventory summary</h2>
          <div className="mt-3.5 flex items-center gap-6">
            <svg viewBox="0 0 120 120" className="size-[114px] shrink-0 -rotate-90" role="img" aria-label="Stock health">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="#f1f1f4" strokeWidth="16" />
              {buckets.map((bucket) => {
                const length = (bucket.units / grandTotal) * circumference;
                const el = (
                  <circle
                    key={bucket.label}
                    cx="60" cy="60" r={radius} fill="none"
                    stroke={bucket.color} strokeWidth="16"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += length;
                return el;
              })}
            </svg>
            <ul className="flex flex-1 flex-col gap-2">
              {buckets.map((bucket) => (
                <li key={bucket.label} className="flex items-center gap-2">
                  <span className="size-3 shrink-0 rounded-sm" style={{ background: bucket.color }} />
                  <span className="flex flex-col">
                    <span className="text-xs font-semibold text-content-strong">{bucket.label}</span>
                    <span className="text-[10px] text-content-medium">{bucket.count} items</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-4 rounded-lg bg-white p-4 shadow-sm2">
          <h2 className="text-sm font-bold text-brand-600">Expiring Soon</h2>
          <ul className="mt-4 flex flex-col gap-4">
            {expiring.map((level) => (
              <li key={level.id} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-content-strong">{level.item.name}</span>
                <span className="text-[10px] text-content-medium">
                  Exp: {level.item.expiryDate!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {level.quantity} {level.item.unit}
                  {level.quantity === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <BottomTabBar />
    </>
  );
}
