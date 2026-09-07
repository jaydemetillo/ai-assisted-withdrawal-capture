import * as z from 'zod/v4';

/**
 * What the model is asked to return for one written line.
 *
 * `bbox` is normalized to a 0-1000 box so it survives any resize between the photo the
 * model saw and the <img> the browser lays out. It drives the translation-style chips
 * that sit over the handwriting.
 */
export const OcrLineSchema = z.object({
  rawText: z.string().describe('The line exactly as written, including any crossings-out.'),
  quantity: z
    .number()
    .int()
    .nullable()
    .describe('How many units. null when the number is genuinely unreadable - never guess.'),
  itemGuess: z.string().describe('The item as written, e.g. "Masks".'),
  sku: z
    .string()
    .nullable()
    .describe('SKU from the supplied catalogue if you are confident, else null.'),
  confidence: z.number().min(0).max(1).describe('0-1 confidence in this whole line.'),
  bbox: z
    .array(z.number())
    .length(4)
    .describe('[x0,y0,x1,y1] of the line, normalized to a 0-1000 canvas.'),
});

export const OcrResultSchema = z.object({
  documentAction: z
    .enum(['withdraw', 'dispose', 'unknown'])
    .describe(
      'withdraw if the note says withdrawn/taken/used; dispose if it says disposed/discarded/expired/wasted; unknown if neither appears.',
    ),
  actionEvidence: z
    .string()
    .describe('The words on the page that decided documentAction, or "" if none.'),
  transcript: z.string().describe('Everything written on the page, as plain text.'),
  lines: z.array(OcrLineSchema),
});

export type OcrLine = z.infer<typeof OcrLineSchema>;
export type OcrResult = z.infer<typeof OcrResultSchema>;

export type CatalogueEntry = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  aliases: string[];
};

/** A line after catalogue matching, ready to become a CaptureLine. */
export type ResolvedLine = {
  rawText: string;
  itemId: string | null;
  itemGuess: string;
  quantity: number;
  confidence: number;
  needsReview: boolean;
  bbox: [number, number, number, number] | null;
  matchSource: 'MODEL' | 'FUZZY' | 'MANUAL' | 'NONE';
};

/**
 * Who read the note.
 *
 * `device` is the free route: Tesseract's LSTM engine in WebAssembly, in the browser
 * that took the photo. `claude` is the paid vision call. `mock` is the labelled fixture
 * shown when neither is available, and `typed` is a list that arrived as text. The
 * review screen branches on this, so a fixture can never be dressed up as a real read.
 */
export type OcrProvider = 'claude' | 'device' | 'mock' | 'typed';

export type OcrOutcome = {
  provider: OcrProvider;
  model: string;
  result: OcrResult;
};
