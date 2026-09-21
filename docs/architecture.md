# Architecture — AI-Assisted Withdrawal Capture

> Status: **built**. Every part of this document is implemented and tested; where it
> says "will", read "does". `TODO.md` tracks the checklist and `docs/test-scenarios.md`
> maps each claim to the test that proves it.

## 1. The problem this system solves

During a resuscitation a nurse takes what they need from the emergency cart immediately.
Stopping to record each item is unsafe and, in practice, simply does not happen — so the
cart's recorded stock drifts from its real stock, and replenishment is late.

The system does **not** try to capture the withdrawal during the emergency. It gives the
nurse a way to record it in the ten seconds *afterwards*: one photograph of whatever
evidence exists — a scribbled note, a torn pack label, the open drawer — and a short
confirmation screen. Everything expensive (reading, matching, judging) happens between
those two moments, on the server, where the nurse is not waiting on it.

### What this system is not

It is an **inventory** workflow. It does not infer treatment, dose, indication, or
anything about a patient, and it must not be extended to do so without a separate
clinical-safety process. See `docs/safety-and-decision-rules.md`.

## 2. The Tier-4 pipeline

```
 ┌─ nurse, <10s ─────────┐   ┌─ server, async ──────────────────┐   ┌─ human ──────────┐
 │                       │   │                                  │   │                  │
 │  photo + location     │──▶│  store image (never the photo    │──▶│  review screen   │
 │  POST /api/withdrawals│   │  in a log)                       │   │  confirm / edit  │
 │                       │   │      ↓                           │   │  / escalate      │
 └───────────────────────┘   │  ExtractionProvider.extract()    │   └────────┬─────────┘
                             │  (mock by default)               │            │
                             │      ↓                           │            ▼
                             │  Zod-validate provider output    │   ┌──────────────────┐
                             │      ↓                           │   │ POST .../confirm │
                             │  catalogue projection guard      │   │ (idempotent)     │
                             │  (drop any id not at location)   │   └────────┬─────────┘
                             │      ↓                           │            │
                             │  DETERMINISTIC decision rules    │            ▼
                             │  → per-candidate decision        │   ┌──────────────────┐
                             │      ↓                           │   │ one DB tx:       │
                             │  unresolved? → ReviewCase        │   │ version-checked  │
                             │                                  │   │ balance updates, │
                             └──────────────────────────────────┘   │ immutable txns,  │
                                                                    │ audit events,    │
                                                                    │ replenishment    │
                                                                    └──────────────────┘
```

Three properties are structural, not conventions:

1. **Extraction writes to `ExtractedCandidate` only.** No extraction code path holds a
   reference to `InventoryBalance`. Stock cannot move on upload because the code that
   moves stock is not reachable from the code that reads images.
2. **The confirm endpoint is the single writer of stock.** Everything else — reviewer
   corrections included — feeds it.
3. **The application, not the model, decides confirmability.** The provider returns a
   `status` and a `confidence`; both are *inputs* to `lib/decision/rules.ts`, which is a
   pure function with no network and no database access, and is unit-tested directly.

## 3. Stack and why

| Concern | Choice | Why this one |
|---|---|---|
| App | Next.js 15, App Router, TypeScript strict | Server Components let the review screen render from the database with no client fetch waterfall; route handlers give us plain REST for the write paths. |
| Styling | Tailwind CSS | Mobile-first utility classes; no runtime cost on a phone over hospital Wi-Fi. |
| Database | PostgreSQL 16 | Real transactions, `SELECT … FOR UPDATE`, and conditional `UPDATE … WHERE version = $n`. The concurrency story here is the product. |
| ORM | Prisma 6 | Typed access, interactive transactions, and migrations we can review as SQL. |
| Validation | Zod 4 | One schema used for both the HTTP boundary and the provider-response boundary. |
| Tests | Vitest 3 | Pure-function unit tests plus integration tests against a real local Postgres. |
| Auth | Cookie session, `scrypt` password hashing, roles in the database | Deliberately boring. A real deployment swaps this module for the hospital IdP; nothing else changes. |

## 4. Module layout (proposed)

