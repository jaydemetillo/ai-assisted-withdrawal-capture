/**
 * The catalogue as the rest of the application sees it.
 *
 * Every consumer — the matcher, the decision rules, the extraction context handed to a
 * provider — takes a `LocationCatalogue`, never a raw query. That is deliberate: it is
 * structurally impossible to match against, or propose, an item from another location,
 * because no code path has one to hand.
 */
export type CatalogueItem = {
  id: string;
  sku: string;
  displayName: string;
  unit: string;
  category: string;
  isActive: boolean;
  isControlled: boolean;
  isHighRisk: boolean;
  reorderThreshold: number;
  reorderQuantity: number;
  /** Approved aliases only, as written. Normalisation happens in the matcher. */
  aliases: string[];
  /** Stock at THIS location. The existence of a balance is also what permits the item here. */
  quantityOnHand: number;
};

export type LocationCatalogue = {
  locationId: string;
  locationCode: string;
  locationName: string;
  items: CatalogueItem[];
};

export function itemById(catalogue: LocationCatalogue, id: string | null | undefined): CatalogueItem | null {
  if (!id) return null;
  return catalogue.items.find((item) => item.id === id) ?? null;
}

/** True when the item is flagged controlled or high-risk — either one restricts it. */
export function isRestricted(item: CatalogueItem): boolean {
  return item.isControlled || item.isHighRisk;
}
