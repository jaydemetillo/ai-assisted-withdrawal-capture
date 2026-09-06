import { currentUser } from '@/lib/session';
import { SidebarNav } from '@/components/SidebarNav';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <div className="flex min-h-dvh bg-canvas-alt">
      <SidebarNav userName={user.name} initials={user.initials} />
      <main className="min-w-0 flex-1 overflow-x-auto">{children}</main>
    </div>
  );
}
