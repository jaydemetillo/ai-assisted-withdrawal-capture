import { afterAll, expect, it } from 'vitest';
import { catalogueForLocationCode } from '@/lib/catalogue/repository';
import { evaluateCandidate } from '@/lib/decision/rules';
import { describeWithDb, testPrisma } from '../helpers/db';

/**
 * The seeded database, read through the same projection the application uses.
 *
 * These are read-only assertions about the shape of the seed — that location scoping is
 * real rather than a convention, and that the decision rules behave identically against
 * database rows and against the in-memory fixtures the unit tests use.
 */
describeWithDb('catalogueForLocation', () => {
  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('returns the 25 seeded items for the resus bay', async () => {
    const catalogue = await catalogueForLocationCode('ED_RESUS_02', testPrisma);
    expect(catalogue.locationName).toBe('ED Resus Bay 02');
    expect(catalogue.items).toHaveLength(25);
  });

  it('scopes by location — the store room does not hold the controlled drug', async () => {
    const resus = await catalogueForLocationCode('ED_RESUS_02', testPrisma);
    const store = await catalogueForLocationCode('ED_STORE_01', testPrisma);

    expect(resus.items.map((i) => i.sku)).toContain('MORPH-10MG');
    expect(store.items.map((i) => i.sku)).not.toContain('MORPH-10MG');
  });

  it('carries the flags, thresholds and aliases the rules depend on', async () => {
    const catalogue = await catalogueForLocationCode('ED_RESUS_02', testPrisma);
    const cannula = catalogue.items.find((i) => i.sku === 'IVC-18G-BLUE');
    const morphine = catalogue.items.find((i) => i.sku === 'MORPH-10MG');

    expect(cannula?.aliases).toContain('blue cannula');
    expect(cannula?.quantityOnHand).toBe(24);
    expect(morphine?.isControlled).toBe(true);
  });

  it('enforces global alias uniqueness in the database, not just in the seed file', async () => {
    const aliases = await testPrisma.inventoryAlias.findMany({ select: { normalizedAlias: true } });
    const seen = new Set(aliases.map((a) => a.normalizedAlias));
    expect(seen.size).toBe(aliases.length);
  });

  it('rejects an alias that would map a second item to the same phrase', async () => {
    const other = await testPrisma.inventoryItem.findUniqueOrThrow({ where: { sku: 'IVC-22G-BLUE' } });
    await expect(
      testPrisma.inventoryAlias.create({
        data: { itemId: other.id, alias: 'blue cannula', normalizedAlias: 'blue cannula' },
      }),
    ).rejects.toThrow();
  });

  it('gives the same decisions against real rows as against the fixtures', async () => {
    const catalogue = await catalogueForLocationCode('ED_RESUS_02', testPrisma);
    const cannula = catalogue.items.find((i) => i.sku === 'IVC-18G-BLUE');

    const eligible = evaluateCandidate(
      {
        rawText: '18G blue cannula x1',
        evidence: 'written_text',
        proposedQuantity: 1,
        proposedItemId: cannula?.id ?? null,
        confidence: 0.97,
        status: 'high_confidence',
        reason: '',
      },
      catalogue,
    );
    expect(eligible.decision).toBe('eligible');

    const ambiguous = evaluateCandidate(
      {
        rawText: 'blue cannula x1',
        evidence: 'written_text',
        proposedQuantity: 1,
        proposedItemId: cannula?.id ?? null,
        confidence: 0.97,
        status: 'high_confidence',
        reason: '',
      },
      catalogue,
    );
    expect(ambiguous.decision).toBe('ambiguous');
  });

  it('will not build a catalogue for a location that does not exist', async () => {
    await expect(catalogueForLocationCode('NOWHERE', testPrisma)).rejects.toThrow(/Unknown location/);
  });
});
