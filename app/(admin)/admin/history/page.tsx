import Link from 'next/link';
import { prisma } from '@/lib/db';
import { ACTION_COPY, type Action } from '@/lib/constants';
import { EmptyState } from '@/components/EmptyState';

export const dynamic = 'force-dynamic';

export default async function AdminHistory() {
  const transactions = await prisma.transaction.findMany({
    orderBy: { createdAt: 'desc' },
    include: { lines: true, user: true, storeroom: true, capture: true },
  });

  return (
    <div className="px-6 py-8">
      <h1 className="text-[32px] font-bold text-primary-600">History</h1>
      <p className="mt-1 text-sm text-content-medium">Every stock movement, newest first.</p>

      {transactions.length === 0 ? (
        <div className="mt-6"><EmptyState title="No transactions yet" blurb="Capture a written list on the phone to create one." /></div>
      ) : (
        <table className="mt-6 w-full border-collapse overflow-hidden rounded-2xl bg-white text-left shadow-sm2">
          <thead>
            <tr className="border-b border-divider-medium bg-canvas-alt text-[13px] font-semibold text-content-table">
              <th scope="col" className="px-4 py-3">Reference</th>
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Storeroom</th>
              <th scope="col" className="px-4 py-3">Items</th>
              <th scope="col" className="px-4 py-3">Units</th>
              <th scope="col" className="px-4 py-3">By</th>
              <th scope="col" className="px-4 py-3">When</th>
              <th scope="col" className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className={`border-b border-divider-medium text-sm ${tx.voided ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <Link href={`/admin/transactions/${tx.id}`} className="font-semibold text-brand-600 hover:underline">{tx.reference}</Link>
                </td>
                <td className="px-4 py-3 text-content-strong">{ACTION_COPY[tx.action as Action].past}</td>
                <td className="px-4 py-3 text-content-medium">{tx.storeroom.name}</td>
                <td className="px-4 py-3 text-content-medium">{tx.lines.length}</td>
                <td className="px-4 py-3 text-content-medium">{tx.lines.reduce((s, l) => s + l.quantity, 0)}</td>
                <td className="px-4 py-3 text-content-medium">{tx.user.name}</td>
                <td className="px-4 py-3 text-content-medium">{new Date(tx.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  {tx.capture
                    ? <span className="rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-600">Photo</span>
                    : <span className="text-xs text-content-medium">Manual</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
