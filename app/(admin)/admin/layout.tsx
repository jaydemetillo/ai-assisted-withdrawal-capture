import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { hasUsableDatabase } from '@/lib/deployment';
import { SidebarNav } from '@/components/SidebarNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!hasUsableDatabase()) redirect('/demo.html');

  const user = await currentUser();
  return (
    <div className="flex min-h-dvh bg-canvas-alt">
      <SidebarNav userName={user.name} initials={user.initials} />
      <main className="min-w-0 flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
