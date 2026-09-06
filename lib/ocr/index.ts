import { prisma } from '@/lib/db';
import type { CatalogueEntry, OcrOutcome } from '@/lib/ocr/types';
import { hasApiKey, readHandwriting } from '@/lib/ocr/claude';
import { mockHandwriting } from '@/lib/ocr/mock';

export * from '@/lib/ocr/types';
export { resolveLines, matchItem, similarity, normalize } from '@/lib/ocr/match';
export { MOCK_NOTE_SLUGS } from '@/lib/ocr/mock';
export { OCR_MODEL, hasApiKey } from '@/lib/ocr/claude';

/** Catalogue rows the model and matcher both work against. */
export async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const items = await prisma.item.findMany({ orderBy: { name: 'asc' } });
  return items.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    aliases: safeAliases(item.aliases),
  }));
}

export function safeAliases(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Read a note, using the real model when a key is configured and canned fixtures when
 * it is not. Callers get the same shape either way and should surface `provider` so the
 * UI can say which one produced the reading.
 */
export async function runOcr(
  image: Buffer,
  mediaType: string,
  catalogue: CatalogueEntry[],
  storeroomName: string,
  mockSlug?: string,
): Promise<OcrOutcome> {
  if (!hasApiKey()) return mockHandwriting(image, catalogue, mockSlug);
  return readHandwriting(image, mediaType, catalogue, storeroomName);
}
