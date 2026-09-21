import { randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '@prisma/client';
import type { StorageAdapter, StoredImage } from '@/lib/storage/adapter';

/**
 * An in-memory storage adapter, so the tests never touch the disk and never leave a
 * stray photo behind.
 */
export class MemoryStorage implements StorageAdapter {
  readonly name = 'memory';
  private readonly files = new Map<string, { data: Buffer; mediaType: string }>();

  async put(data: Buffer, mediaType: string): Promise<StoredImage> {
    const key = `${randomUUID()}.jpg`;
    this.files.set(key, { data, mediaType });
    return { key, mediaType, bytes: data.byteLength };
  }

  async get(key: string): Promise<{ data: Buffer; mediaType: string }> {
    const file = this.files.get(key);
    if (!file) throw new Error(`No stored image ${key}`);
    return file;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

export async function userWithRole(db: PrismaClient, role: Role) {
  const email = { nurse: 'nurse@demo.local', supply_reviewer: 'reviewer@demo.local', admin: 'admin@demo.local' }[role];
  return db.user.findUniqueOrThrow({ where: { email } });
}

export async function resusLocation(db: PrismaClient) {
  return db.location.findUniqueOrThrow({ where: { code: 'ED_RESUS_02' } });
}

export async function itemBySku(db: PrismaClient, sku: string) {
  return db.inventoryItem.findUniqueOrThrow({ where: { sku } });
}

export async function balanceFor(db: PrismaClient, sku: string, locationCode = 'ED_RESUS_02') {
  const item = await itemBySku(db, sku);
  const location = await db.location.findUniqueOrThrow({ where: { code: locationCode } });
  return db.inventoryBalance.findUniqueOrThrow({
    where: { itemId_locationId: { itemId: item.id, locationId: location.id } },
  });
}

/** Reset the mutable parts of the database, leaving the seeded catalogue in place. */
export async function resetWorkingData(db: PrismaClient): Promise<void> {
  await db.auditEvent.deleteMany();
  await db.replenishmentTask.deleteMany();
  await db.reviewCase.deleteMany();
  await db.inventoryTransaction.deleteMany();
  await db.extractedCandidate.deleteMany();
  await db.withdrawalSubmission.deleteMany();
}

/** Put every seeded balance back to its opening quantity and version zero. */
export async function resetBalances(db: PrismaClient): Promise<void> {
  const { ITEMS } = await import('@/prisma/seed-data');
  for (const seed of ITEMS) {
    const item = await db.inventoryItem.findUnique({ where: { sku: seed.sku } });
    if (!item) continue;
    const resus = await db.location.findUniqueOrThrow({ where: { code: 'ED_RESUS_02' } });
    await db.inventoryBalance.updateMany({
      where: { itemId: item.id, locationId: resus.id },
      data: { quantityOnHand: seed.resusQuantity, version: 0 },
    });
  }
}
