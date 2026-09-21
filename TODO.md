# Implementation checklist

Each phase ends with: `npm run typecheck`, `npm test`, fix failures, update README,
summarise what changed and what remains. Nothing in a later phase is started early.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Phase 1 — Planning and architecture  `[x]`

- [x] Inspect the repository (empty git repo, no commits, no prior code)
- [x] Review the supplied reference prototype (`write-down-and-scan-it`) for stack,
      design tokens, and lessons already paid for
- [x] `docs/architecture.md`
- [x] `docs/safety-and-decision-rules.md`
- [x] `docs/data-model.md` — data-model proposal
- [x] `docs/assumptions-and-risks.md`
- [x] `TODO.md` (this file)
- [x] Initial `README.md` stating what is planned, what is mocked, and the deployment warning
- [x] **Approved to proceed**

## Phase 2 — Data model  `[x]`

- [x] Project scaffold: Next.js 15 + TypeScript strict + Tailwind + Vitest + ESLint
- [x] `prisma/schema.prisma` — all 11 models and the enums from `docs/data-model.md`
- [x] Initial migration, checked in as SQL; hand-edited partial unique index for
      "one open replenishment task per item/location", plus CHECK constraints for
      ledger arithmetic, withdrawal sign, and quantity/confidence ranges
- [x] `scripts/dev-db.sh` — start/seed a local Postgres 16 cluster for development and tests
- [x] `prisma/seed.ts` — `ED_RESUS_02` + `ED_STORE_01`, 25 items, 59 aliases,
      3 demo accounts, opening balances that make the demo script reachable
- [x] Shared domain types and enum helpers in `lib/domain/`
- [x] `lib/decision/config.ts` — every threshold, env-backed, with defaults
- [x] Unit tests: alias uniqueness across the whole seed; catalogue projection is
      location-scoped (asserted against a real database, including that the unique index
      rejects a colliding alias)
- [x] Unit tests for the decision rules against fixture data (pure, no database)
- [x] typecheck · test · README · summary

## Phase 3 — Core screens + MockExtractionProvider  `[x]`

- [x] Auth: session cookie, `scrypt` hashing, `requireRole()`, `/login` with demo accounts
- [x] `lib/storage/` — `StorageAdapter`, `LocalDiskStorage`, signed image route
- [x] `lib/extraction/` — provider interface, context builder, Zod response schema,
      `MockExtractionProvider` with the three scenarios
- [x] `POST /api/withdrawals` — image + location, responds before extraction
- [x] `POST /api/withdrawals/[id]/extract` — CAS-guarded, idempotent
- [x] `/withdrawals/new` — location preselected to `ED_RESUS_02`, camera + upload,
      privacy guidance, no checklist
- [x] `/withdrawals/[id]/processing` — resumable, poll-based, never loses a submission
- [x] `/withdrawals/[id]/review` — image, raw text, proposals, plain-language confidence,
      four explicit actions, Confirm disabled while anything is unresolved
- [x] Visible "mock provider" badge whenever the active provider is a mock
- [x] typecheck · test · README · summary

## Phase 4 — Extraction architecture hardening  `[x]`

- [x] `AnthropicExtractionProvider` skeleton — inert without `EXTRACTION_PROVIDER=anthropic`
      **and** `ANTHROPIC_API_KEY`
- [x] Provider-response schema validation, including rejection of ids outside the context
      catalogue
- [x] Fixture-driven tests for all three mock scenarios and for malformed responses
- [x] typecheck · test · README · summary

## Phase 5 — Matching and decision rules  `[x]`

- [x] `lib/catalogue/match.ts` — normalisation, exact SKU, exact alias, ambiguity detection,
      fuzzy *suggestions only*
- [x] `lib/decision/rules.ts` — the nine ordered rules, pure
- [x] `canConfirm(submission)` at submission level
- [x] Rules applied on extraction **and** re-applied on confirmation
- [x] Exhaustive unit tests, one per rule plus the ordering cases (restricted-before-ambiguous)
- [x] typecheck · test · README · summary

## Phase 6 — Confirmed inventory transaction  `[x]`

- [x] `POST /api/withdrawals/[id]/confirm` — role check, server-side re-derivation,
      one serializable transaction
- [x] `SELECT … FOR UPDATE` ordered by id + version-conditional updates + bounded retry
- [x] Immutable `InventoryTransaction` rows, balance updates, version increments
- [x] `AuditEvent` per change; `ReplenishmentTask` on threshold crossing
- [x] `NEGATIVE_STOCK_POLICY` — `allow_with_discrepancy` (default) and `block`
- [x] Idempotency: unique `(submissionId, sourceCandidateId)`, `confirmationKey`,
      and the status compare-and-set
- [x] `/supply-review` queue + case detail: match, change quantity, reject, request
      physical check, approve corrected transaction — all audited
- [x] `/inventory` — stock by location, low stock, recent transactions, replenishment tasks
- [x] typecheck · test · README · summary

## Phase 7 — Security and audit  `[x]`

- [x] Role-based authorisation on every route handler and every server action
- [x] Zod validation at every HTTP boundary
- [x] Signed, expiring, role-checked image access
- [x] Audit coverage for upload, extraction, edit, confirm, review, cancel, stock change
- [x] Log hygiene: no image bytes, no raw OCR text, no PII — the logger's field type
      only admits scalars, and key-name redaction is covered by 29 tests
