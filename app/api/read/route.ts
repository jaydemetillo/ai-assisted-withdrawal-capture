import { NextResponse } from 'next/server';
import { CATALOGUE } from '@/lib/catalogue';
import { hasApiKey, readHandwriting, OCR_MODEL } from '@/lib/ocr/claude';
import { resolveLines } from '@/lib/ocr/match';
import type { CatalogueEntry } from '@/lib/ocr/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Stateless handwriting reading - no database, no file storage, no session.
 *
 * This is what makes the zero-setup deployment possible: the standalone demo at
 * /demo.html keeps all of its state in the browser and calls only this route, so the
 * app can be deployed with nothing but ANTHROPIC_API_KEY and still read real
 * handwriting. The full app (with a real ledger and an admin console) uses
 * /api/captures instead.
 */
const CATALOGUE_ENTRIES: CatalogueEntry[] = CATALOGUE.map((item) => ({
  id: item.sku, // no database here, so the SKU is the identity
  sku: item.sku,
  name: item.name,
  unit: item.unit,
  aliases: item.aliases,
}));

/** GET tells the browser whether a real read is possible, so the UI can be honest. */
export async function GET() {
  return NextResponse.json({
    live: hasApiKey(),
    model: hasApiKey() ? OCR_MODEL : null,
    catalogue: CATALOGUE.map((i) => ({
      sku: i.sku, name: i.name, unit: i.unit, opening: i.opening, aliases: i.aliases,
    })),
  });
}

export async function POST(request: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: 'No ANTHROPIC_API_KEY is set on the server, so handwriting cannot be read.' },
      { status: 503 },
    );
  }

  try {
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File)) {
      return NextResponse.json({ error: 'A photo is required' }, { status: 400 });
    }

    const buffer = Buffer.from(await photo.arrayBuffer());
    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: 'That photo was empty. Try again.' }, { status: 400 });
    }
    if (buffer.byteLength > 12 * 1024 * 1024) {
      return NextResponse.json({ error: 'That photo is too large (max 12MB).' }, { status: 413 });
    }

    const outcome = await readHandwriting(
      buffer,
      photo.type || 'image/jpeg',
      CATALOGUE_ENTRIES,
      'S15 Medical',
    );

    // Resolve here rather than in the browser so the matching rules stay in one place.
    const rows = resolveLines(outcome.result.lines, CATALOGUE_ENTRIES).map((row) => ({
      rawText: row.rawText,
      sku: row.itemId, // CatalogueEntry.id is the SKU on this path
      guess: row.itemGuess,
      qty: row.quantity,
      conf: row.confidence,
      flag: row.needsReview,
      bbox: row.bbox,
    }));

    return NextResponse.json({
      action: outcome.result.documentAction === 'dispose' ? 'DISPOSE' : 'WITHDRAW',
      transcript: outcome.result.transcript,
      readBy: `${outcome.model} read your photo`,
      rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that photo';
    console.error('[read]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
