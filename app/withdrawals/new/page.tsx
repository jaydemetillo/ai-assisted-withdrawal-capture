import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { ConfigBanner } from '@/components/ConfigBanner';
import { currentUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { describeProvider } from '@/lib/extraction';
import { NewSubmissionForm } from './NewSubmissionForm';

export const dynamic = 'force-dynamic';

/**
 * Screen 1 — the ten-second path.
 *
 * A location and a photo. There is deliberately no item list, no quantity field and no
 * free-text note: every one of those would be another thing to do in a corridor, and the
 * whole premise is that the nurse has already taken the supplies and is now catching up.
 */
export default async function NewWithdrawalPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });

  // ED_RESUS_02 is preselected for the demo, as specified — the nurse should not have to
  // choose anything on the common path.
  const preselected = locations.find((l) => l.code === 'ED_RESUS_02') ?? locations[0];

  // describeProvider rather than extractionProvider: a misconfigured reader must not
  // crash the page whose job is to tell you it is misconfigured.
  const provider = describeProvider();

  return (
    <div className="min-h-dvh">
      <AppHeader title="Record a withdrawal" user={user} />
      <main className="mx-auto max-w-2xl px-4 py-5">
        <ConfigBanner />
        <NewSubmissionForm
          locations={locations}
          defaultLocationId={preselected?.id ?? ''}
          isMock={provider.isMock}
        />
        <p className="mt-5 text-center text-sm">
          <Link href="/catalogue/recognition" className="text-ink-muted underline">
            What this bay recognises by sight
          </Link>
        </p>
      </main>
    </div>
  );
}
