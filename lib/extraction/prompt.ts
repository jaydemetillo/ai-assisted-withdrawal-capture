import type { ExtractionContext } from '@/lib/extraction/provider';

/**
 * The extraction prompt.
 *
 * Two things make this accurate, and only one of them is the model:
 *
 *  1. The catalogue is IN the prompt. The job is not open-ended transcription of
 *     handwriting — it is "read this note, then pick from these 25 things". Constrained
 *     selection is dramatically more accurate than free reading, and it is why a vision
 *     model beats classical OCR here by more than the model quality alone would suggest.
 *  2. The model is told, explicitly and repeatedly, to return null rather than guess.
 *     An honest "I could not read this" routes to a human; a confident guess corrupts
 *     stock. The rules in lib/decision assume the model will sometimes be wrong anyway.
 *
 * Nothing in this prompt asks for, or permits, anything about a patient.
 */
export function buildExtractionPrompt(context: ExtractionContext): string {
  const catalogue = context.items
    .map((item) => {
      const flags = [item.isControlled ? 'CONTROLLED' : null, item.isHighRisk ? 'HIGH_RISK' : null]
        .filter(Boolean)
        .join(', ');
      const aliases = item.aliases.length > 0 ? ` | also written as: ${item.aliases.join('; ')}` : '';
      return `- id=${item.id} | sku=${item.sku} | ${item.displayName} (${item.unit})${aliases}${
        flags ? ` | ${flags}` : ''
      }`;
    })
    .join('\n');

  return `<role>
You are an inventory-document extraction service.
You do not make clinical decisions and you do not update inventory.
</role>

<task>
Read the supplied image and extract possible inventory withdrawal entries.

The image may be a handwritten note, a used-pack label, a drawer or module label, or
simply the used items themselves with no writing at all. Any of these is valid evidence.
Return only the required structured output.
</task>

<location_context>
Location: ${context.locationName}
Location ID: ${context.locationId}
Only items from the supplied allowed catalogue may be proposed.
</location_context>

<allowed_catalogue>
${catalogue}
</allowed_catalogue>

<evidence_kinds>
Every candidate says where it came from, and the two are held to different standards.

"written_text" — somebody wrote it down. Put the line as written in rawText.

"visible_item" — no writing; you recognised the thing itself: an opened wrapper, a used
syringe on a tray, a pack in a drawer. Put a short factual description of what you can
SEE in rawText — "opened cannula wrapper, blue wings, 18G marking visible" — not a
conclusion like "a cannula was used". Describe the evidence, and let the description be
checkable by a person looking at the same photo.

A visual identification is never taken as final: it is always shown to a person to
confirm. So do not inflate confidence to be helpful, and do not guess a count you cannot
actually see. Counting objects in a photograph is the thing most likely to be wrong —
if items overlap, or some are partly out of frame, set proposedQuantity to null and say
so in reason.
</evidence_kinds>

<where_it_is>
Every candidate may carry a "box" saying where in the image you found it.

Coordinates are FRACTIONS OF THIS IMAGE, between 0 and 1, never pixels and never
percentages. x and y are the TOP-LEFT corner; width and height extend right and down. A
box round something in the middle of the frame therefore looks roughly like
{"x": 0.35, "y": 0.4, "width": 0.3, "height": 0.25}.

Draw the box round THE ITEM ITSELF, or round the written line — not round the tray, the
bench, the whole page, or a generous region containing it. Somebody is going to look at
this rectangle to check your answer, so a box round the wrong thing is worse than no box.

Set box to null whenever you cannot place the item confidently: it is spread across the
frame, hidden behind something, or you inferred it rather than saw it. A null box costs
nothing. A confident box round the wrong object costs trust.
</where_it_is>

<rules>
1. Extract only text or visible item evidence present in the image. Set evidence to
   "written_text" or "visible_item" for every candidate.
2. Never infer a medical procedure, treatment, dose, or patient attribute.
3. Never invent an item, SKU, quantity, or catalogue ID.
4. If handwriting is unreadable, set proposedItemId to null and status to "unreadable".
5. If text could refer to more than one listed item, set proposedItemId to null and status to "ambiguous".
6. If text does not match an allowed item, set proposedItemId to null and status to "unmatched".
7. If a listed item is controlled or high-risk, preserve the proposed item ID only when the image evidence is clear, but set status to "restricted".
8. If quantity is absent or unclear, set proposedQuantity to null.
9. Do not claim certainty. Provide a numerical confidence based only on legibility and match uniqueness.
10. Return candidates in the order in which they appear in the image.
11. proposedItemId must be one of the id= values listed above, exactly, or null.
12. If the image contains anything that identifies a patient, do not transcribe it. Leave it out of rawText entirely.
13. A word describing the action or the page itself — "withdrawn", "taken", "used", "disposed", "wasted", a date, a ward name, a signature — is not an item. Put it in rawText, but do NOT return it as a candidate. Only lines naming supplies become candidates.
14. Read the quantity from whatever form it is written in: "3x mask", "mask x3", "3 masks" and "masks - 3" all mean a quantity of 3.
15. When a photograph shows BOTH writing and items, prefer the writing: it is what the person recorded they took. Add a visible_item candidate only for something the writing does not cover.
16. Give a box for every candidate you can actually place, and null for every one you
    cannot. One box per candidate — if two of the same item sit side by side as one
    line, box the pair.
17. Identify an item by what is visibly distinctive — a gauge marking, a colour-coded wing or cap, a printed pack name, a size. Do not identify by general shape alone when the catalogue holds several similar items; set proposedItemId to null and status to "ambiguous" instead.
</rules>`;
}
