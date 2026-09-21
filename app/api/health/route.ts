import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { configProblems } from '@/lib/config-check';
import { extractionProvider } from '@/lib/extraction';
import { storage } from '@/lib/storage';
import { imagePreparationAvailable } from '@/lib/extraction/image';
import { describeEmbeddingProvider } from '@/lib/vision/embedding';
import { prisma as db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — is this deployment actually usable?
 *
 * Open this first when something does not work. It names the missing variable rather
 * than making you read a stack trace. It deliberately reports no secrets: whether a key
 * is present, never any part of its value.
 */
function storageName(): string {
  try {
    return storage().name;
  } catch (error) {
    return `unavailable — ${error instanceof Error ? error.message : 'unknown error'}`;
  }
}

export async function GET(): Promise<NextResponse> {
  const problems = configProblems();

  let database: { ok: boolean; detail: string };
  try {
    const [locations, items, users] = await Promise.all([
      prisma.location.count(),
      prisma.inventoryItem.count(),
      prisma.user.count(),
    ]);
    database =
      locations > 0 && items > 0 && users > 0
        ? { ok: true, detail: `${locations} locations, ${items} items, ${users} accounts` }
        : { ok: false, detail: 'Connected, but empty — the seed has not run. Run `npm run db:seed`.' };
  } catch (error) {
    database = {
      ok: false,
      detail: `Could not reach the database: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`,
    };
  }

  let reader: { name: string; model: string; isMock: boolean; ok: boolean; detail: string };
  try {
    const provider = extractionProvider();
    reader = {
      name: provider.name,
      model: provider.model,
      isMock: provider.isMock,
      ok: true,
      detail: provider.isMock
        ? 'Offline mock — replays fixed sample notes, reads nothing'
        : 'Claude vision — real handwriting reading is on',
    };
  } catch (error) {
    reader = {
      name: 'none',
      model: '',
      isMock: false,
      ok: false,
      detail: error instanceof Error ? error.message : 'The extraction provider could not start.',
    };
  }

  // sharp is optional: without it photos are sent unprepared, which costs accuracy and
  // tokens but still reads. Worth reporting, not worth failing over.
  const imagePreparation = await imagePreparationAvailable();

  // Visual recognition never blocks health. It cannot move stock and every line it
  // touches goes to a human anyway, so a recogniser that will not start is a slightly
  // worse suggestion rather than a broken deployment.
  const embedding = describeEmbeddingProvider();
  let learnedExamples = 0;
  try {
    learnedExamples = await db.itemReferencePhoto.count({ where: { isActive: true } });
  } catch {
    learnedExamples = -1;
  }

  const healthy = database.ok && reader.ok && problems.every((p) => p.severity !== 'blocking');

  return NextResponse.json(
    {
      healthy,
      database,
      reader,
      // Ask the adapter what it actually is, rather than re-deriving it from an
      // environment variable. This line reported "local-disk" on a deployment that was
      // really using the database — wrong in exactly the situation someone reads it.
      storage: storageName(),
      recogniser: {
        enabled: embedding.enabled,
        ok: embedding.ok,
        name: embedding.name,
        model: embedding.model,
        dimensions: embedding.dimensions,
        // Counted so "it isn't recognising anything" has an obvious first answer.
        activeExamples: learnedExamples,
        detail: !embedding.enabled
          ? 'Switched off by VISUAL_RECOGNITION — photos are never matched against learned examples'
          : embedding.error
            ? embedding.error
            : embedding.isDescriptorOnly
              ? 'Built-in colour-and-shape fingerprint — recognises the same pack photographed the same way, not the concept of an item. Set EMBEDDING_PROVIDER=transformers for a trained model.'
              : 'Trained vision model',
      },
      imagePreparation: imagePreparation
        ? 'available (EXIF rotation, 1568px cap, contrast)'
        : 'unavailable — sharp did not load; photos are sent unprepared, which reads worse and costs more',
      onVercel: Boolean(process.env.VERCEL),
      // Which deployment you are actually looking at. Two Vercel projects built from
      // one repository have near-identical names, and putting a variable on the wrong
      // one looks exactly like the variable not working.
      deployment: {
        productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
        thisUrl: process.env.VERCEL_URL ?? null,
        environment: process.env.VERCEL_ENV ?? null,
        branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
      problems,
    },
    { status: healthy ? 200 : 503 },
  );
}
