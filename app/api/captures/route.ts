import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, defaultStoreroom } from '@/lib/session';
import { storeCapturePhoto } from '@/lib/storage';
import { loadCatalogue, resolveLines, runOcr } from '@/lib/ocr';
import { parseWrittenList } from '@/lib/ocr/parse-text';
import { applyDeviceReading, parseDeviceLines } from '@/lib/ocr/device-text';
import type { OcrOutcome } from '@/lib/ocr/types';
import { isReason, type Action } from '@/lib/constants';

export const runtime = 'nodejs';
// Vision on a full-page photo is not fast; give it room before the platform cuts us off.
export const maxDuration = 120;

/**
 * POST /api/captures - upload a photographed list and read it.
 *
 * Creates a DRAFT capture. Nothing moves in inventory here; that happens only when the
 * user confirms the parsed rows via /commit.
 *
 * There are two ways the words get read, and this route accepts either:
 *
 *  - The phone read them, for free, before uploading (`text` and `read` in the form).
 *    Nothing is charged and no model is called; the server does the same catalogue
 *    matching it does for a typed list, and puts the engine's geometry and doubt back
 *    onto the rows so the review overlay still works.
 *  - Nothing read them yet, so the server does - the paid vision call with a key, or a
 *    clearly labelled fixture without one.
 *
 * The photo is kept as evidence either way. Which route ran is recorded on the capture
 * and shown on screen, because "who read this" is an audit question.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const photo = form.get('photo');
    const reason = form.get('reason');
    const mockSlug = form.get('sample');
    const thumbnail = form.get('thumbnail');
    const deviceText = form.get('text');
    const deviceRead = form.get('read');
    const deviceEngine = form.get('engine');

    if (!(photo instanceof File)) {
      return NextResponse.json({ error: 'A photo is required' }, { status: 400 });
    }
    if (!isReason(reason)) {
      return NextResponse.json({ error: 'Choose why you are taking this photo' }, { status: 400 });
    }

    const buffer = Buffer.from(await photo.arrayBuffer());
    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: 'That photo was empty. Try again.' }, { status: 400 });
    }
    if (buffer.byteLength > 12 * 1024 * 1024) {
      return NextResponse.json({ error: 'That photo is too large (max 12MB).' }, { status: 413 });
    }

    const mediaType = photo.type || 'image/jpeg';
    const [user, storeroom, catalogue] = await Promise.all([
      currentUser(),
      defaultStoreroom(),
      loadCatalogue(),
    ]);

    /**
     * The phone read it: match the words, keep the engine's boxes, charge nothing.
     *
     * Keyed on the ENGINE field, not on whether any text came back, and that distinction
     * matters. A photo the reader could not make out still has to become a draft capture
     * with the photo attached, so the person can name the items on the review screen and
     * carry on. Falling through to the fixture path instead would paint invented sample
     * rows over their real photo, which is the one thing this app must never do.
     */
    const readOnPhone = typeof deviceEngine === 'string' && deviceEngine.trim().length > 0;
    let outcome: OcrOutcome;
    let resolved;

    if (readOnPhone) {
      const text = typeof deviceText === 'string' ? deviceText.trim().slice(0, 5000) : '';
      const parsed = parseWrittenList(text, catalogue);
      const read = parseDeviceLines(safeJson(deviceRead));
      resolved = applyDeviceReading(parsed.lines, read);
      outcome = {
        provider: 'device',
        model: deviceEngine.trim().slice(0, 60),
        result: {
          documentAction: parsed.action ? (parsed.action.toLowerCase() as 'withdraw' | 'dispose') : 'unknown',
          actionEvidence: parsed.actionEvidence,
          transcript: text,
          lines: [],
        },
      };
    } else {
      outcome = await runOcr(
        buffer,
        mediaType,
        catalogue,
        storeroom.name,
        typeof mockSlug === 'string' ? mockSlug : undefined,
      );
      resolved = resolveLines(outcome.result.lines, catalogue);
    }

    const photoPath = await storeCapturePhoto(
      buffer,
      mediaType,
      typeof thumbnail === 'string' ? thumbnail : null,
    );

    // "unknown" is a real answer from the model, not a failure - the review screen asks
    // the user to pick. We default the toggle to WITHDRAW as the common case.
    const action: Action = outcome.result.documentAction === 'dispose' ? 'DISPOSE' : 'WITHDRAW';

    const capture = await prisma.capture.create({
      data: {
        photoPath,
        reason,
        action,
        storeroomId: storeroom.id,
        userId: user.id,
        ocrRaw: JSON.stringify(outcome.result),
        ocrProvider: outcome.provider,
        ocrModel: outcome.model,
        lines: {
          create: resolved.map((line) => ({
            rawText: line.rawText,
            itemId: line.itemId,
            itemGuess: line.itemGuess,
            quantity: line.quantity,
            confidence: line.confidence,
            needsReview: line.needsReview,
            bbox: JSON.stringify(line.bbox),
            matchSource: line.matchSource,
          })),
        },
      },
    });

    return NextResponse.json({
      id: capture.id,
      actionInferred: outcome.result.documentAction,
      provider: outcome.provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that photo';
    console.error('[captures]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * The engine's line geometry arrives as a JSON string in a multipart form. A malformed
 * one costs the overlay its boxes and nothing else, so it is not worth failing the
 * upload over - the words are what move stock.
 */
function safeJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
