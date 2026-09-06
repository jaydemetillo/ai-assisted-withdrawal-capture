import Link from 'next/link';
import { prisma } from '@/lib/db';
import { defaultStoreroom } from '@/lib/session';
import { ACTION_COPY, type Action } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const storeroom = await defaultStoreroom();
  const [transactions, levels, captures] = await Promise.all([
    prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 6, include: { lines: true, user: true, capture: true } }),
    prisma.stockLevel.findMany({ where: { storeroomId: storeroom.id }, include: { item: true } }),
    prisma.capture.count(),
  ]);

  const low = levels.filter((l) => l.quantity <= l.reorderLevel).length;
  const cards = [
    { label: 'Items tracked', value: levels.length },
    { label: 'At or below reorder level', value: low },
    { label: 'Lists photographed', value: captures },
    { label: 'Transactions logged', value: transactions.length },
  ];

  return (
    <div className="px-6 py-8">
      <h1 className="text-[32px] font-bold text-primary-600">Overview</h1>
      <p className="mt-1 text-sm text-content-medium">{storeroom.name} · {storeroom.hospital}</p>

      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl bg-white p-5 shadow-sm2">
            <p className="text-3xl font-bold text-content-strong">{card.value}</p>
            <p className="mt-1 text-xs text-content-medium">{card.label}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-bold text-brand-600">Recent activity</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {transactions.map((tx) => {
          const copy = ACTION_COPY[tx.action as Action];
          return (
            <li key={tx.id}>
              <Link href={`/admin/transactions/${tx.id}`} className="flex items-center justify-between rounded-xl bg-white px-5 py-4 shadow-sm2 transition-colors hover:bg-brand-50/40">
                <span>
                  <span className="text-sm font-semibold text-content-strong">{copy.past} · {tx.reference}</span>
                  <span className="mt-0.5 block text-xs text-content-medium">
                    {tx.lines.length} item{tx.lines.length === 1 ? '' : 's'} · {tx.user.name} · {new Date(tx.createdAt).toLocaleString()}
                  </span>
                </span>
                {tx.capture && <span className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-600">From a photo</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
