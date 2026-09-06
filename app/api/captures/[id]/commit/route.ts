import { NextResponse } from 'next/server';
import { commitCapture } from '@/lib/inventory';

export const runtime = 'nodejs';

/** POST - confirm a reviewed capture. This is the only place stock actually moves. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await commitCapture(id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not submit this capture';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
