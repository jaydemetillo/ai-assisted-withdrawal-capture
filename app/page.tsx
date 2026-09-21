import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  redirect((await currentUser()) ? '/withdrawals/new' : '/login');
}
