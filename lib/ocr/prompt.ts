import type { CatalogueEntry } from '@/lib/ocr/types';

/**
 * The catalogue goes into the prompt so the model can name a SKU directly instead of us
 * fuzzy-matching free text afterwards. Aliases are included because they are the forms
 * people actually write.
 */
export function catalogueBlock(catalogue: CatalogueEntry[]): string {
  return catalogue
    .map((c) => `${c.sku} | ${c.name} | unit: ${c.unit} | also written as: ${c.aliases.join(', ')}`)
    .join('\n');
}

export function buildPrompt(catalogue: CatalogueEntry[], storeroomName: string): string {
  return `You are reading a photograph of a handwritten stock list written by a nurse in ${storeroomName}.

Transcribe it and turn it into structured line items.

CATALOGUE (match against this; use the SKU in the first column):
${catalogueBlock(catalogue)}

Rules:
- One entry in "lines" per item written on the page. Ignore headings, ward names,
  signatures, dates and the action word itself - those are not line items.
- "quantity" is how many units were taken. Handle every format people write:
  "3x Masks", "Masks x 3", "3 Masks", "Syringe 10ml - 8", "NS 500ml ...... 3".
- A unit word is NOT the quantity. In "Gloves (M) x 2 boxes" the quantity is 2.
- If a quantity is genuinely unreadable (a scribble, "??", a smudge), set quantity to
  null. Do not guess a number. A null sends the row to a human, which is the correct
  outcome; a guessed number silently moves real stock.
- "sku" must be null unless you are confident. A wrong SKU is worse than no SKU.
- "confidence" is your honest read of the whole line, 0 to 1. Be strict: use below 0.75
  when the handwriting is ambiguous, the item is heavily abbreviated, or you are unsure
  which catalogue entry it is. Those rows get shown to a human for confirmation.
- "documentAction": "withdraw" if the page says withdrawn / taken / used / issued;
  "dispose" if it says disposed / discarded / expired / wasted / binned; "unknown" if
  neither appears. Put the deciding words in "actionEvidence".
- "bbox" is [x0,y0,x1,y1] for the written line, on a 0-1000 by 0-1000 canvas over the
  whole image, regardless of the image's real pixel size. Cover the text tightly.
- If the photo shows no legible list at all, return an empty "lines" array rather than
  inventing entries.`;
}
