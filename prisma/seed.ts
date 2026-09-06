/**
 * Invented but plausible ward-supply catalogue for the prototype.
 *
 * `aliases` is the important column: it is what lets a nurse write "3x Masks" and have
 * it land on "Surgical Mask (Level 2)". Add the sloppy, abbreviated, plural forms people
 * actually write - not the tidy procurement name.
 */
import { PrismaClient } from '@prisma/client';
import { CATALOGUE } from '../lib/catalogue';

const prisma = new PrismaClient();

// The catalogue itself lives in lib/catalogue.ts so the demo route can share it.


function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  // Order matters: children before parents.
  await prisma.transactionLine.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.captureLine.deleteMany();
  await prisma.capture.deleteMany();
  await prisma.stockLevel.deleteMany();
  await prisma.item.deleteMany();
  await prisma.storeroom.deleteMany();
  await prisma.user.deleteMany();

  const aisha = await prisma.user.create({
    data: { name: 'Aisha Rahman', initials: 'AR', role: 'admin' },
  });
  const fang = await prisma.user.create({
    data: { name: 'Fang Wei', initials: 'FW', role: 'staff' },
  });

  const s15 = await prisma.storeroom.create({
    data: { code: 'S15', name: 'S15 Medical', ward: 'Ward 411', hospital: 'Sengkang General Hospital' },
  });
  const s22 = await prisma.storeroom.create({
    data: { code: 'S22', name: 'S22 Consumables', ward: 'Ward 409', hospital: 'Sengkang General Hospital' },
  });

  // A handful of near-dated batches so the "Expiring soon" card has real content.
  const expiries: Record<string, number> = {
    'SAL-09-500': 6, 'CHX-WIPE': 21, 'PARA-500': 38, 'SUTURE-3-0': 52,
    'STER-WATER-10': 12, 'BLOOD-EDTA': 74, 'GAUZE-10': 400, 'ETCO2-AD': 500,
  };

  for (const entry of CATALOGUE) {
    const item = await prisma.item.create({
      data: {
        sku: entry.sku,
        name: entry.name,
        category: entry.category,
        unit: entry.unit,
        description: entry.description,
        aliases: JSON.stringify(entry.aliases),
        expiryDate: expiries[entry.sku] ? daysFromNow(expiries[entry.sku]) : null,
      },
    });

    await prisma.stockLevel.create({
      data: {
        itemId: item.id, storeroomId: s15.id,
        openingQuantity: entry.opening, quantity: entry.opening, reorderLevel: entry.reorder,
      },
    });
    // The second storeroom carries a thinner, offset stock so transfers look plausible.
    await prisma.stockLevel.create({
      data: {
        itemId: item.id, storeroomId: s22.id,
        openingQuantity: Math.round(entry.opening * 0.4),
        quantity: Math.round(entry.opening * 0.4),
        reorderLevel: Math.round(entry.reorder * 0.5),
      },
    });
  }

  // Two historical transactions so the desktop table is not empty on first run.
  const bySku = async (sku: string) => (await prisma.item.findUniqueOrThrow({ where: { sku } })).id;

  await prisma.transaction.create({
    data: {
      reference: 'WD-00001', action: 'WITHDRAW', storeroomId: s15.id, userId: fang.id,
      reason: 'FORGOT_TO_RECORD', remarks: 'Ward round restock, logged the next morning',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26),
      lines: {
        create: [
          { itemId: await bySku('ETCO2-AD'), quantity: 2, delta: -2, rawText: '2x ETCO2 sensor', confidence: 0.96, remarks: 'Sensor replaced due to calibration drift' },
          { itemId: await bySku('ECG-ELEC'), quantity: 4, delta: -4, rawText: '4x ECG electrodes', confidence: 0.93, remarks: 'Routine monitoring restock' },
        ],
      },
    },
  });

  await prisma.transaction.create({
    data: {
      reference: 'DP-00001', action: 'DISPOSE', storeroomId: s15.id, userId: aisha.id,
      reason: 'EMERGENCY', remarks: 'Expired batch pulled from shelf',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5),
      lines: {
        create: [
          { itemId: await bySku('GAUZE-10'), quantity: 6, delta: -6, rawText: '6x gauze pads', confidence: 0.91, remarks: 'Gauze pads expired and removed from circulation' },
        ],
      },
    },
  });

  // Bring the cached quantities in line with the ledger we just wrote.
  const levels = await prisma.stockLevel.findMany();
  for (const level of levels) {
    const agg = await prisma.transactionLine.aggregate({
      _sum: { delta: true },
      where: { itemId: level.itemId, transaction: { storeroomId: level.storeroomId, voided: false } },
    });
    await prisma.stockLevel.update({
      where: { id: level.id },
      data: { quantity: level.openingQuantity + (agg._sum.delta ?? 0) },
    });
  }

  const masks = await prisma.item.findUniqueOrThrow({ where: { sku: 'MASK-L2' } });
  const maskLevel = await prisma.stockLevel.findUniqueOrThrow({
    where: { itemId_storeroomId: { itemId: masks.id, storeroomId: s15.id } },
  });

  console.log(`Seeded ${CATALOGUE.length} items across 2 storerooms.`);
  console.log(`  ${masks.name} in ${s15.name}: ${maskLevel.quantity}`);
  console.log(`  Users: ${aisha.name} (admin), ${fang.name} (staff)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