```
app/
  (auth)/login/                     sign-in for the seeded demo accounts
  withdrawals/new/                  Screen 1 — photo + location, nothing else
  withdrawals/[id]/processing/      Screen 2 — resumable progress
  withdrawals/[id]/review/          Screen 3 — proposal + confirmation
  supply-review/                    Screen 4 — reviewer queue
  supply-review/[caseId]/           one case: match, correct, reject, physical check
  inventory/                        Screen 5 — stock, low stock, transactions, tasks
  api/
    withdrawals/route.ts                     POST  create submission (image + location)
    withdrawals/[id]/extract/route.ts        POST  run extraction (idempotent, CAS-guarded)
    withdrawals/[id]/route.ts                GET   status polling for the processing screen
    withdrawals/[id]/candidates/[cid]/route.ts PATCH nurse edit of one proposed line
    withdrawals/[id]/confirm/route.ts        POST  THE ONLY STOCK WRITER
    withdrawals/[id]/escalate/route.ts       POST  send to supply review
    withdrawals/[id]/cancel/route.ts         POST  cancel submission
    review-cases/[id]/…                      reviewer actions
    images/[key]/route.ts                    GET   authorised, time-limited image access
lib/
  auth/            session cookie, password hashing, requireRole()
  catalogue/       location-scoped catalogue projection + alias index
  decision/        rules.ts  ← pure, deterministic, the heart of the safety story
                   config.ts ← every threshold, read from env, documented defaults
  extraction/      provider.ts (interface), mock.ts, anthropic.ts, schema.ts, context.ts
  inventory/       confirm.ts (the transaction), balances.ts, replenishment.ts
  storage/         adapter.ts (interface), local.ts, s3.ts (documented skeleton)
  audit/           record() — the only way anything writes AuditEvent
  db.ts            Prisma singleton
prisma/
  schema.prisma, migrations/, seed.ts
tests/
  unit/            rules, matching, schema validation — no database
  integration/     confirm endpoint, idempotency, locking, roles, audit — real Postgres
docs/
```

## 5. Request lifecycles

### 5.1 Submission (the ten-second path)

`POST /api/withdrawals` — multipart: one image, one `locationId`.

1. `requireRole('nurse' | 'supply_reviewer' | 'admin')`.
2. Validate: media type in {jpeg, png, webp, heic→re-encoded client-side}, size ≤
   `MAX_IMAGE_BYTES` (default 12 MB), `locationId` is a location the user may use.
3. `storage.put()` → opaque object key. The image bytes never touch a log line.
4. Create `WithdrawalSubmission` with `status = 'received'`,
   `extractionStatus = 'pending'`.
5. `audit.record('submission.created')`.
6. Respond `201 { id }` — **before any extraction work**. The nurse is done here.

The client then navigates to `/withdrawals/[id]/processing`, which fires
`POST …/extract` and polls `GET …`. Both are safe to repeat and safe to abandon: the
submission row is already durable, so closing the phone loses nothing.

### 5.2 Extraction

`POST /api/withdrawals/[id]/extract` is a compare-and-set:

```
UPDATE "WithdrawalSubmission"
   SET "extractionStatus" = 'running', "extractionStartedAt" = now()
 WHERE id = $1 AND "extractionStatus" IN ('pending','failed')
```

Zero rows updated means someone else is already running it (or it is done) — return the
current state. That is the whole concurrency control; no queue, no lock table.

The provider is then called with an `ExtractionContext` built from the **location's own
catalogue only**. On return:

1. Parse with the Zod schema. A malformed response fails the extraction *loudly*
   (`extractionStatus = 'failed'`, a `ReviewCase` of kind `extraction_failed`) rather
   than being coerced into something plausible.
2. Discard any `proposedItemId` that is not in the context catalogue — a provider that
   invents or remembers an id is treated as having matched nothing.
3. Run `evaluateCandidate()` per candidate → persist `ExtractedCandidate` rows carrying
   both the provider's claim and the application's decision.
4. If any candidate is unresolved, open a `ReviewCase` (the nurse may still resolve the
   easy ones on the review screen; the case closes when nothing is unresolved).
5. `extractionStatus = 'succeeded'`, `status = 'awaiting_review'`, audit event.

Extraction never throws away the image or the raw text. A failed read is still a durable
submission with evidence attached, which is what makes it reviewable by a human.

### 5.3 Confirmation — the only stock write

`POST /api/withdrawals/[id]/confirm`, body `{ idempotencyKey, lines: [{candidateId, itemId, quantity}] }`.

Everything is re-derived server-side; the request body is a *proposal to check*, never a
source of truth:

1. Re-fetch submission, candidates, and the location catalogue.
2. Re-run the decision rules against current data. A candidate that became restricted
   since the review screen rendered blocks the confirmation.
3. Reject if the actor may not confirm this submission (`nurse` = own submissions,
   non-restricted lines only; `supply_reviewer`/`admin` = broader, audited).
4. Single Prisma interactive transaction, `Serializable` isolation:
   1. `SELECT … FOR UPDATE` each `InventoryBalance` row (ordered by id, to avoid deadlock),
   2. conditional `UPDATE … WHERE id = $id AND version = $seen` — a zero-row update aborts
      and the whole call retries (up to `CONFIRM_MAX_RETRIES`, default 3),
   3. insert `InventoryTransaction` rows (never updated, never deleted),
   4. write new quantities and `version = version + 1`,
   5. insert `AuditEvent` rows,
   6. insert `ReplenishmentTask` where the new quantity crossed `reorderThreshold` and no
      open task exists,
   7. insert a discrepancy `ReviewCase` where requested > on-hand (see policy below),
   8. `UPDATE … SET status='confirmed' WHERE id=$1 AND status='awaiting_review'`.

