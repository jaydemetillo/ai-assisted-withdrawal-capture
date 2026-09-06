/** Prints how the most recent capture's photo was stored. Handy when checking that a
 *  deployment without file storage is falling back to the inlined thumbnail. */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const capture = await prisma.capture.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!capture) {
    console.log('No captures yet.');
  } else {
    const how = capture.photoPath.startsWith('data:') ? 'inlined thumbnail (no file storage)'
      : capture.photoPath.startsWith('http') ? 'blob storage'
      : capture.photoPath ? 'local disk' : 'not stored';
    console.log(`photo stored as : ${how}`);
    console.log(`value prefix    : ${JSON.stringify(capture.photoPath.slice(0, 30))}`);
  }
  await prisma.$disconnect();
}
main();
