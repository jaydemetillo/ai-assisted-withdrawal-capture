import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/auth/password';
import { normalize } from '../lib/catalogue/normalize';
import { DEMO_USERS, ITEMS, LOCATIONS } from './seed-data';

/**
 * Seed the demo hospital.
 *
 * Idempotent: every write is an upsert keyed on a natural key, so running it twice does
 * not duplicate a catalogue or reset a balance someone is mid-demo with. Re-running it
 * DOES reset opening quantities — use `npm run db:reset` for a genuinely clean slate.
 */
const prisma = new PrismaClient();

async function main() {
  const password = process.env.DEMO_PASSWORD || 'demo1234';

  // ── Fail before touching the database if the catalogue is internally inconsistent.
  // An alias that maps to two items would silently route a withdrawal to the wrong one.
  const seenAliases = new Map<string, string>();
  for (const item of ITEMS) {
    for (const alias of item.aliases) {
      const key = normalize(alias);
      const owner = seenAliases.get(key);
      if (owner && owner !== item.sku) {
        throw new Error(`Alias "${alias}" maps to both ${owner} and ${item.sku}. Fix prisma/seed-data.ts.`);
      }
      seenAliases.set(key, item.sku);
    }
  }

  // ── People ────────────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(password);
  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, passwordHash },
      update: { name: user.name, role: user.role, passwordHash, isActive: true },
    });
  }

  // ── Places ────────────────────────────────────────────────────────────────
  const locations = new Map<string, string>();
  for (const loc of LOCATIONS) {
    const row = await prisma.location.upsert({
      where: { code: loc.code },
      create: { code: loc.code, name: loc.name, description: loc.description },
      update: { name: loc.name, description: loc.description, isActive: true },
    });
    locations.set(loc.code, row.id);
  }
  const resusId = locations.get('ED_RESUS_02');
  const storeId = locations.get('ED_STORE_01');
  if (!resusId || !storeId) throw new Error('Seed locations missing');

  // ── Catalogue, aliases, and opening balances ──────────────────────────────
  for (const item of ITEMS) {
    const row = await prisma.inventoryItem.upsert({
      where: { sku: item.sku },
      create: {
        sku: item.sku,
        displayName: item.displayName,
        unit: item.unit,
        category: item.category,
        reorderThreshold: item.reorderThreshold,
        reorderQuantity: item.reorderQuantity,
        isControlled: item.isControlled ?? false,
        isHighRisk: item.isHighRisk ?? false,
      },
      update: {
        displayName: item.displayName,
        unit: item.unit,
        category: item.category,
        reorderThreshold: item.reorderThreshold,
        reorderQuantity: item.reorderQuantity,
        isControlled: item.isControlled ?? false,
        isHighRisk: item.isHighRisk ?? false,
        isActive: true,
      },
    });

    await prisma.inventoryAlias.deleteMany({ where: { itemId: row.id } });
    for (const alias of item.aliases) {
      await prisma.inventoryAlias.create({
        data: { itemId: row.id, alias, normalizedAlias: normalize(alias) },
      });
    }

    await prisma.inventoryBalance.upsert({
      where: { itemId_locationId: { itemId: row.id, locationId: resusId } },
      create: { itemId: row.id, locationId: resusId, quantityOnHand: item.resusQuantity },
      update: { quantityOnHand: item.resusQuantity },
    });

    if (item.storeQuantity === null) {
      await prisma.inventoryBalance.deleteMany({ where: { itemId: row.id, locationId: storeId } });
    } else {
      await prisma.inventoryBalance.upsert({
        where: { itemId_locationId: { itemId: row.id, locationId: storeId } },
        create: { itemId: row.id, locationId: storeId, quantityOnHand: item.storeQuantity },
        update: { quantityOnHand: item.storeQuantity },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    locations: await prisma.location.count(),
    items: await prisma.inventoryItem.count(),
    aliases: await prisma.inventoryAlias.count(),
    balances: await prisma.inventoryBalance.count(),
  };

  console.log('Seeded:');
  console.log(`  ${counts.locations} locations (ED_RESUS_02, ED_STORE_01)`);
  console.log(`  ${counts.items} inventory items, ${counts.aliases} approved aliases`);
  console.log(`  ${counts.balances} location balances`);
  console.log(`  ${counts.users} demo accounts, password: ${password}`);
  for (const u of DEMO_USERS) console.log(`    ${u.email.padEnd(22)} ${u.role}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
