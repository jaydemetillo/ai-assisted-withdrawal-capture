import { redirect } from 'next/navigation';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { verifyPassword } from '@/lib/auth/password';
import { currentUser, sessionSecretConfigured, setSessionCookie } from '@/lib/auth/session';
import { ConfigBanner } from '@/components/ConfigBanner';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function signIn(formData: FormData) {
  'use server';

  // Checked before anything else: signing in is impossible without a secret, and the
  // person needs to be told that rather than shown a crash.
  if (!sessionSecretConfigured()) redirect('/login?error=config');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash));

  if (!ok || !user) {
    await recordAudit({
      action: AUDIT_ACTIONS.authDenied,
      entityType: 'User',
      entityId: email.slice(0, 120),
      afterValue: { reason: 'invalid_credentials' },
    });
    redirect('/login?error=1');
  }

  await setSessionCookie(user.id);
  await recordAudit({
    action: AUDIT_ACTIONS.authLogin,
    entityType: 'User',
    entityId: user.id,
    actorId: user.id,
    actorRole: user.role,
  });
  redirect('/withdrawals/new');
}

const DEMO_ACCOUNTS = [
  { email: 'nurse@demo.local', role: 'Nurse — submits photos, confirms clear withdrawals' },
  { email: 'reviewer@demo.local', role: 'Supply reviewer — works the queue, confirms restricted items' },
  { email: 'admin@demo.local', role: 'Admin — everything' },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect('/withdrawals/new');
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Withdrawal Capture</h1>
        <p className="mt-1 text-ink-muted">Record what you took, afterwards, from one photo.</p>
      </div>

      <ConfigBanner />

      {error === 'config' ? (
        <p className="rounded-xl border border-stop-600/30 bg-stop-50 px-4 py-3 text-sm text-stop-900" role="alert">
          Sign-in is not configured on this deployment yet — see the panel above.
        </p>
      ) : error ? (
        <p className="rounded-xl border border-stop-600/30 bg-stop-50 px-4 py-3 text-sm text-stop-900" role="alert">
          That email and password did not match. Please try again.
        </p>
      ) : null}

      <form action={signIn} className="card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="username" required className="field" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
          />
        </div>
        <button type="submit" className="btn-primary w-full">
          Sign in
        </button>
      </form>

      <section className="card p-5 text-sm">
        <h2 className="font-semibold">Demo accounts</h2>
        <p className="mt-1 text-ink-muted">
          Password <code className="rounded bg-canvas-sunken px-1.5 py-0.5">demo1234</code>
        </p>
        <ul className="mt-3 space-y-2">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <code className="font-semibold">{account.email}</code>
              <span className="block text-xs text-ink-muted">{account.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
