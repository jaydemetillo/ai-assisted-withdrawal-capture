import { notFound, redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { currentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { ProcessingClient } from './ProcessingClient';

export const dynamic = 'force-dynamic';

/**
 * Screen 2 — processing.
 *
 * The submission is already durable by the time this renders. Leaving, locking the phone,
 * or losing signal costs nothing: this screen only polls for a status that lives in the
 * database, and the reading is claimed by a compare-and-set so a refresh cannot start a
 * second one.
 */
export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { id } = await params;

  const submission = await prisma.withdrawalSubmission.findUnique({
    where: { id },
    include: { location: true },
  });
  if (!submission) notFound();
  if (submission.submitterId !== user.id && user.role === 'nurse') notFound();

  if (submission.extractionStatus === 'succeeded') redirect(`/withdrawals/${id}/review`);

  return (
    <div className="min-h-dvh">
      <AppHeader title="Reading your photo" user={user} />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <ProcessingClient
          submissionId={submission.id}
          locationName={submission.location.name}
          initialStatus={submission.extractionStatus}
          initialError={submission.extractionError}
        />
      </main>
    </div>
  );
}
