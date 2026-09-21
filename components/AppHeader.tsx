import Link from 'next/link';
import type { Role } from '@prisma/client';

const ROLE_LABELS: Record<Role, string> = {
  nurse: 'Nurse',
  supply_reviewer: 'Supply reviewer',
  admin: 'Admin',
};

export function AppHeader({
  title,
  back,
  user,
}: {
  title: string;
  back?: { href: string; label: string };
  user?: { name: string; role: Role } | null;
}) {
  return (
    <header
      className="sticky top-0 z-10 border-b border-line bg-canvas/95 backdrop-blur"
      style={{ paddingTop: 'var(--safe-t)' }}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        {back ? (
          <Link
            href={back.href}
            className="-ml-2 flex min-h-tap min-w-tap items-center justify-center rounded-xl px-2 text-ink-muted hover:bg-canvas-sunken"
            aria-label={back.label}
          >
            <span aria-hidden className="text-xl">
              ←
            </span>
          </Link>
        ) : null}
        <h1 className="flex-1 text-lg font-bold tracking-tight">{title}</h1>
        {user ? (
          <form action="/logout" method="post" className="flex items-center gap-3">
            <span className="text-right text-xs leading-tight text-ink-muted">
              <span className="block font-semibold text-ink">{user.name}</span>
              {ROLE_LABELS[user.role]}
            </span>
            <button
              type="submit"
              className="min-h-tap rounded-xl px-2 text-xs font-semibold text-ink-muted hover:bg-canvas-sunken"
            >
              Sign out
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}
