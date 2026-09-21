import Anthropic from '@anthropic-ai/sdk';
import { extractionResultSchema, type ExtractionResult } from '@/lib/domain/extraction';
import { prepareImageForVision } from '@/lib/extraction/image';
import { buildExtractionPrompt } from '@/lib/extraction/prompt';
import type { ExtractionContext, ExtractionProvider, ProviderImage } from '@/lib/extraction/provider';
import { log } from '@/lib/log';

/**
 * Claude vision, behind a feature flag.
 *
 * Inert unless BOTH `EXTRACTION_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set. The
 * default local demo never reaches this file, and there are no credentials in this
 * repository.
 *
 * Why a vision model rather than classical OCR: Tesseract and its kin are trained on
 * printed text and do badly on handwriting, which is the entire input here. The gap is
 * not closable by tuning. What closes it is a model that reads handwriting well, GIVEN
 * the catalogue, so the task is constrained selection from 25 known items rather than
 * open-vocabulary transcription.
 *
 * It will still be wrong sometimes. That is why nothing it returns can move stock: the
 * rules in lib/decision treat every field here as a proposal, re-check every item id
 * against the catalogue, and route anything doubtful to a human.
 */
const DEFAULT_MODEL = 'claude-opus-5';

/** What the vision API accepts. Anything else must be converted before it is sent. */
const VISION_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type VisionMediaType = (typeof VISION_MEDIA_TYPES)[number];

function isSupportedByVision(value: string): value is VisionMediaType {
  return (VISION_MEDIA_TYPES as readonly string[]).includes(value);
}
const TOOL_NAME = 'report_withdrawal_candidates';

/** The structured-output contract. Mirrors `extractionResultSchema` exactly. */
const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    rawText: {
      type: 'string',
      description: 'Everything legible on the page, as plain text. Omit anything identifying a patient.',
    },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rawText: { type: 'string', description: 'This line exactly as written.' },
          /*
           * Without this the model has no way to mark a line as something it SAW rather
           * than something it read, every candidate silently defaults to `written_text`,
           * and rule 8b — the rule that stops a visual identification being confirmable
           * on its own — never fires in production. The mock could produce visual lines
           * and the real provider could not, which is the worst possible split.
           */
          evidence: {
            type: 'string',
            enum: ['written_text', 'visible_item'],
            description:
              'written_text when somebody wrote this line down; visible_item when you recognised the object itself with no writing.',
          },
          box: {
            type: ['object', 'null'],
            description:
              'Where this is in the image, as fractions of the image between 0 and 1. null when you cannot place it confidently.',
            properties: {
              x: { type: 'number', description: 'Left edge, 0-1.' },
              y: { type: 'number', description: 'Top edge, 0-1.' },
              width: { type: 'number', description: 'Width as a fraction of the image, 0-1.' },
              height: { type: 'number', description: 'Height as a fraction of the image, 0-1.' },
            },
            required: ['x', 'y', 'width', 'height'],
          },
          proposedQuantity: {
            type: ['integer', 'null'],
            description: 'How many units. null when the number is not legible — never guess.',
          },
          proposedItemId: {
            type: ['string', 'null'],
            description: 'An id= value from the allowed catalogue, exactly, or null.',
          },
          confidence: {
            type: 'number',
            description: '0-1, based only on legibility and match uniqueness.',
          },
          status: {
            type: 'string',
            enum: ['high_confidence', 'ambiguous', 'unmatched', 'unreadable', 'restricted'],
          },
          reason: { type: 'string', description: 'One short sentence on why this status.' },
        },
        required: [
          'rawText',
          'evidence',
          'proposedQuantity',
          'proposedItemId',
          'confidence',
          'status',
          'reason',
          'box',
        ],
      },
    },
  },
  required: ['rawText', 'candidates'],
};

/** The slice of the SDK this provider uses, so a test can supply its own. */
export type MessagesClient = {
  messages: { create: (body: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };
};

export function anthropicIsConfigured(): boolean {
  return process.env.EXTRACTION_PROVIDER === 'anthropic' && Boolean(process.env.ANTHROPIC_API_KEY);
}

export class AnthropicExtractionProvider implements ExtractionProvider {
  readonly name = 'anthropic';
  readonly isMock = false;
  readonly model: string;

  private readonly client: MessagesClient;

  /**
   * `client` is a test seam. The integration tests drive this provider with saved
   * responses rather than live calls — no credentials, no cost, and the parsing and
   * catalogue-guard behaviour is still exercised for real.
   */
  constructor(client?: MessagesClient) {
    if (!client && !process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'AnthropicExtractionProvider needs ANTHROPIC_API_KEY. Leave EXTRACTION_PROVIDER unset to use the offline mock.',
      );
    }
    this.model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    this.client = client ?? new Anthropic({ maxRetries: 2, timeout: 60_000 });
  }

  async extract(image: ProviderImage, context: ExtractionContext): Promise<ExtractionResult> {
    const prepared = await prepareImageForVision(image.data, image.mediaType);
    if (!isSupportedByVision(prepared.mediaType)) {
      throw new Error(
        `The photo could not be converted for reading (it is ${prepared.mediaType}). Please retake it as a JPEG.`,
      );
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Report the withdrawal lines visible in the image.',
          input_schema: TOOL_SCHEMA,
        },
      ],
      // Forcing the tool means we get structured data or an error — never prose to scrape.
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: prepared.mediaType as VisionMediaType,
                data: prepared.data.toString('base64'),
              },
            },
            { type: 'text', text: buildExtractionPrompt(context) },
          ],
        },
      ],
    });

    const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
    if (!block || block.type !== 'tool_use') {
      throw new Error('The extraction model did not return structured output.');
    }

    // The trust boundary. A malformed response fails the extraction loudly rather than
    // being coerced into something plausible.
    const parsed = extractionResultSchema.parse(block.input);

    log.info('extraction completed', {
      provider: this.name,
      model: this.model,
      imageKey: image.key,
      preparedBytes: prepared.data.byteLength,
      candidates: parsed.candidates.length,
      // Never the text itself. Its length is enough to debug a truncated read.
      rawTextLength: parsed.rawText.length,
    });

    return parsed;
  }
}
