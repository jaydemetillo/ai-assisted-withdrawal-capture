import { createHash } from 'node:crypto';
import type { ExtractionResult } from '@/lib/domain/extraction';
import { extractionResultSchema } from '@/lib/domain/extraction';
import type { ExtractionContext, ExtractionProvider, ProviderImage } from '@/lib/extraction/provider';
import { isMockScenario, MOCK_SCENARIOS, type MockScenario } from '@/lib/extraction/scenarios';

export * from '@/lib/extraction/scenarios';

/**
 * The offline provider. It is the default, and it invents everything it returns.
 *
 * It exists to prove the PIPELINE — that a photo becomes a proposal, that an ambiguous
 * line cannot be confirmed, that a confirmation moves stock exactly once. It proves
 * nothing whatsoever about reading accuracy, and no claim in this repository is based on
 * its output. The UI shows a badge whenever it is active.
 *
 * Scenario selection is deterministic: an explicit demo choice if one was made, otherwise
 * a hash of the image bytes. The same photo therefore always produces the same reading,
 * which is what makes a demo repeatable and a test meaningful.
 */
function pickScenario(image: ProviderImage, context: ExtractionContext): MockScenario {
  if (isMockScenario(context.demoScenario)) return context.demoScenario;
  const digest = createHash('sha256').update(image.data).digest();
  return MOCK_SCENARIOS[(digest[0] ?? 0) % MOCK_SCENARIOS.length] as MockScenario;
}

function findId(context: ExtractionContext, sku: string): string | null {
  return context.items.find((item) => item.sku === sku)?.id ?? null;
}

function buildResult(scenario: MockScenario, context: ExtractionContext): ExtractionResult {
  switch (scenario) {
    case 'high_confidence':
      return {
        rawText: '18G blue cannula x1\nsaline flush x2',
        candidates: [
          {
            rawText: '18G blue cannula x1',
            evidence: 'written_text',
            proposedQuantity: 1,
            proposedItemId: findId(context, 'IVC-18G-BLUE'),
            confidence: 0.97,
            status: 'high_confidence',
            reason: 'Legible, and the words match one catalogue item.',
            // Deliberately short and close to the line below it: at phone width this
            // band is under the 44px minimum and its neighbour is ~9px away, so the
            // demo exercises both the centre-growth and the yielding padding rather
            // than only the easy case.
            box: { x: 0.12, y: 0.22, width: 0.7, height: 0.1 },
          },
          {
            rawText: 'saline flush x2',
            evidence: 'written_text',
            proposedQuantity: 2,
            proposedItemId: findId(context, 'NS-FLUSH-10ML'),
            confidence: 0.95,
            status: 'high_confidence',
            reason: 'Legible, and "saline flush" is a listed alias for one item.',
            box: { x: 0.12, y: 0.345, width: 0.7, height: 0.1 },
          },
        ],
      };

    case 'ambiguous':
      return {
        rawText: 'blue cannula x1',
        candidates: [
          {
            rawText: 'blue cannula x1',
            evidence: 'written_text',
            proposedQuantity: 1,
            // The provider itself declines to choose. Even if it had chosen, the
            // application would still find two matches and refuse the line.
            proposedItemId: null,
            confidence: 0.82,
            status: 'ambiguous',
            reason: 'More than one listed item is described by these words.',
            box: { x: 0.14, y: 0.3, width: 0.66, height: 0.12 },
          },
        ],
      };

    case 'visible_items':
      return {
        rawText: '',
        candidates: [
          {
            rawText: 'Opened cannula wrapper, blue wings, 18G marking visible',
            evidence: 'visible_item',
            proposedQuantity: 1,
            proposedItemId: findId(context, 'IVC-18G-BLUE'),
            confidence: 0.88,
            status: 'high_confidence',
            reason: 'Packaging recognised; the gauge marking is legible on the wrapper.',
            // Two items nearly touching on a tray — the case that fuses into one blob
            // under uniform padding. The gap here is 0.02 of the frame.
            box: { x: 0.08, y: 0.3, width: 0.4, height: 0.34 },
          },
          {
            rawText: 'Two used 10 mL saline flush syringes on the tray',
            evidence: 'visible_item',
            proposedQuantity: 2,
            proposedItemId: findId(context, 'NS-FLUSH-10ML'),
            confidence: 0.74,
            status: 'high_confidence',
            reason: 'Recognised by shape and label; the count is from what is visible.',
            box: { x: 0.5, y: 0.33, width: 0.38, height: 0.3 },
          },
        ],
      };

    // One item in shot and nothing written — the only shape the recogniser can honestly
    // learn from, and therefore the only demo scenario that exercises the learning loop.
    // `visible_items` above deliberately holds two, because a whole-image vector cannot
    // be attributed to one of several lines. See lib/vision/recognize.ts.
    case 'single_item':
      return {
        rawText: '',
        candidates: [
          {
            rawText: 'A single sealed packet on the bench, blue and white, no writing legible',
            evidence: 'visible_item',
            proposedQuantity: 1,
            proposedItemId: null,
            confidence: 0.6,
            status: 'ambiguous',
            reason: 'One item in shot. The packaging is recognisable but the label is not legible.',
            box: { x: 0.24, y: 0.26, width: 0.5, height: 0.46 },
          },
        ],
      };

    case 'unreadable':
      return {
        rawText: '? gauze maybe',
        candidates: [
          {
            rawText: '? gauze maybe',
            evidence: 'written_text',
            proposedQuantity: null,
            proposedItemId: null,
            confidence: 0.21,
            status: 'unreadable',
            reason: 'The handwriting could not be made out and no quantity is legible.',
            // No box on purpose. A line nobody could read is a line nobody can point at,
            // and the demo should show what the screen does with that.
            box: null,
          },
        ],
      };
  }
}

export class MockExtractionProvider implements ExtractionProvider {
  readonly name = 'mock';
  readonly model = 'fixture-v1';
  readonly isMock = true;

  async extract(image: ProviderImage, context: ExtractionContext): Promise<ExtractionResult> {
    const scenario = pickScenario(image, context);
    // Parsed with the same schema a real provider's output goes through, so the mock can
    // never drift into returning a shape the real pipeline would reject.
    return extractionResultSchema.parse(buildResult(scenario, context));
  }
}