- [x] Security headers, CSRF origin check on mutations, in-memory rate limit on upload and confirm
      (per-instance; a deployment needs Redis or an edge limiter — see README)
- [x] `.env.example` complete; README deployment warning
- [x] typecheck · test · README · summary

## Phase 8 — Testing  `[x]`

- [x] High-confidence unique alias → proposed withdrawal
- [x] Ambiguous alias cannot be confirmed
- [x] Unmatched text creates a review case
- [x] Controlled/high-risk item cannot be self-confirmed by a nurse
- [x] Confirm deducts stock exactly once
- [x] Repeated confirmation is idempotent (including concurrent double-submit)
- [x] Reorder threshold creates a replenishment task (and does not create a second one)
- [x] Insufficient stock follows the configured discrepancy policy, both settings
- [x] Role permissions enforced (nurse / supply_reviewer / admin, each direction)
- [x] Audit events created for every mutating path
- [x] Optimistic-locking conflict is retried and never double-deducts (concurrent
      double-click test: both calls succeed, one deducts, one replays)
- [x] typecheck · test · README · summary

## Phase 9 — Documentation and demo  `[x]`

- [x] `README.md` — install, run, test, what is mocked, what needs configuration
- [x] `docs/workflow.md` — end-to-end flow
- [x] `docs/ai-provider-contract.md` — schema, prompt contract, safety boundaries
- [x] `docs/test-scenarios.md`
- [x] `docs/demo-script.md` — high confidence → ambiguous → reviewer correction →
      confirmation → automatic replenishment task
- [x] Seeded demo accounts and demo data documented
- [x] typecheck · test · README · summary

## Phase 10 — Anthropic provider behind a flag  `[x]`
> **Brought forward.** Classical OCR reads printed text well and handwriting badly, which
> is the whole problem this workflow has. The vision provider is therefore built
> alongside Phase 3/4 rather than last. The mock stays the default.

- [x] `AnthropicExtractionProvider` implemented with image input and strict structured output
- [x] Mock remains the default; no credentials in the repository
- [x] Integration tests driven by saved provider responses only — never a live call
- [x] Catalogue-projection guard tested against a deliberately hostile fixture
      (invented ids, foreign-location ids, injected instructions in the raw text)
- [x] typecheck · test · README · summary

## Phase 11 — Visual recognition that learns  `[x]`
> Photographing an item and naming it makes the system better at that item, without a
> model to retrain. See `docs/visual-recognition.md`.

- [x] `ItemReferencePhoto`: vector, source, who labelled it, agree/overrule counts, soft delete
- [x] `EmbeddingProvider` interface — built-in descriptor by default, CLIP behind a flag
- [x] Pure similarity module: nearest neighbour, confusable pairs, staleness, eviction
- [x] Rule 8b extended — recognised / disagreement / confusable / nothing learned, all `needs_review`
- [x] Teach flow, reference-photo APIs, and the recognition health screen
- [x] Learning from confirmed corrections, with all four guards
- [x] Example cap by redundancy, staleness down-weighting, overrule quarantine
- [x] The invariant asserted directly: no score or example count reaches `eligible`
- [x] typecheck · test · build · README

---

## Phase 12 — Bounding boxes  `[x]`
> The ceiling on Phase 11: a tray photo taught nothing, and most real photos are tray
> photos. A box lets each line be cropped, recognised and learned on its own.
> See `docs/visual-recognition.md` §4b.

- [x] Optional normalised box on the extraction contract, the prompt, and the tool schema
- [x] `evidence` added to the Anthropic tool schema — it was missing, so the live provider
      could never mark a line `visible_item` and rule 8b never fired in production
- [x] `boxX/Y/Width/Height` on `ExtractedCandidate`, all four or none
- [x] Pure `lib/vision/boxes.ts` — validation, crop regions, and the whole overlay layout
- [x] Per-line recognition: crop when boxed, whole image only when alone in the frame
- [x] Learning from crops, so one tray photo teaches one example per item
- [x] `PhotoWithBoxes` — `object-contain`, minimum tap size grown about the centre,
      neighbour-yielding padding, collision-solved labels, two-way card linking,
      remembered hide toggle
- [x] Verified in a real browser at phone width, not only in tests
- [x] typecheck · test · build · docs

### Not built, in value order
- [ ] **Boxes drawn by hand** — a line the reader could not place gets no box, and
      nobody can draw one themselves
- [ ] Capture guidance — nothing tells a nurse the photo is blurry or backlit before they submit
- [ ] A real accuracy measurement on real carts. The tests use synthetic packs.

---

## Definition of done (the acceptance list from the brief)

- [x] A nurse can submit one photo and one location without completing a long form
- [x] The system presents a proposed withdrawal rather than changing stock on upload
- [x] An ambiguous or unreadable item cannot be confirmed as a stock deduction
- [x] Stock is deducted only after an authenticated human confirms
- [x] A double-click or retry cannot deduct stock twice
- [x] Every change has an auditable source image, raw text, proposed value, final value,
      user, location, timestamp, and status
- [x] Low-stock replenishment tasks are created after a confirmed withdrawal
- [x] The system runs end-to-end on mock data with no external AI credentials
- [x] Tests demonstrate high-confidence, ambiguous, restricted, unmatched, low-stock,
      and duplicate-confirmation cases
- [x] The README explains what is mocked, what needs configuration, and why this is not
      ready for clinical deployment without local governance and security review