**Idempotency** is enforced three ways, deliberately overlapping:
- unique `(submissionId, sourceCandidateId)` on `InventoryTransaction`;
- unique `idempotencyKey` on the submission's confirmation record;
- the status compare-and-set in step 8.
A second click finds `status = 'confirmed'`, skips the transaction entirely, and returns
the **same** confirmation result it returned the first time.

### 5.4 Reviewer path

A `ReviewCase` is worked in `/supply-review`. Every reviewer action — match an item,
change a quantity, reject a candidate, request a physical check — writes an `AuditEvent`
carrying the before value, the after value, and the reviewer id. When the reviewer
approves, the same `confirm` service runs, with `actorRole = 'supply_reviewer'` recorded
on the resulting `InventoryTransaction`.

## 6. Adapters

### 6.1 Storage

```ts
interface StorageAdapter {
  put(bytes: Buffer, mediaType: string): Promise<StoredImage>   // → { key, mediaType, bytes }
  get(key: string): Promise<{ bytes: Buffer; mediaType: string }>
  delete(key: string): Promise<void>
  signedUrl(key: string, ttlSeconds: number): Promise<string>
}
```

`LocalDiskStorage` (default; writes under `.data/uploads`, key is a UUID, path traversal
impossible because the key never reaches `path.join` unsanitised) and an `S3Storage`
skeleton that documents exactly what a production deployment must configure. Images are
served only through `GET /api/images/[key]`, which requires a session **and** an HMAC
token bound to the key, the user, and an expiry.

### 6.2 Extraction

```ts
interface ExtractionProvider {
  readonly name: string
  readonly isMock: boolean
  extract(image: StoredImage, context: ExtractionContext): Promise<ExtractionResult>
}
```

`ExtractionContext` carries the location id and name, and the location-filtered catalogue
(id, sku, display name, unit, aliases, `isControlled`, `isHighRisk`). It carries no
patient data, no user identity, and no items from other locations.

- **`MockExtractionProvider`** is the default and needs no credentials or network. It
  returns one of three fixtures, selected deterministically (a `?scenario=` hint in
  development, otherwise a hash of the image bytes) so every demo case is reproducible:
  high-confidence, ambiguous, unreadable.
- **`AnthropicExtractionProvider`** is inert unless `EXTRACTION_PROVIDER=anthropic` **and**
  `ANTHROPIC_API_KEY` are both set. Structured output is forced with `tool_choice`; the
  image is EXIF-rotated, capped at 1568 px and contrast-normalised first; it is tested
  against saved response fixtures, never a live call. See `docs/ai-provider-contract.md`.

When the active provider `isMock`, the UI shows a persistent, unmissable badge. There are
no fake success states anywhere in this application.

## 7. Configuration

Every business rule is an environment variable with a documented default
(`lib/decision/config.ts`, mirrored in `.env.example` and `docs/safety-and-decision-rules.md`):

| Variable | Default | Effect |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | `0.90` | Below this, a candidate needs review regardless of its status. |
| `NEGATIVE_STOCK_POLICY` | `allow_with_discrepancy` | `allow_with_discrepancy` \| `block` |
| `RESTRICTED_SELF_CONFIRM` | `false` | Whether a nurse may ever confirm a controlled/high-risk line. |
| `MAX_LINE_QUANTITY` | `50` | Above this a line needs review (guards a misread "1" as "100"). |
| `EXTRACTION_PROVIDER` | `mock` | `mock` \| `anthropic` |
| `MAX_IMAGE_BYTES` | `12582912` | Upload limit. |
| `IMAGE_URL_TTL_SECONDS` | `300` | Lifetime of a signed image link. |
| `CONFIRM_MAX_RETRIES` | `3` | Optimistic-locking retries before failing the confirmation. |

## 8. Failure behaviour

| Failure | What the nurse sees | What the system does |
|---|---|---|
| Provider times out or errors | "We could not read this photo. It is saved — send it to supply review." | `extractionStatus='failed'`, submission retained, `ReviewCase` opened. Retry is one tap and is CAS-guarded. |
| Provider returns malformed JSON | Same as above | Schema failure is logged **without** the raw text or image; the response is not salvaged. |
| Provider proposes an unknown item id | That line shows as "Cannot identify" | The id is dropped before the rules run. |
| Network drops mid-upload | Standard retry; nothing is half-created | The submission row is created only after the image is durably stored. |
| Two devices confirm at once | One succeeds, the other shows the same confirmation | Version check + status CAS. |
| Requested > on-hand | Confirmation succeeds, banner explains a discrepancy was raised | Per `NEGATIVE_STOCK_POLICY`. |

## 9. Deliberate non-goals for this prototype

Barcode/QR scanning, offline queueing, push notifications, multi-tenant hospitals,
cart-level par-level optimisation, and any integration with an EHR or a real materials
management system. Each is a reasonable next step; none is needed to demonstrate that the
safety properties hold.
