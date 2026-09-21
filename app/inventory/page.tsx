import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { currentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Stock, low stock, what moved, and what needs ordering.
 *
 * Low stock is listed first because it is the only part that needs somebody to act. The
 * transaction list shows before → after for every movement, so the ledger is legible
 * without opening a database.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const locations = await prisma.location.findMany({ orderBy: { code: 'asc' } });
  const selectedId = (await searchParams).location ?? locations[0]?.id ?? '';

  const [balances, transactions, tasks] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: { locationId: selectedId },
      include: { item: true },
      orderBy: { item: { displayName: 'asc' } },
    }),
    prisma.inventoryTransaction.findMany({
      where: { locationId: selectedId },
      include: { item: true, actor: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.replenishmentTask.findMany({
      where: { locationId: selectedId, status: { in: ['open', 'in_progress', 'ordered'] } },
      include: { item: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const lowStock = balances.filter((b) => b.quantityOnHand <= b.item.reorderThreshold);

  return (
    <div className="min-h-dvh">
      <AppHeader title="Inventory" user={user} />
      <main className="mx-auto max-w-3xl px-4 py-5">
        <form method="get" className="card flex items-end gap-3 p-4">
          <div className="flex-1">
            <label className="label" htmlFor="location">
              Location
            </label>
            <select id="location" name="location" defaultValue={selectedId} className="field mt-1.5">
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} ({location.code})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary">
            Show
          </button>
        </form>

        <section className="mt-5">
          <h2 className="text-base font-bold">
            Low stock{' '}
            <span className="font-normal text-ink-muted">
              ({lowStock.length} of {balances.length})
            </span>
          </h2>
          {lowStock.length === 0 ? (
            <p className="card mt-3 p-4 text-ink-muted">Everything is above its reorder level.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {lowStock.map((balance) => (
                <li key={balance.id} className="card flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{balance.item.displayName}</p>
                    <p className="text-sm text-ink-muted">
                      Reorder at {balance.item.reorderThreshold} {balance.item.unit}
                      {balance.item.isControlled || balance.item.isHighRisk ? ' · controlled/high-risk' : ''}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-2xl font-bold tabular-nums ${
                      balance.quantityOnHand < 0 ? 'text-stop-900' : 'text-warn-900'
                    }`}
                  >
                    {balance.quantityOnHand}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">Replenishment tasks</h2>
          {tasks.length === 0 ? (
            <p className="card mt-3 p-4 text-ink-muted">Nothing outstanding.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {tasks.map((task) => (
                <li key={task.id} className="card flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{task.item.displayName}</p>
                    <p className="text-sm text-ink-muted">
                      {task.quantityAtTrigger} left when raised · suggest ordering {task.suggestedQuantity}
                    </p>
                  </div>
                  <span className="pill-quiet shrink-0">{task.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">Recent movements</h2>
          {transactions.length === 0 ? (
            <p className="card mt-3 p-4 text-ink-muted">No stock has moved here yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {transactions.map((tx) => (
                <li key={tx.id} className="card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 font-semibold">{tx.item.displayName}</p>
                    <p className="shrink-0 font-mono">
                      <span className="text-ink-muted">{tx.quantityBefore}</span>
                      <span className="mx-1.5 text-ink-subtle">→</span>
                      <span className={tx.quantityAfter < 0 ? 'text-stop-900' : ''}>{tx.quantityAfter}</span>
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {tx.createdAt.toLocaleString('en-GB')} · {tx.actor.name} ({tx.actorRole.replace(/_/g, ' ')})
                    {tx.submissionId ? (
                      <>
                        {' · '}
                        <Link href={`/withdrawals/${tx.submissionId}/confirmed`} className="underline">
                          source photo
                        </Link>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">All stock</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-canvas">
            {balances.map((balance) => (
              <li key={balance.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate">{balance.item.displayName}</span>
                <span className="shrink-0 font-mono tabular-nums">{balance.quantityOnHand}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
