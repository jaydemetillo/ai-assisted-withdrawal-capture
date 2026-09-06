import Link from 'next/link';
import { prisma } from '@/lib/db';
import { StatusBar } from '@/components/PhoneFrame';
import { BottomTabBar } from '@/components/BottomTabBar';
import { EmptyState } from '@/components/EmptyState';
import { ACTION_COPY, type Action } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const transactions = await prisma.transaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { lines: true, user: true, storeroom: true, capture: true },
  });

  return (
    <>
      <StatusBar />
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-28 pt-4">
        <h1 className="text-2xl font-bold text-brand-600">History</h1>
        <p className="mt-1 text-sm text-content-medium">Everything logged from this device and the ward.</p>

        {transactions.length === 0 ? (
          <div className="mt-6"><EmptyState title="Nothing logged yet" blurb="Capture a written list to see it here." /></div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {transactions.map((tx) => {
              const copy = ACTION_COPY[tx.action as Action];
              const units = tx.lines.reduce((sum, l) => sum + l.quantity, 0);
              return (
                <li key={tx.id}>
                  <Link href={`/admin/transactions/${tx.id}`} className={`block rounded-xl bg-white p-3 shadow-sm2 ${tx.voided ? 'opacity-50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-content-strong">
                        {copy.past} · {tx.reference}
                      </span>
                      {tx.capture && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-600">Photo</span>}
                    </div>
                    <p className="mt-1 text-[11px] text-content-medium">
                      {tx.lines.length} item{tx.lines.length === 1 ? '' : 's'} · {units} unit{units === 1 ? '' : 's'} · {tx.storeroom.name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-content-medium">
                      {tx.user.name} · {new Date(tx.createdAt).toLocaleString()}
                      {tx.voided && ' · reversed'}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <BottomTabBar />
    </>
  );
}
