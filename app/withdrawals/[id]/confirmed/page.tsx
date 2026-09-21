import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { currentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { learnedFrom } from '@/lib/vision/learn';

export const dynamic = 'force-dynamic';

/**
 * The receipt.
 *
 * Built from the ledger rather than from whatever the confirm call returned, so it shows
 * what is actually recorded. "24 → 23" in plain arithmetic is the thing a nurse can check
 * against the drawer in front of them.
 */
export default async function ConfirmedPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const submission = await prisma.withdrawalSubmission.findUnique({
    where: { id },
    include: {
      location: true,
      confirmedBy: true,
      transactions: { include: { item: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!submission) notFound();
  if (submission.submitterId !== user.id && user.role === 'nurse') notFound();
  if (submission.status !== 'confirmed') redirect(`/withdrawals/${id}/review`);

  const itemIds = [...new Set(submission.transactions.map((t) => t.itemId))];
  // `learned` lists only reference photos that were ACTUALLY written. "I'll
  // recognise that next time" said after a photo that taught nothing is a promise the
  // next tray will visibly break, and a nurse who has been told that twice stops reading
  // the screen. learnedFrom() queries the row rather than inferring from the workflow.
  const [tasks, discrepancies, learned] = await Promise.all([
    prisma.replenishmentTask.findMany({
      where: { locationId: submission.locationId, itemId: { in: itemIds }, status: 'open' },
      include: { item: true },
    }),
    prisma.reviewCase.findMany({ where: { submissionId: id, kind: 'stock_discrepancy' } }),
    learnedFrom(id),
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader title="Withdrawal confirmed" user={user} />
      <main className="mx-auto max-w-2xl px-4 py-5">
        <section className="card border-ok-600/30 bg-ok-50 p-5">
          <h2 className="text-lg font-bold text-ok-900">Stock updated</h2>
          <p className="mt-1 text-sm text-ok-900/80">
            {submission.location.name} ·{' '}
            {submission.confirmedAt ? submission.confirmedAt.toLocaleString('en-GB') : ''} ·{' '}
            {submission.confirmedBy?.name ?? 'Unknown user'}
          </p>
        </section>

        <section className="mt-5 flex flex-col gap-3">
          <h2 className="text-base font-bold">What changed</h2>
          {submission.transactions.map((tx) => (
            <div key={tx.id} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold">{tx.item.displayName}</p>
                <p className="text-sm text-ink-muted">
                  {Math.abs(tx.quantityDelta)} {tx.item.unit} withdrawn
                </p>
              </div>
              <p className="shrink-0 text-right font-mono text-lg">
                <span className="text-ink-muted">{tx.quantityBefore}</span>
                <span className="mx-1.5 text-ink-subtle">→</span>
                <span className={tx.quantityAfter < 0 ? 'text-stop-900' : ''}>{tx.quantityAfter}</span>
              </p>
            </div>
          ))}
        </section>

        {learned.length > 0 ? (
          <section className="mt-5 rounded-2xl border border-brand-600/30 bg-brand-50 p-4">
            <h2 className="text-sm font-bold text-brand-900">
              {learned.length === 1
                ? 'Added to what it recognises'
                : `${learned.length} added to what it recognises`}
            </h2>
            <p className="mt-1 text-sm text-brand-900/85">
              {/* Named individually rather than counted. A tray photo can now teach
                  several items at once, and "3 items learned" gives a nurse no way to
                  tell whether it learned the right three. */}
              {listNames(learned.map((entry) => entry.itemName))} {learned.length === 1 ? 'is' : 'are'} now
              referenced for {submission.location.name}.{learned.length === 1 ? ' It' : ' They'} will be
              suggested faster next time — and still checked by a person.
            </p>
            <Link href="/catalogue/recognition" className="btn-secondary mt-3 text-sm">
              See what it has learned
            </Link>
          </section>
        ) : null}

        {discrepancies.length > 0 ? (
          <section className="mt-5 rounded-2xl border border-stop-600/30 bg-stop-50 p-4">
            <h2 className="text-sm font-bold text-stop-900">Stock discrepancy raised</h2>
            <p className="mt-1 text-sm text-stop-900/85">
              More was taken than the system had recorded. The withdrawal is still recorded — supply review
              will reconcile the count.
            </p>
          </section>
        ) : null}

        {tasks.length > 0 ? (
          <section className="mt-5 rounded-2xl border border-warn-600/30 bg-warn-50 p-4">
            <h2 className="text-sm font-bold text-warn-900">Replenishment requested</h2>
            <ul className="mt-2 space-y-1 text-sm text-warn-900/90">
              {tasks.map((task) => (
                <li key={task.id}>
                  {task.item.displayName} — {task.quantityAtTrigger} left, reorder at {task.reorderThreshold}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          <Link href="/withdrawals/new" className="btn-primary w-full">
            Record another withdrawal
          </Link>
          <Link href="/inventory" className="btn-secondary w-full">
            See stock
          </Link>
          <Link href="/catalogue/recognition" className="btn-quiet w-full text-sm">
            What it recognises here
          </Link>
        </div>
      </main>
    </div>
  );
}

/** "a", "a and b", "a, b and c" — an Oxford-comma-free list a person would say aloud. */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
