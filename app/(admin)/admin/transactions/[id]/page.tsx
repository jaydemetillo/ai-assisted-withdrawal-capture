import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { photoUrl } from '@/lib/storage';
import { ACTION_COPY, REASON_LABELS, type Action, type Reason } from '@/lib/constants';
import { TransactionTable } from './TransactionTable';

export const dynamic = 'force-dynamic';

type RawOcr = { transcript?: string };

/** Transaction details - Figma node 8138:141367. */
export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: {
      lines: { include: { item: true }, orderBy: { id: 'asc' } },
      storeroom: true,
      user: true,
      capture: true,
    },
  });
  if (!transaction) notFound();

  const items = await prisma.item.findMany({ orderBy: { name: 'asc' } });

  const levels = await prisma.stockLevel.findMany({
    where: { storeroomId: transaction.storeroomId, itemId: { in: transaction.lines.map((l) => l.itemId) } },
  });
  const stockByItem = new Map(levels.map((l) => [l.itemId, l.quantity]));

  let transcript = '';
  if (transaction.capture) {
    try {
      transcript = (JSON.parse(transaction.capture.ocrRaw) as RawOcr).transcript ?? '';
    } catch {
      transcript = '';
    }
  }

  return (
    <TransactionTable
      transactionId={transaction.id}
      action={transaction.action as Action}
      reference={transaction.reference}
      voided={transaction.voided}
      storeroomName={transaction.storeroom.name}
      photo={transaction.capture ? photoUrl(transaction.capture.photoPath) : null}
      transcript={transcript}
      evidence={{
        reference: transaction.reference,
        capturedBy: transaction.user.name,
        capturedAt: new Date(transaction.createdAt).toLocaleString(),
        reason: transaction.reason ? REASON_LABELS[transaction.reason as Reason]?.title ?? transaction.reason : '—',
        provider: transaction.capture?.ocrProvider ?? 'mock',
        model: transaction.capture?.ocrModel ?? '',
      }}
      catalogue={items.map((i) => ({ id: i.id, name: i.name }))}
      lines={transaction.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.item.name,
        description: line.item.description,
        expiryDate: line.item.expiryDate ? line.item.expiryDate.toISOString().slice(0, 10) : null,
        imageUrl: line.item.imageUrl,
        quantity: line.quantity,
        remarks: line.remarks,
        rawText: line.rawText,
        confidence: line.confidence,
        matchStatus: line.matchStatus,
        bbox: JSON.parse(line.bbox) as [number, number, number, number] | null,
        stockNow: stockByItem.get(line.itemId) ?? 0,
      }))}
    />
  );
}
