import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { OcrResultSchema, type CatalogueEntry, type OcrOutcome } from '@/lib/ocr/types';
import { buildPrompt } from '@/lib/ocr/prompt';

export const OCR_MODEL = 'claude-opus-5';

const SUPPORTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
type SupportedMedia = (typeof SUPPORTED)[number];

export function isSupportedMedia(value: string): value is SupportedMedia {
  return (SUPPORTED as readonly string[]).includes(value);
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Read a photographed handwritten list with Claude vision.
 *
 * One call does the whole job - transcription, item matching against the catalogue,
 * quantity parsing, withdraw-vs-dispose inference and bounding boxes - because splitting
 * OCR from parsing loses the context that makes the parse good. The model can see that
 * "NS 500ml" sits in a column of quantities and that "Withdrawn" at the bottom applies
 * to the whole page.
 *
 * `output_config.format` constrains the reply to OcrResultSchema, so we get validated
 * JSON rather than prose we have to scrape.
 */
export async function readHandwriting(
  image: Buffer,
  mediaType: string,
  catalogue: CatalogueEntry[],
  storeroomName: string,
): Promise<OcrOutcome> {
  if (!hasApiKey()) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  if (!isSupportedMedia(mediaType)) {
    throw new Error(`Unsupported image type "${mediaType}". Use PNG, JPEG, GIF or WebP.`);
  }

  const client = new Anthropic();

  const response = await client.beta.messages.parse({
    model: OCR_MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    // A stock list is a benign request, but a refusal would otherwise stop the capture
    // dead with nothing to show the nurse; server-side fallback re-runs it transparently.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { format: betaZodOutputFormat(OcrResultSchema) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: buildPrompt(catalogue, storeroomName) },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('The image could not be processed. Try retaking the photo.');
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error('Could not read a structured list from that photo. Try retaking it.');
  }

  return { provider: 'claude', model: OCR_MODEL, result: parsed };
}
