import { PrismaClient } from '@prisma/client';

// Next dev reloads modules on every edit; without the global cache that would open a
// new pool of SQLite connections each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
