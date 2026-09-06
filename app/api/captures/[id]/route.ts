import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isAction } from '@/lib/constants';

export const runtime = 'nodejs';

/** PATCH - the review screen correcting a parsed row, or flipping withdraw/dispose. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as {
    action?: string;
    lines?: { id: string; itemId?: string | null; quantity?: number; remove?: boolean }[];
  };

  const capture = await prisma.capture.findUnique({ where: { id }, include: { lines: true } });
  if (!capture) return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  if (capture.status !== 'DRAFT') {
    return NextResponse.json({ error: 'This capture has already been submitted' }, { status: 409 });
  }

  await prisma.$transaction(async (db) => {
    if (isAction(body.action)) {
      await db.capture.update({ where: { id }, data: { action: body.action } });
    }

    for (const patch of body.lines ?? []) {
      const existing = capture.lines.find((l) => l.id === patch.id);
      if (!existing) continue;

      if (patch.remove) {
        await db.captureLine.delete({ where: { id: patch.id } });
        continue;
      }

      const quantity = typeof patch.quantity === 'number' ? Math.max(0, Math.round(patch.quantity)) : existing.quantity;
      const itemId = patch.itemId === undefined ? existing.itemId : patch.itemId;
      // Any human edit is authoritative: stop flagging the row for review.
      const touched = itemId !== existing.itemId || quantity !== existing.quantity;

      await db.captureLine.update({
        where: { id: patch.id },
        data: {
          itemId,
          quantity,
          matchSource: touched ? 'MANUAL' : existing.matchSource,
          confidence: touched ? 1 : existing.confidence,
          needsReview: !itemId || quantity <= 0,
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
