import { prisma } from '@/lib/db';

/**
 * The prototype has no auth. Every request acts as the seeded admin, and the storeroom
 * is whichever one the seed created first. Real deployments replace this file.
 */
export async function currentUser() {
  const user = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
  if (!user) throw new Error('No seeded user. Run `npm run setup`.');
  return user;
}

export async function defaultStoreroom() {
  const storeroom = await prisma.storeroom.findFirst({ orderBy: { code: 'asc' } });
  if (!storeroom) throw new Error('No seeded storeroom. Run `npm run setup`.');
  return storeroom;
}
