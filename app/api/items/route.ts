import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { defaultStoreroom } from '@/lib/session';

export const runtime = 'nodejs';

/** GET /api/items?q= - powers the item picker on the review screen. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const storeroom = await defaultStoreroom();

  const items = await prisma.item.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { aliases: { contains: q.toLowerCase() } }] } : undefined,
    orderBy: { name: 'asc' },
    take: 40,
    include: { stockLevels: { where: { storeroomId: storeroom.id } } },
  });

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      quantity: item.stockLevels[0]?.quantity ?? 0,
    })),
  });
}
