import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { CatalogueItem, LocationCatalogue } from '@/lib/domain/catalogue';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The location-scoped catalogue — the ONLY way item data enters the matcher, the
 * decision rules, or an extraction provider's context.
 *
 * An item is in a location's catalogue exactly when it has a balance row there. That
 * single representation is why "stocked here" and "permitted here" can never disagree,
 * and why no code path has an item from another location to propose in the first place.
 */
export async function catalogueForLocation(
  locationId: string,
  db: Db = prisma,
): Promise<LocationCatalogue> {
  const location = await db.location.findUnique({ where: { id: locationId } });
  if (!location) throw new Error(`Unknown location ${locationId}`);

  const balances = await db.inventoryBalance.findMany({
    where: { locationId },
    include: { item: { include: { aliases: { where: { isApproved: true } } } } },
    orderBy: { item: { sku: 'asc' } },
  });

  const items: CatalogueItem[] = balances.map((balance) => ({
    id: balance.item.id,
    sku: balance.item.sku,
    displayName: balance.item.displayName,
    unit: balance.item.unit,
    category: balance.item.category,
    isActive: balance.item.isActive,
    isControlled: balance.item.isControlled,
    isHighRisk: balance.item.isHighRisk,
    reorderThreshold: balance.item.reorderThreshold,
    reorderQuantity: balance.item.reorderQuantity,
    aliases: balance.item.aliases.map((a) => a.alias),
    quantityOnHand: balance.quantityOnHand,
  }));

  return {
    locationId: location.id,
    locationCode: location.code,
    locationName: location.name,
    items,
  };
}

export async function catalogueForLocationCode(
  code: string,
  db: Db = prisma,
): Promise<LocationCatalogue> {
  const location = await db.location.findUnique({ where: { code } });
  if (!location) throw new Error(`Unknown location code ${code}`);
  return catalogueForLocation(location.id, db);
}
