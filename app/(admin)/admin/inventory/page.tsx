import { prisma } from '@/lib/db';
import { defaultStoreroom } from '@/lib/session';
import { safeAliases } from '@/lib/ocr';

export const dynamic = 'force-dynamic';

/** Where you watch 130 become 127 after a withdrawal. */
export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const storeroom = await defaultStoreroom();

  const levels = await prisma.stockLevel.findMany({
    where: { storeroomId: storeroom.id },
    include: { item: true },
    orderBy: { item: { name: 'asc' } },
  });

  const days = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const rows = levels.filter((l) => {
    if (filter === 'low') return l.quantity <= l.reorderLevel;
    if (filter === 'expiring') return l.item.expiryDate && days(l.item.expiryDate) <= 60;
    return true;
  });

  return (
    <div className="px-6 py-8">
      <h1 className="text-[32px] font-bold text-primary-600">Manage inventory</h1>
      <p className="mt-1 text-sm text-content-medium">
        {storeroom.name} · {rows.length} of {levels.length} items
        {filter ? ` · filtered by ${filter}` : ''}
      </p>

      <table className="mt-6 w-full border-collapse overflow-hidden rounded-2xl bg-white text-left shadow-sm2">
        <thead>
          <tr className="border-b border-divider-medium bg-canvas-alt text-[13px] font-semibold text-content-table">
            <th scope="col" className="px-4 py-3">Item</th>
            <th scope="col" className="px-4 py-3">SKU</th>
            <th scope="col" className="px-4 py-3">Category</th>
            <th scope="col" className="px-4 py-3 text-right">Opening</th>
            <th scope="col" className="px-4 py-3 text-right">In stock</th>
            <th scope="col" className="px-4 py-3 text-right">Reorder at</th>
            <th scope="col" className="px-4 py-3">Also written as</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((level) => {
            const low = level.quantity <= level.reorderLevel;
            const moved = level.quantity !== level.openingQuantity;
            return (
              <tr key={level.id} className="border-b border-divider-medium text-sm">
                <td className="px-4 py-3 font-semibold text-content-strong">{level.item.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-content-medium">{level.item.sku}</td>
                <td className="px-4 py-3 text-content-medium">{level.item.category}</td>
                <td className="px-4 py-3 text-right text-content-medium">{level.openingQuantity}</td>
                <td className={`px-4 py-3 text-right font-semibold ${low ? 'text-critical' : 'text-content-strong'}`}>
                  {level.quantity}
                  {moved && (
                    <span className="ml-1 text-[10px] font-normal text-content-medium">
                      ({level.quantity - level.openingQuantity})
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-content-medium">{level.reorderLevel}</td>
                <td className="px-4 py-3 text-xs text-content-medium">
                  {safeAliases(level.item.aliases).slice(0, 4).join(', ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
