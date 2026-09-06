import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUser, defaultStoreroom } from '@/lib/session';
import { storeCapturePhoto } from '@/lib/storage';
import { loadCatalogue, resolveLines, runOcr } from '@/lib/ocr';
import { isReason, type Action } from '@/lib/constants';

export const runtime = 'nodejs';
// Vision on a full-page photo is not fast; give it room before the platform cuts us off.
export const maxDuration = 120;

/**
 * POST /api/captures - upload a photographed list and read it.
 *
 * Creates a DRAFT capture. Nothing moves in inventory here; that happens only when the
 * user confirms the parsed rows via /commit.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const photo = form.get('photo');
    const reason = form.get('reason');
    const mockSlug = form.get('sample');
    const thumbnail = form.get('thumbnail');

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

    const outcome = await runOcr(
      buffer,
      mediaType,
      catalogue,
      storeroom.name,
      typeof mockSlug === 'string' ? mockSlug : undefined,
    );

    const resolved = resolveLines(outcome.result.lines, catalogue);
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
