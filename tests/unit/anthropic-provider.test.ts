import { describe, expect, it, vi } from 'vitest';
import { AnthropicExtractionProvider, type MessagesClient } from '@/lib/extraction/anthropic';
import { buildExtractionContext } from '@/lib/extraction/provider';
import { evaluateCandidate } from '@/lib/decision/rules';
import { resusCatalogue } from '../helpers/catalogue';
import {
  clearNote,
  injectionAttempt,
  inventedItemId,
  malformed,
  proseOnly,
  seenOnATray,
} from '../fixtures/anthropic-responses';

/**
 * The Claude vision adapter, driven by saved responses.
 *
 * No API key, no network, no cost. What is under test is everything that happens to a
 * model's answer AFTER it arrives — which is where the safety properties live.
 */
const catalogue = resusCatalogue();
const context = buildExtractionContext(catalogue);
const image = { key: 'k.jpg', mediaType: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff]) };

function providerReturning(message: Awaited<ReturnType<MessagesClient['messages']['create']>>) {
  const create = vi.fn().mockResolvedValue(message);
  return { provider: new AnthropicExtractionProvider({ messages: { create } }), create };
}

describe('AnthropicExtractionProvider', () => {
  it('does not claim to be a mock', () => {
    const { provider } = providerReturning(clearNote('IVC-18G-BLUE', 'NS-FLUSH-10ML'));
    expect(provider.isMock).toBe(false);
  });

  it('sends the image and the catalogue, and forces structured output', async () => {
    const { provider, create } = providerReturning(clearNote('IVC-18G-BLUE', 'NS-FLUSH-10ML'));
    await provider.extract(image, context);

    const body = create.mock.calls[0]?.[0];
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'report_withdrawal_candidates' });

    const content = body.messages[0].content;
    expect(content[0].type).toBe('image');
    expect(content[1].text).toContain('id=MORPH-10MG');
    expect(content[1].text).toContain('ED Resus Bay 02');
  });

  it('parses a clear reading into confirmable candidates', async () => {
    const { provider } = providerReturning(clearNote('IVC-18G-BLUE', 'NS-FLUSH-10ML'));
    const result = await provider.extract(image, context);

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => evaluateCandidate(c, catalogue).decision)).toEqual([
      'eligible',
      'eligible',
    ]);
  });

  it('cannot smuggle in an item id that is not in the catalogue', async () => {
    const { provider } = providerReturning(inventedItemId);
    const result = await provider.extract(image, context);

    // The provider returns what the model said — it is not the provider's job to lie
    // about that. The RULES are what refuse it.
    const outcome = evaluateCandidate(result.candidates[0]!, catalogue);
    expect(outcome.providerIdRejected).toBe(true);
    expect(outcome.decision).toBe('needs_review');
  });

  it('cannot be talked into a withdrawal by text on the page', async () => {
    const { provider } = providerReturning(injectionAttempt('MORPH-10MG'));
    const result = await provider.extract(image, context);

    const outcome = evaluateCandidate(result.candidates[0]!, catalogue);
    // Controlled item, so restricted regardless of how certain the model claimed to be.
    expect(outcome.decision).toBe('restricted');
  });

  /*
   * A schema regression guard, and not a pedantic one. `evidence` was missing from this
   * schema for the whole of the provider's life, which meant the live model had no way to
   * say "I saw this rather than read it", every line silently arrived as `written_text`,
   * and rule 8b — the rule that stops a visual identification being confirmable on its own
   * — could never fire outside the mock. Nothing failed; the safety property was simply
   * absent in production. A missing property is invisible in every other test here, so it
   * is asserted directly.
   */
  it('asks the model for the two fields the safety rules depend on', async () => {
    const { provider, create } = providerReturning(clearNote('IVC-18G-BLUE', 'NS-FLUSH-10ML'));
    await provider.extract(image, context);

    const schema = create.mock.calls[0]?.[0].tools[0].input_schema;
    const line = schema.properties.candidates.items;

    expect(line.properties.evidence.enum).toEqual(['written_text', 'visible_item']);
    expect(line.properties.box.type).toEqual(['object', 'null']);
    // Required, both of them: an optional field is one the model may quietly omit, and an
    // omitted `evidence` defaults to `written_text` — the exact bug, reintroduced.
    expect(line.required).toContain('evidence');
    expect(line.required).toContain('box');
  });

  it('keeps a visual line visual, and carries its box through', async () => {
    const { provider } = providerReturning(seenOnATray('IVC-18G-BLUE', 'NS-FLUSH-10ML'));
    const result = await provider.extract(image, context);

    expect(result.candidates.map((c) => c.evidence)).toEqual(['visible_item', 'visible_item']);
    expect(result.candidates[0]!.box).toEqual({ x: 0.08, y: 0.22, width: 0.3, height: 0.24 });

    // Rule 8b, on the live path for the first time: seeing something is never confirmable
    // on its own, however certain the model claimed to be, and a box does not change that.
    expect(result.candidates.map((c) => evaluateCandidate(c, catalogue).decision)).toEqual([
      'needs_review',
      'needs_review',
    ]);
  });

  it('accepts "I cannot place this" as an answer to the box question', async () => {
    // The alternative — a model forced to invent a box — puts a confident rectangle over
    // the wrong object, which is worse than no rectangle at all.
    const { provider } = providerReturning(seenOnATray('IVC-18G-BLUE', 'NS-FLUSH-10ML'));
    const result = await provider.extract(image, context);

    expect(result.candidates[1]!.box).toBeNull();
  });

  it('fails loudly on output that does not match the schema', async () => {
    const { provider } = providerReturning(malformed);
    await expect(provider.extract(image, context)).rejects.toThrow();
  });

  it('fails loudly when the model replies with prose instead of a tool call', async () => {
    const { provider } = providerReturning(proseOnly);
    await expect(provider.extract(image, context)).rejects.toThrow(/did not return structured output/);
  });
});
