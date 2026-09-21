import type { PrismaClient, User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { normalize } from '@/lib/catalogue/normalize';
import { expected } from '@/lib/http';

/**
 * Add an item the catalogue does not have, and stock it at a location.
 *
 * Restricted to supply reviewers and admins. Not because a nurse cannot be trusted, but
 * because an open catalogue stops being a catalogue: the safety rules work by refusing
 * anything the location does not stock, and that refusal is worthless if anyone can
 * invent a row mid-withdrawal. A nurse who needs something added raises a request
 * instead, which lands in the review queue with the photo attached.
 */
export type CreateItemInput = {
  actor: User;
  locationId: string;
  displayName: string;
  unit: string;
  quantityOnHand: number;
  reorderThreshold: number;
  reorderQuantity: number;
  isControlled: boolean;
  isHighRisk: boolean;
  /** The phrase as written on the note, recorded as an alias so it matches next time. */
  alias?: string | null;
};

/**
 * Derive a readable SKU from the name, and make it unique.
 *
 * "Chest drain kit 28Fr" → CHEST-DRAIN-KIT-28FR. Generated rather than typed because a
 * person inventing SKUs under time pressure produces a catalogue nobody can search.
 */
async function uniqueSku(displayName: string, db: PrismaClient): Promise<string> {
  const base =
    normalize(displayName)
      .split(' ')
      .filter(Boolean)
      .slice(0, 4)
      .join('-')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 40) || 'ITEM';

  for (let attempt = 0; attempt < 50; attempt++) {
    const sku = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!(await db.inventoryItem.findUnique({ where: { sku } }))) return sku;
  }
  throw expected('Could not generate a unique code for that item. Try a more specific name.');
}

export async function createCatalogueItem(input: CreateItemInput) {
  const name = input.displayName.trim();
  if (name.length < 2) throw expected('Give the item a name.');

  const location = await prisma.location.findUnique({ where: { id: input.locationId } });
  if (!location || !location.isActive) throw expected('That location is not available.');

  const existing = await prisma.inventoryItem.findFirst({
    where: { displayName: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    // Already catalogued, just not stocked here. Stocking it is the right answer; a
    // duplicate row with the same name would make every future match ambiguous.
    const balance = await prisma.inventoryBalance.findUnique({
      where: { itemId_locationId: { itemId: existing.id, locationId: location.id } },
    });
    if (balance) throw expected(`${existing.displayName} is already stocked at ${location.name}.`);

    await prisma.inventoryBalance.create({
      data: { itemId: existing.id, locationId: location.id, quantityOnHand: input.quantityOnHand },
    });
    await recordAudit({
      action: AUDIT_ACTIONS.catalogueItemStocked,
      entityType: 'InventoryItem',
      entityId: existing.id,
      actorId: input.actor.id,
      actorRole: input.actor.role,
      locationId: location.id,
      afterValue: { sku: existing.sku, quantityOnHand: input.quantityOnHand },
    });
    return existing;
  }

  const sku = await uniqueSku(name, prisma as PrismaClient);

  const item = await prisma.$transaction(async (db) => {
    const created = await db.inventoryItem.create({
      data: {
        sku,
        displayName: name,
        unit: input.unit.trim() || 'each',
        category: 'added_on_ward',
        reorderThreshold: input.reorderThreshold,
        reorderQuantity: input.reorderQuantity,
        isControlled: input.isControlled,
        isHighRisk: input.isHighRisk,
      },
    });

    await db.inventoryBalance.create({
      data: { itemId: created.id, locationId: location.id, quantityOnHand: input.quantityOnHand },
    });

    // The written phrase becomes an alias so the same handwriting matches next time —
    // but only if no other item already owns it. A colliding alias would make BOTH
    // items ambiguous forever, which is worse than having no alias at all.
    const alias = input.alias?.trim();
    if (alias) {
      const normalized = normalize(alias);
      const taken = normalized
        ? await db.inventoryAlias.findUnique({ where: { normalizedAlias: normalized } })
        : null;
      if (normalized && !taken && normalized !== normalize(name)) {
        await db.inventoryAlias.create({
          data: { itemId: created.id, alias, normalizedAlias: normalized },
        });
      }
    }

    return created;
  });

  await recordAudit({
    action: AUDIT_ACTIONS.catalogueItemCreated,
    entityType: 'InventoryItem',
    entityId: item.id,
    actorId: input.actor.id,
    actorRole: input.actor.role,
    locationId: location.id,
    afterValue: {
      sku: item.sku,
      unit: item.unit,
      quantityOnHand: input.quantityOnHand,
      isControlled: item.isControlled,
      isHighRisk: item.isHighRisk,
    },
  });

  return item;
}
