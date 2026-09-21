import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { canReview, currentUser } from '@/lib/auth/session';
import { catalogueForLocation } from '@/lib/catalogue/repository';
import { prisma } from '@/lib/db';
import { signImageToken } from '@/lib/storage/signing';
import { loadVisionConfig } from '@/lib/vision/config';
import { describeEmbeddingProvider } from '@/lib/vision/embedding';
import { loadIndex, referencePhotosForLocation } from '@/lib/vision/reference-photos';
import { confusablePairs, diversity, itemRecognitionState } from '@/lib/vision/similarity';
import { RecognitionClient, type ItemRecognitionView } from './RecognitionClient';

export const dynamic = 'force-dynamic';

/**
 * What the recogniser has learned, and where it has stopped learning.
 *
 * The honest-plateau screen. It would be easy — and much more flattering — to show a
 * single rising "recognition accuracy" number. It would also be a lie within about six
 * weeks, because the curve flattens: the common items reach the point where another
 * photograph teaches nothing, and the rare ones never accumulate enough photographs to
 * get there at all.
 *
 * So this screen shows the shape of the truth instead. Every item carries a state, two
 * of which say the improvement has stopped on purpose:
 *
 *   untaught    nobody has photographed this yet
 *   learning    it has examples, but not enough to rely on
 *   good        it has enough, and they are varied
 *   saturated   at the cap, and every example looks the same — more will not help
 *   confusable  another item looks identical in a photo; this will always be asked about
 *   stale       every example is old enough that the packaging may have changed
 *
 * A plateau presented as a known boundary reads as the system being straight with you.
 * The same plateau hidden behind an encouraging progress bar reads as it having broken.
 */
export default async function RecognitionPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const locations = await prisma.location.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  const selectedId = (await searchParams).location ?? locations[0]?.id ?? '';
  if (!selectedId) redirect('/');

  const provider = describeEmbeddingProvider();
  const config = loadVisionConfig();
  const catalogue = await catalogueForLocation(selectedId);

  const [photos, index] = await Promise.all([
    referencePhotosForLocation(selectedId, { includeRetired: true }),
    loadIndex(selectedId),
  ]);

  const pairs = confusablePairs(index, config);
  const confusableItemIds = new Set(pairs.flatMap((pair) => [pair.a, pair.b]));
  const now = new Date();

  const items: ItemRecognitionView[] = catalogue.items.map((item) => {
    const vectors = index.filter((v) => v.itemId === item.id);
    const active = photos.filter((p) => p.itemId === item.id && index.some((v) => v.id === p.id));
    const retired = photos.filter((p) => p.itemId === item.id && !index.some((v) => v.id === p.id));

    return {
      id: item.id,
      displayName: item.displayName,
      sku: item.sku,
      isRestricted: item.isControlled || item.isHighRisk,
      state: itemRecognitionState(vectors, {
        confusable: confusableItemIds.has(item.id),
        now,
        config,
      }),
      diversity: Number(diversity(vectors).toFixed(2)),
      timesAgreed: active.reduce((sum, p) => sum + p.timesAgreed, 0),
      timesOverruled: active.reduce((sum, p) => sum + p.timesOverruled, 0),
      lookAlikes: pairs
        .filter((pair) => pair.a === item.id || pair.b === item.id)
        .map((pair) => (pair.a === item.id ? pair.b : pair.a))
        .map((id) => catalogue.items.find((i) => i.id === id)?.displayName ?? 'another item'),
      photos: [...active, ...retired].map((photo) => ({
        id: photo.id,
        url: `/api/images/${photo.imageKey}?t=${signImageToken(photo.imageKey, user.id)}`,
        source: photo.source,
        labelledByName: photo.labelledByName,
        timesAgreed: photo.timesAgreed,
        timesOverruled: photo.timesOverruled,
        isActive: index.some((v) => v.id === photo.id),
        takenAt: photo.createdAt.toISOString(),
      })),
    };
  });

  return (
    <div className="min-h-dvh">
      <AppHeader title="What it has learned" back={{ href: '/', label: 'Back' }} user={user} />
      <main className="mx-auto max-w-3xl px-4 py-5">
        <form method="get" className="card flex items-end gap-3 p-4">
          <div className="flex-1">
            <label className="label" htmlFor="location">
              Location
            </label>
            <select id="location" name="location" defaultValue={selectedId} className="field mt-1.5">
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} ({location.code})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary">
            Show
          </button>
        </form>

        <RecognitionClient
          locationId={selectedId}
          locationName={catalogue.locationName}
          items={items}
          canDelete={canReview(user.role)}
          maxExamples={config.maxExamplesPerItem}
          confidentExamples={config.confidentExampleCount}
          provider={provider}
        />
      </main>
    </div>
  );
}
