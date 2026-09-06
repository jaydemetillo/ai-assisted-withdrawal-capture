import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { StatusBar } from '@/components/PhoneFrame';
import { BottomTabBar } from '@/components/BottomTabBar';
import { ACTION_COPY, type Action } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** Confirmation: the whole point is showing the numbers that actually moved. */
export default async function DonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: { lines: { include: { item: true } }, storeroom: true },
  });
  if (!transaction) notFound();

  const copy = ACTION_COPY[transaction.action as Action];

  const rows = await Promise.all(
    transaction.lines.map(async (line) => {
      const level = await prisma.stockLevel.findUnique({
        where: { itemId_storeroomId: { itemId: line.itemId, storeroomId: transaction.storeroomId } },
      });
      const after = level?.quantity ?? 0;
      return { id: line.id, name: line.item.name, unit: line.item.unit, quantity: line.quantity, before: after + line.quantity, after };
    }),
  );

  return (
    <>
      <StatusBar />
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-[calc(7rem+var(--safe-b))] pt-6">
        <div className="flex size-14 items-center justify-center rounded-full bg-brand-50 text-2xl">✓</div>
        <h1 className="mt-4 text-2xl font-bold text-brand-600">{copy.past}</h1>
        <p className="mt-1 text-sm text-content-medium">
          {transaction.reference} · {transaction.storeroom.name}. These items were {copy.sentence}.
        </p>

        <ul className="mt-6 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm2">
              <span className="min-w-0 pr-3">
                <span className="block truncate text-sm font-semibold text-content-strong">{row.name}</span>
                <span className="text-[11px] text-content-medium">
                  {row.quantity} {row.unit}{row.quantity === 1 ? '' : 's'} {copy.past.toLowerCase()}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-content-strong">
                <span className="text-content-medium line-through">{row.before}</span>{' '}
                <span className="text-brand-600">→ {row.after}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col gap-2">
          <Link href="/scan" className="rounded-full bg-brand-600 py-3.5 text-center text-sm font-semibold text-white">
            Capture another list
          </Link>
          <Link href={`/admin/transactions/${transaction.id}`} className="rounded-full border border-divider-medium bg-white py-3.5 text-center text-sm font-semibold text-content-strong">
            See it in the admin record
          </Link>
        </div>
      </div>
      <BottomTabBar />
    </>
  );
}
