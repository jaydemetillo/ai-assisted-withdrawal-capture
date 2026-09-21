import type { CatalogueItem, LocationCatalogue } from '@/lib/domain/catalogue';
import { ITEMS, type SeedItem } from '@/prisma/seed-data';

/**
 * Build a LocationCatalogue from the seed data, with the SKU as the id.
 *
 * Using the real seed rather than a hand-written fixture means these tests fail when
 * somebody adds a catalogue entry that breaks the demo — which is exactly when we want
 * to hear about it.
 */
function toCatalogueItem(item: SeedItem, quantity: number): CatalogueItem {
  return {
    id: item.sku,
    sku: item.sku,
    displayName: item.displayName,
    unit: item.unit,
    category: item.category,
    isActive: true,
    isControlled: item.isControlled ?? false,
    isHighRisk: item.isHighRisk ?? false,
    reorderThreshold: item.reorderThreshold,
    reorderQuantity: item.reorderQuantity,
    aliases: item.aliases,
    quantityOnHand: quantity,
  };
}

export function resusCatalogue(): LocationCatalogue {
  return {
    locationId: 'loc_resus',
    locationCode: 'ED_RESUS_02',
    locationName: 'ED Resus Bay 02',
    items: ITEMS.map((i) => toCatalogueItem(i, i.resusQuantity)),
  };
}

export function storeCatalogue(): LocationCatalogue {
  return {
    locationId: 'loc_store',
    locationCode: 'ED_STORE_01',
    locationName: 'ED Store Room 01',
    items: ITEMS.filter((i) => i.storeQuantity !== null).map((i) => toCatalogueItem(i, i.storeQuantity ?? 0)),
  };
}

/** A candidate as an extraction provider would return it, with sane defaults. */
export function candidate(overrides: Partial<import('@/lib/domain/extraction').ExtractionCandidate> = {}) {
  return {
    rawText: '18G blue cannula x1',
    evidence: 'written_text' as const,
    proposedQuantity: 1 as number | null,
    proposedItemId: 'IVC-18G-BLUE' as string | null,
    confidence: 0.97,
    status: 'high_confidence' as const,
    reason: 'clear handwriting, unique alias',
    ...overrides,
  };
}
