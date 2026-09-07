import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { photoUrl } from '@/lib/storage';
import { StatusBar } from '@/components/PhoneFrame';
import { ReviewClient } from './ReviewClient';

export const dynamic = 'force-dynamic';

/**
 * Review step - the gate between "the model read something" and "stock moved".
 * Nothing here has touched inventory yet.
 */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const capture = await prisma.capture.findUnique({
    where: { id },
    include: {
      lines: { include: { capture: false } },
      storeroom: true,
    },
  });
  if (!capture) notFound();

  const items = await prisma.item.findMany({
    orderBy: { name: 'asc' },
    include: { stockLevels: { where: { storeroomId: capture.storeroomId } } },
  });

  const catalogue = items.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    unit: item.unit,
    quantity: item.stockLevels[0]?.quantity ?? 0,
  }));

  let transcript = '';
  try {
    transcript = (JSON.parse(capture.ocrRaw) as { transcript?: string }).transcript ?? '';
  } catch {
    transcript = '';
  }

  return (
    <>
      <StatusBar />
      <ReviewClient
        captureId={capture.id}
        committed={capture.status === 'COMMITTED'}
        photo={photoUrl(capture.photoPath)}
        action={capture.action as 'WITHDRAW' | 'DISPOSE'}
        provider={capture.ocrProvider}
        transcript={transcript}
        storeroomName={capture.storeroom.name}
        catalogue={catalogue}
        lines={capture.lines.map((line) => ({
          id: line.id,
          rawText: line.rawText,
          itemId: line.itemId,
          itemGuess: line.itemGuess,
          quantity: line.quantity,
          confidence: line.confidence,
          needsReview: line.needsReview,
          bbox: JSON.parse(line.bbox) as [number, number, number, number] | null,
        }))}
      />
    </>
  );
}
