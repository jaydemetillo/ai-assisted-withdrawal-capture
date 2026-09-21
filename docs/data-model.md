# Data model proposal (Phase 2)

> Status: **implemented in Phase 2**. This document and `prisma/schema.prisma` are kept
> in step; the schema is the authority if they ever drift.

## Entity map

```
User ──< WithdrawalSubmission >── Location
              │                       │
              │                       ├──< InventoryBalance >── InventoryItem ──< InventoryAlias
              │                       │
              ├──< ExtractedCandidate ─────────────┐
              │            │                      │
              │            └──< ReviewCase        │ (sourceCandidateId, unique per submission)
              │                                   │
              └──< InventoryTransaction ──────────┘
                           │
                           └──> AuditEvent,  ReplenishmentTask
```

## Enumerations

```
Role                nurse | supply_reviewer | admin
SubmissionStatus    received | extracting | awaiting_review | in_supply_review
                    | confirmed | cancelled | failed
ExtractionStatus    pending | running | succeeded | failed
ProviderStatus      high_confidence | ambiguous | unmatched | unreadable | restricted
Decision            eligible | needs_review | ambiguous | unmatched | unreadable | restricted
Disposition         pending | confirmed | corrected | rejected | escalated | applied
EvidenceKind        written_text | visible_item
ReviewCaseKind      ambiguous_candidate | unmatched_candidate | unreadable_candidate
                    | restricted_candidate | stock_discrepancy | extraction_failed
                    | catalogue_request
ReviewCaseStatus    open | in_progress | awaiting_physical_check | resolved | rejected
TaskStatus          open | in_progress | ordered | completed | cancelled
TxnType             withdrawal | correction | reversal
ReferencePhotoSource  taught | learned_from_correction
```

Postgres native enums are used (not strings) so an invalid state cannot be written even by
hand from `psql`.

## Models

### `User`
`id, email (unique), name, passwordHash, role: Role, isActive, createdAt, updatedAt`
Password hashing is `scrypt` from `node:crypto` — no dependency, and adequate for a
prototype whose auth module is expected to be replaced by the hospital IdP.

### `Location`
`id, code (unique, e.g. ED_RESUS_02), name, description, isActive, createdAt`

### `InventoryItem`
`id, sku (unique), displayName, unit, category, isActive, reorderThreshold,
reorderQuantity, isHighRisk, isControlled, createdAt, updatedAt`

Allowed locations are expressed by the existence of an `InventoryBalance` row for that
(item, location) — one representation, so "stocked here" and "permitted here" cannot
disagree. A `catalogueForLocation(locationId)` helper is the only way any provider context
or matcher gets item data.

### `InventoryAlias`
`id, itemId, alias, normalizedAlias, isApproved, createdAt`
`@@unique([normalizedAlias])` — **global** uniqueness, which is what mechanically prevents
an alias mapping to two items. Seed data is asserted against this in a unit test as well,
so a bad alias fails the build rather than at 3 a.m. in a resus bay.

### `InventoryBalance`
`id, itemId, locationId, quantityOnHand, version (Int, default 0), updatedAt`
`@@unique([itemId, locationId])`, indexed on `locationId`.
`version` is the optimistic lock. Every write is
`UPDATE … SET quantityOnHand = $q, version = version + 1 WHERE id = $id AND version = $seen`.

### `WithdrawalSubmission`
`id, submitterId, locationId, imageKey, imageMediaType, imageBytes,
status: SubmissionStatus, extractionStatus: ExtractionStatus, extractionProvider,
extractionModel, rawText (Text, nullable), extractionError (nullable),
extractionStartedAt, extractionCompletedAt, confirmedAt, confirmedById,
confirmationKey (unique, nullable), cancelledAt, createdAt, updatedAt`

`confirmationKey` holds the idempotency key of the first successful confirmation; a replay
with the same key returns the stored result rather than repeating the work.

### `ExtractedCandidate`
`id, submissionId, sequence, rawText, proposedQuantity (nullable), proposedItemId
(nullable), matchedItemId (nullable), providerConfidence, providerStatus: ProviderStatus, providerReason,
decision: Decision, decisionReasonCode, decisionMessage,
resolvedItemId (nullable), resolvedQuantity (nullable),
disposition: Disposition, resolvedById, resolvedAt, createdAt`
`@@unique([submissionId, sequence])`

Three columns hold three different opinions, permanently: `proposedItemId` is what the
**provider** claimed, `matchedItemId` is what the **application's own matcher** concluded
independently of it, and `resolvedItemId` is what a **human** chose. That is what lets an
audit answer "the model said X, the rules said Y, the nurse chose Z" — losing any one of
them would make the trail unable to say who decided what, on what evidence.

### `InventoryTransaction` — immutable
`id, submissionId (nullable), sourceCandidateId (nullable), itemId, locationId, type: TxnType,
quantityDelta (Int, negative for a withdrawal), quantityBefore, quantityAfter,
actorId, actorRole: Role, reason, reviewCaseId (nullable), createdAt`
`@@unique([submissionId, sourceCandidateId])` ← the hard idempotency guarantee.

No update or delete path exists in application code. A mistake is corrected by writing a
`correction` or `reversal` row, never by editing history.

### `ReplenishmentTask`
`id, itemId, locationId, triggeredByTransactionId, quantityAtTrigger, reorderThreshold,
suggestedQuantity, status: TaskStatus, assignedToId, createdAt, updatedAt, completedAt`
A partial unique index keeps at most one `open` task per (item, location), so five
withdrawals in a shift do not produce five identical tasks.

