import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Prisma, ReviewCaseStatus } from '@prisma/client';
import { AppHeader } from '@/components/AppHeader';
import { currentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const OPEN_STATUSES: ReviewCaseStatus[] = ['open', 'in_progress', 'awaiting_physical_check'];

const KIND_LABELS: Record<string, string> = {
  ambiguous_candidate: 'Could be more than one item',
  unmatched_candidate: 'Not in the catalogue',
  unreadable_candidate: 'Could not be read',
  restricted_candidate: 'Controlled or high-risk',
  stock_discrepancy: 'Stock discrepancy',
  extraction_failed: 'Photo could not be read',
};

function ageLabel(createdAt: Date): string {
  const minutes = Math.floor((Date.now() - createdAt.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The supply-review queue.
 *
 * Filtered by location, age, status and risk — the four questions a reviewer working a
 * shift actually asks. High-risk and controlled cases sort first, because a resus bay
 * missing its defib pads matters more than a miscounted gauze pack.
 */
export default async function SupplyReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; status?: string; risk?: string; age?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role === 'nurse') redirect('/withdrawals/new');

  const filters = await searchParams;
  const locations = await prisma.location.findMany({ orderBy: { code: 'asc' } });

  const where: Prisma.ReviewCaseWhereInput = {};
  where.status =
    filters.status && filters.status !== 'open'
      ? (filters.status as ReviewCaseStatus)
      : { in: OPEN_STATUSES };
  if (filters.location) where.locationId = filters.location;
  if (filters.risk === 'high') where.priority = 'high';
  if (filters.age) {
    const hours = Number(filters.age);
    if (Number.isFinite(hours)) where.createdAt = { lte: new Date(Date.now() - hours * 3_600_000) };
  }

  const cases = await prisma.reviewCase.findMany({
    where,
    include: { location: true, item: true, candidate: true, submission: { include: { submitter: true } } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: 100,
  });

  return (
    <div className="min-h-dvh">
      <AppHeader title="Supply review" user={user} />
      <main className="mx-auto max-w-3xl px-4 py-5">
        <form className="card flex flex-wrap items-end gap-3 p-4" method="get">
          <div className="min-w-[10rem] flex-1">
            <label className="label" htmlFor="location">
              Location
            </label>
            <select id="location" name="location" defaultValue={filters.location ?? ''} className="field mt-1.5">
              <option value="">All locations</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className="label" htmlFor="status">
              Status
            </label>
            <select id="status" name="status" defaultValue={filters.status ?? 'open'} className="field mt-1.5">
              <option value="open">Still open</option>
              <option value="in_progress">In progress</option>
              <option value="awaiting_physical_check">Awaiting a count</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className="label" htmlFor="age">
              Older than
            </label>
            <select id="age" name="age" defaultValue={filters.age ?? ''} className="field mt-1.5">
              <option value="">Any age</option>
              <option value="1">1 hour</option>
              <option value="4">4 hours</option>
              <option value="24">1 day</option>
            </select>
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className="label" htmlFor="risk">
              Risk
            </label>
            <select id="risk" name="risk" defaultValue={filters.risk ?? ''} className="field mt-1.5">
              <option value="">Any</option>
              <option value="high">High only</option>
            </select>
          </div>
          <button type="submit" className="btn-secondary">
            Apply
          </button>
        </form>

        <p className="mt-4 text-sm text-ink-muted">
          {cases.length === 0 ? 'Nothing matching those filters.' : `${cases.length} case${cases.length === 1 ? '' : 's'}`}
        </p>

        <ul className="mt-3 flex flex-col gap-3">
          {cases.map((reviewCase) => (
            <li key={reviewCase.id}>
              <Link href={`/supply-review/${reviewCase.id}`} className="card block p-4 hover:bg-canvas-sunken">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {reviewCase.item?.displayName ?? KIND_LABELS[reviewCase.kind] ?? reviewCase.kind}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">{reviewCase.summary}</p>
                    {reviewCase.candidate ? (
                      <p className="mt-1 truncate text-sm text-ink-subtle">
                        Written: “{reviewCase.candidate.rawText}”
                      </p>
                    ) : null}
                  </div>
                  {reviewCase.priority === 'high' ? <span className="pill-stop shrink-0">High risk</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
                  <span>{reviewCase.location.name}</span>
                  <span>{KIND_LABELS[reviewCase.kind] ?? reviewCase.kind}</span>
                  <span>{ageLabel(reviewCase.createdAt)}</span>
                  {reviewCase.submission ? <span>from {reviewCase.submission.submitter.name}</span> : null}
                  <span className="font-semibold">{reviewCase.status.replace(/_/g, ' ')}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
