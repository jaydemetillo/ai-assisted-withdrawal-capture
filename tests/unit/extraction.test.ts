import { afterEach, describe, expect, it } from 'vitest';
import { extractionResultSchema } from '@/lib/domain/extraction';
import { MockExtractionProvider, MOCK_SCENARIOS } from '@/lib/extraction/mock';
import { buildExtractionContext } from '@/lib/extraction/provider';
import { buildExtractionPrompt } from '@/lib/extraction/prompt';
import { evaluateCandidate } from '@/lib/decision/rules';
import { resusCatalogue } from '../helpers/catalogue';

const catalogue = resusCatalogue();
const image = { key: 'k.jpg', mediaType: 'image/jpeg', data: Buffer.from('not a real photo') };

describe('the extraction context', () => {
  it('carries only this location, and nothing about a patient or a user', () => {
    const context = buildExtractionContext(catalogue);
    expect(context.locationId).toBe(catalogue.locationId);
    expect(context.items).toHaveLength(25);

    // The shape is closed: there is nowhere for a patient identifier to travel.
    const keys = Object.keys(context).sort();
    expect(keys).toEqual(['demoScenario', 'items', 'locationCode', 'locationId', 'locationName']);
    const itemKeys = Object.keys(context.items[0] ?? {}).sort();
    expect(itemKeys).toEqual(['aliases', 'displayName', 'id', 'isControlled', 'isHighRisk', 'sku', 'unit']);
  });

  it('excludes inactive items', () => {
    const local = resusCatalogue();
    const item = local.items.find((i) => i.sku === 'NS-FLUSH-10ML');
    if (item) item.isActive = false;
    expect(buildExtractionContext(local).items).toHaveLength(24);
  });
});

describe('the prompt', () => {
  const prompt = buildExtractionPrompt(buildExtractionContext(catalogue));

  it('lists every allowed item with its id, so the model selects rather than transcribes', () => {
    for (const item of catalogue.items) {
      expect(prompt).toContain(`id=${item.id}`);
    }
  });

  it('marks controlled and high-risk items', () => {
    expect(prompt).toMatch(/MORPH-10MG.*CONTROLLED/);
    expect(prompt).toMatch(/ADREN-1MG-10ML.*HIGH_RISK/);
  });

  it('forbids inferring anything clinical or about a patient', () => {
    expect(prompt).toContain('Never infer a medical procedure, treatment, dose, or patient attribute');
    expect(prompt).toContain('do not transcribe it');
  });

  it('tells the model to return null rather than guess', () => {
    expect(prompt).toContain('Never invent an item, SKU, quantity, or catalogue ID');
    expect(prompt).toContain('set proposedQuantity to null');
  });
});

describe('MockExtractionProvider', () => {
  const provider = new MockExtractionProvider();

  it('is honest about being a mock', () => {
    expect(provider.isMock).toBe(true);
  });

  it.each(MOCK_SCENARIOS)('returns schema-valid output for the %s scenario', async (scenario) => {
    const result = await provider.extract(image, buildExtractionContext(catalogue, scenario));
    expect(() => extractionResultSchema.parse(result)).not.toThrow();
  });

  it('produces two confirmable lines for the clear note', async () => {
    const result = await provider.extract(image, buildExtractionContext(catalogue, 'high_confidence'));
    const decisions = result.candidates.map((c) => evaluateCandidate(c, catalogue).decision);
    expect(decisions).toEqual(['eligible', 'eligible']);
  });

  it('produces an unconfirmable line for the ambiguous note', async () => {
    const result = await provider.extract(image, buildExtractionContext(catalogue, 'ambiguous'));
    expect(result.candidates).toHaveLength(1);
    expect(evaluateCandidate(result.candidates[0]!, catalogue).decision).toBe('ambiguous');
  });

  it('produces an unconfirmable line for the unreadable note', async () => {
    const result = await provider.extract(image, buildExtractionContext(catalogue, 'unreadable'));
    expect(evaluateCandidate(result.candidates[0]!, catalogue).decision).toBe('unreadable');
  });

  it('is deterministic for the same image when no scenario is chosen', async () => {
    const a = await provider.extract(image, buildExtractionContext(catalogue));
    const b = await provider.extract(image, buildExtractionContext(catalogue));
    expect(a).toEqual(b);
  });

  it('only ever proposes ids from the supplied catalogue', async () => {
    const ids = new Set(catalogue.items.map((i) => i.id));
    for (const scenario of MOCK_SCENARIOS) {
      const result = await provider.extract(image, buildExtractionContext(catalogue, scenario));
      for (const candidate of result.candidates) {
        if (candidate.proposedItemId) expect(ids.has(candidate.proposedItemId)).toBe(true);
      }
    }
  });
});

describe('choosing a provider', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('refuses to silently use the sample reader on a deployed host', async () => {
    const { extractionProvider } = await import('@/lib/extraction');
    delete process.env.EXTRACTION_PROVIDER;
    process.env.VERCEL = '1';
    expect(() => extractionProvider()).toThrow(/No reader is configured/);
  });

  it('uses the sample reader on a deployment only when asked for by name', async () => {
    const { extractionProvider } = await import('@/lib/extraction');
    process.env.VERCEL = '1';
    process.env.EXTRACTION_PROVIDER = 'mock';
    expect(extractionProvider().isMock).toBe(true);
  });

  it('defaults to the sample reader locally, where offline is the point', async () => {
    const { extractionProvider } = await import('@/lib/extraction');
    delete process.env.EXTRACTION_PROVIDER;
    delete process.env.VERCEL;
    expect(extractionProvider().isMock).toBe(true);
  });

  it('refuses the anthropic flag without a key rather than falling back to invented data', async () => {
    const { extractionProvider } = await import('@/lib/extraction');
    process.env.EXTRACTION_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => extractionProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('describeProvider reports the problem instead of throwing', async () => {
    const { describeProvider } = await import('@/lib/extraction');
    delete process.env.EXTRACTION_PROVIDER;
    process.env.VERCEL = '1';
    const description = describeProvider();
    expect(description.ok).toBe(false);
    expect(description.error).toMatch(/No reader is configured/);
  });
});
