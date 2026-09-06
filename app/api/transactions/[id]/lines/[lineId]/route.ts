import { NextResponse } from 'next/server';
import { deleteTransactionLine, updateTransactionLine } from '@/lib/inventory';

export const runtime = 'nodejs';

/** PATCH - an admin correcting a committed row. Stock is recomputed, not patched. */
export async function PATCH(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const body = (await request.json()) as { itemId?: string; quantity?: number; remarks?: string };
  try {
    await updateTransactionLine(lineId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update that row';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  await deleteTransactionLine(lineId);
  return NextResponse.json({ ok: true });
}
