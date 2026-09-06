import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function StoreroomsPage() {
  const storerooms = await prisma.storeroom.findMany({
    orderBy: { code: 'asc' },
    include: { stockLevels: true, transactions: { where: { voided: false } } },
  });

  return (
    <div className="px-6 py-8">
      <h1 className="text-[32px] font-bold text-primary-600">Storerooms</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {storerooms.map((room) => {
          const units = room.stockLevels.reduce((s, l) => s + Math.max(0, l.quantity), 0);
          const low = room.stockLevels.filter((l) => l.quantity <= l.reorderLevel).length;
          return (
            <div key={room.id} className="rounded-2xl bg-white p-5 shadow-sm2">
              <h2 className="text-lg font-bold text-brand-600">{room.name}</h2>
              <p className="mt-0.5 text-sm text-content-medium">{room.ward} · {room.hospital}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  ['Items', room.stockLevels.length],
                  ['Units', units],
                  ['Low', low],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-xl bg-canvas-alt py-3">
                    <dt className="text-[11px] text-content-medium">{label}</dt>
                    <dd className="text-xl font-bold text-content-strong">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-content-medium">
                {room.transactions.length} transaction{room.transactions.length === 1 ? '' : 's'} recorded
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
