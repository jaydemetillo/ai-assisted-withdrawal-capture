import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, defaultStoreroom } from '@/lib/session';
import { loadCatalogue } from '@/lib/ocr';
import { parseWrittenList } from '@/lib/ocr/parse-text';
import { isReason, type Action } from '@/lib/constants';

export const runtime = 'nodejs';

/**
 * POST /api/captures/typed - a written list that has already been turned into text.
 *
 * No model, no API key, no cost: the phone's own text recognition (iOS Live Text,
 * Android Lens) or the person's thumbs did the reading, and this only has to work out
 * which catalogue item each line means. Produces exactly the same draft capture as the
 * photo route, so the review screen, the ledger and the admin console are unchanged.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string; reason?: string };
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!text) {
      return NextResponse.json({ error: 'Paste or type the list first' }, { status: 400 });
    }
    if (text.length > 5000) {
      return NextResponse.json({ error: 'That is longer than a stock list. Trim it down.' }, { status: 413 });
    }
    if (!isReason(body.reason)) {
      return NextResponse.json({ error: 'Choose why you are recording this' }, { status: 400 });
    }

    const [user, storeroom, catalogue] = await Promise.all([
      currentUser(),
      defaultStoreroom(),
      loadCatalogue(),
    ]);

    const parsed = parseWrittenList(text, catalogue);
    if (parsed.lines.length === 0) {
      return NextResponse.json(
        { error: 'No items found. Write one per line, like "3x Masks".' },
        { status: 422 },
      );
    }

    // "unknown" is a real answer - the review screen asks. Withdraw is the common case.
    const action: Action = parsed.action ?? 'WITHDRAW';

    const capture = await prisma.capture.create({
      data: {
        photoPath: '', // typed, so there is no photograph to keep
        reason: body.reason,
        action,
        storeroomId: storeroom.id,
        userId: user.id,
        ocrProvider: 'typed',
        ocrModel: 'text-parser',
        ocrRaw: JSON.stringify({
          documentAction: parsed.action ? parsed.action.toLowerCase() : 'unknown',
          actionEvidence: parsed.actionEvidence,
          transcript: text,
          lines: [],
        }),
        lines: {
          create: parsed.lines.map((line) => ({
            rawText: line.rawText,
            itemId: line.itemId,
            itemGuess: line.itemGuess,
            quantity: line.quantity,
            confidence: line.confidence,
            needsReview: line.needsReview,
            bbox: 'null',
            matchSource: line.matchSource,
          })),
        },
      },
    });

    return NextResponse.json({ id: capture.id, actionInferred: parsed.action });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read that list';
    console.error('[captures/typed]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