### `ReviewCase`
`id, submissionId (nullable), candidateId (nullable), itemId (nullable), locationId,
kind: ReviewCaseKind, status: ReviewCaseStatus, priority, openedAt, openedById,
assignedToId, resolvedAt, resolvedById, resolutionNote, createdAt, updatedAt`
Indexed on `(status, locationId, createdAt)` to serve the queue's filters (location, age,
status, risk) without a sequential scan.

### `AuditEvent` — append-only
`id, actorId (nullable, for system events), actorRole (nullable), action, entityType,
entityId, submissionId (nullable), locationId (nullable), beforeValue (Json, nullable),
afterValue (Json, nullable), correlationId, createdAt`
Indexed on `(entityType, entityId)`, `(submissionId)`, `(createdAt)`.
`beforeValue`/`afterValue` never contain image bytes or raw OCR text — they carry ids,
quantities, and statuses.

### `ItemReferencePhoto` — the learned index
`id, itemId, locationId, imageKey, mediaType, bytes, embedding (Float[]), embeddingModel,
dimensions, source: ReferencePhotoSource, labelledById (nullable), submissionId
(nullable), sourceCandidateId (unique, nullable), timesAgreed, timesOverruled, isActive,
retiredAt, retiredReason, createdAt, updatedAt`

Three constraints carry weight:

1. **`locationId` is part of every read.** Different bays stock different things in
   different light; an example from one is evidence about another only by coincidence.
2. **`embeddingModel` is stored with the vector.** Vectors from two providers are
   unrelated coordinates, and the cosine between them is noise that looks exactly like a
   score. Reads filter to the active model, so changing providers makes the index read as
   empty rather than subtly wrong.
3. **`sourceCandidateId` is unique.** A replayed confirmation cannot teach the same
   lesson twice.

`embedding` is a Postgres `double precision[]`. A few hundred rows of a few hundred
floats is nothing, and brute-force cosine over it beats the query that fetched them.

Retirement is soft. A removed or quarantined example stops being used on the very next
photograph and stays visible on the recognition screen, so *"why did it stop recognising
this?"* has an answer.

`ExtractedCandidate` also gained `visualMatchItemId`, `visualMatchScore` and
`visualMatchPhotoIds`, recorded whatever the rules then did with them — the three-column
audit (model / matcher / learned index) is only worth having if the third column is
written down even when it was overruled.

It also carries `boxX` / `boxY` / `boxWidth` / `boxHeight`: where the line is in the
photograph, as fractions of the **prepared** image (after EXIF rotation and resizing),
never pixels. All four are null together — a partial box is not a box, and drawing one
from whatever survived produces a rectangle anchored at the origin that reads as a bug.
The box is what lets a multi-item photograph be cropped per line, which is what lets it
teach anything at all. See `lib/vision/boxes.ts`.

Indexed on `(locationId, isActive, embeddingModel)` and `(itemId, locationId, isActive)`.

## Seed data (Phase 2)

- **Location** `ED_RESUS_02` — "ED Resus Bay 02" (plus a second location, `ED_STORE_01`,
  so "not stocked at this location" is a testable state rather than a hypothetical).
- **25 inventory items** representative of an emergency cart: IV access, fluids, airway,
  dressings, syringes/needles, monitoring consumables, and a small number flagged
  `isControlled` or `isHighRisk` (e.g. a controlled analgesic, adrenaline, a defibrillator
  pad set) so the restricted path has real data to exercise.
- **Two blue cannulas** — `IVC-18G-BLUE` ("IV cannula 18G blue") and `IVC-22G-BLUE`
  ("IV cannula 22G blue") — so that *"blue cannula"* is genuinely ambiguous in the demo,
  exactly as specified, while *"18G blue cannula"* still matches exactly one item.
- **Aliases**, none mapping to more than one item:
  `"18g blue cannula" → IVC-18G-BLUE`, `"blue cannula" → IVC-18G-BLUE`,
  `"saline flush" → NS-FLUSH-10ML`, and 55 more (59 in total).
  > **Note on the specified `"blue cannula" → IVC-18G-BLUE` alias.** The brief also
  > requires *"blue cannula"* to be ambiguous in the demo. Both hold: the alias makes
  > `IVC-18G-BLUE` a candidate, and rule 4 (more than one catalogue match) still fires
  > because `IVC-18G-BLUE-SAFETY` also matches on normalised name. **Ambiguity wins over
  > an alias hit** — an alias can only produce `eligible` when it is the *sole* match.
  > This is called out explicitly because it is the single most important behaviour in the
  > demo, and it is asserted by a unit test.
- **Demo accounts**: `nurse@demo.local`, `reviewer@demo.local`, `admin@demo.local`,
  shared development password, printed by the seed script and documented in the README.
- Opening balances chosen so that one specific demo withdrawal crosses a reorder threshold
  and one specific demo withdrawal exceeds on-hand stock — the low-stock and discrepancy
  paths are reachable by following the demo script, not by contriving data.

## Migrations

Prisma migrations, checked in as reviewable SQL (`prisma/migrations/`). `prisma db push`
is not used outside of scratch work. Partial unique indexes (the one-open-task rule) are
added via a hand-edited migration, since Prisma's schema language cannot express them.
