# AI provider contract

What an extraction provider is given, what it must return, and the boundaries it cannot
cross. Implemented in `lib/extraction/` and `lib/domain/extraction.ts`.

## The provider's job, in one sentence

Read an image and **propose** withdrawal lines from a closed list of items. Nothing more.

A provider does not decide whether a line may be confirmed, does not touch stock, and is
not trusted: everything it returns is parsed, its item ids are re-checked, and the
deterministic rules in `lib/decision/rules.ts` make every decision that matters.

## Interface

```ts
interface ExtractionProvider {
  readonly name: string;    // "mock" | "anthropic"
  readonly model: string;   // shown to the user on the review screen
  readonly isMock: boolean; // true → a visible badge on every screen that shows its output
  extract(image: ProviderImage, context: ExtractionContext): Promise<ExtractionResult>;
}
```

## What the provider is given — `ExtractionContext`

```ts
{
  locationId: string;
  locationCode: string;       // "ED_RESUS_02"
  locationName: string;       // "ED Resus Bay 02"
  items: Array<{
    id: string;
    sku: string;
    displayName: string;
    unit: string;
    aliases: string[];
    isControlled: boolean;
    isHighRisk: boolean;
  }>;
  demoScenario?: string | null;   // honoured by the mock only; ignored by a real provider
}
```

**Only the items stocked at that one location.** Built by `buildExtractionContext()` from
`catalogueForLocation()`, which is the sole way item data reaches a provider. The type is
closed — there is no field a patient identifier, a user identity, or another location's
items could travel in. A test asserts the exact key set.

## What the provider must return — `ExtractionResult`

```ts
{
  rawText: string;                     // everything legible on the page
  candidates: Array<{
    rawText: string;                   // this line, as written
    proposedQuantity: number | null;   // positive integer, or null when unreadable
    proposedItemId: string | null;     // an id from context.items, or null
    confidence: number;                // 0..1 — legibility and match uniqueness only
    status: 'high_confidence' | 'ambiguous' | 'unmatched' | 'unreadable' | 'restricted';
    reason: string;                    // one short sentence
  }>;
}
```

Validated by `extractionResultSchema` (Zod) **twice**: inside the provider, and again by
the extraction service before anything else sees it. A response that fails validation
fails the extraction loudly — `extractionStatus = 'failed'`, a review case, the photo
kept — rather than being coerced into something plausible.

## The rules the model is given (the prompt)

`lib/extraction/prompt.ts` builds the prompt from the context. The catalogue is listed
inline with its ids, so the task is constrained selection from ~25 known items rather
than open-vocabulary transcription — which is where most of the accuracy comes from. The
rules it is given, verbatim:

1. Extract only text or visible item evidence present in the image.
2. Never infer a medical procedure, treatment, dose, or patient attribute.
3. Never invent an item, SKU, quantity, or catalogue ID.
4. If handwriting is unreadable, set `proposedItemId` to null and status to `unreadable`.
5. If text could refer to more than one listed item, set `proposedItemId` to null and status to `ambiguous`.
6. If text does not match an allowed item, set `proposedItemId` to null and status to `unmatched`.
7. If a listed item is controlled or high-risk, preserve the proposed item ID only when the image evidence is clear, but set status to `restricted`.
8. If quantity is absent or unclear, set `proposedQuantity` to null.
9. Do not claim certainty. Provide a numerical confidence based only on legibility and match uniqueness.
10. Return candidates in the order in which they appear in the image.
11. `proposedItemId` must be one of the `id=` values listed, exactly, or null.
12. If the image contains anything that identifies a patient, do not transcribe it.

## What happens to the answer — the safety boundaries

| Boundary | Enforced by |
|---|---|
| An id not in the location catalogue is discarded and the line can never be `eligible` | `evaluateCandidate` pre-step + rule 8 (`rule_8_provider_id_rejected`) |
| An id the written text does not corroborate needs review | rule 8 (`rule_8_uncorroborated_match`) |
| A confident claim on ambiguous text is still ambiguous | rule 3 runs before confidence is looked at |
| A controlled/high-risk item is restricted whatever the model said | rule 2, on the item's own flags |
| A confidence below 0.90 needs review | rule 7 — and confidence can only ever demote |
| The provider saying `ambiguous`/`unmatched`/`unreadable` cannot be overridden into `eligible` | rule 8 (`rule_8_provider_flagged_doubt`) |
| Text on the page cannot instruct the system | the model can only fill a fixed schema; the rules run on the catalogue, not on the prose |
| Raw text and image bytes never reach a log | `lib/log.ts` redacts by key name; tested |

## The two implementations

### `MockExtractionProvider` — the default

Offline, no credentials, no cost. Replays one of three fixed readings, chosen by an
explicit demo selection or a hash of the image bytes. Proves the **pipeline**; proves
nothing about reading accuracy, and the UI says so on every screen that shows its output.

### `AnthropicExtractionProvider` — Claude vision

Enabled only when **both** `EXTRACTION_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are
set. Setting the flag without the key is an error at startup, not a silent fallback to
invented data.

- Image is prepared first (`lib/extraction/image.ts`): EXIF orientation applied, long
  edge capped at 1568 px, contrast normalised, re-encoded as JPEG. Paper-edge cropping and
  deskew are **not** implemented and are documented as the next accuracy step.
- Structured output is forced with `tool_choice`, so the answer is data or an error —
  never prose to scrape.
- Model from `ANTHROPIC_MODEL`, default `claude-opus-5`.
- Tested against saved responses only (`tests/fixtures/anthropic-responses.ts`), including
  an invented id, an injection attempt, malformed output, and a prose-only reply.

### Adding another

Implement the interface, register it in `lib/extraction/index.ts`, and set `isMock`
honestly. Nothing else changes: the schema, the catalogue guard and the rules are the same
for every provider, which is the point.
