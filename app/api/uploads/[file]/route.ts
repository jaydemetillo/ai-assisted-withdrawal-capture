import { NextResponse } from 'next/server';
import { mediaTypeFor, readPhoto } from '@/lib/storage';

export const runtime = 'nodejs';

/** Serves capture photos from .data/uploads (kept outside public/ so they aren't world-listed). */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  try {
    const buffer = await readPhoto(file);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mediaTypeFor(file),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
