import type { LocationCatalogue } from '@/lib/domain/catalogue';
import type { ExtractionResult } from '@/lib/domain/extraction';

/**
 * The extraction boundary.
 *
 * A provider reads an image and PROPOSES withdrawal lines. It cannot decide anything: its
 * output is parsed with `extractionResultSchema`, its item ids are re-checked against the
 * catalogue it was given, and the deterministic rules in `lib/decision` then decide what
 * may be confirmed. A provider that returns perfect confidence on nonsense changes
 * nothing about what a nurse is allowed to press.
 */

export type ProviderImage = {
  key: string;
  mediaType: string;
  data: Buffer;
};

/** One catalogue entry as a provider sees it. */
export type ExtractionContextItem = {
  id: string;
  sku: string;
  displayName: string;
  unit: string;
  aliases: string[];
  isControlled: boolean;
  isHighRisk: boolean;
};

/**
 * Everything a provider is given, and nothing else.
 *
 * No patient information. No user identity. No items from any other location. A provider
 * may only ever propose an id that appears in `items` — and if it proposes one that does
 * not, the application discards it (rule 8).
 */
export type ExtractionContext = {
  locationId: string;
  locationCode: string;
  locationName: string;
  items: ExtractionContextItem[];
  /** Development-only hint so a demo can choose which mock scenario to show. */
  demoScenario?: string | null;
};

export interface ExtractionProvider {
  readonly name: string;
  readonly model: string;
  /** True when this provider invents its output. The UI says so, visibly and always. */
  readonly isMock: boolean;
  extract(image: ProviderImage, context: ExtractionContext): Promise<ExtractionResult>;
}

export function buildExtractionContext(
  catalogue: LocationCatalogue,
  demoScenario?: string | null,
): ExtractionContext {
  return {
    locationId: catalogue.locationId,
    locationCode: catalogue.locationCode,
    locationName: catalogue.locationName,
    items: catalogue.items
      .filter((item) => item.isActive)
      .map((item) => ({
        id: item.id,
        sku: item.sku,
        displayName: item.displayName,
        unit: item.unit,
        aliases: item.aliases,
        isControlled: item.isControlled,
        isHighRisk: item.isHighRisk,
      })),
    demoScenario: demoScenario ?? null,
  };
}
