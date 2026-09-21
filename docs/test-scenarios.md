# Test scenarios

`npm test` — 465 tests. Unit tests are pure; integration tests run against a real
PostgreSQL database (`TEST_DATABASE_URL`) and skip **visibly** if none is reachable.

## The acceptance cases from the brief

| Scenario | Test | What it proves |
|---|---|---|
| High-confidence unique alias → proposed withdrawal | `rules.test.ts` › rule 9; `extract.test.ts` › clear note | `"18G blue cannula x1"` becomes an `eligible` line pointing at `IVC-18G-BLUE` |
| Ambiguous alias cannot be confirmed | `rules.test.ts` › rule 3; `submission.test.ts`; `confirm.test.ts` › refuses ambiguous | `"blue cannula"` matches two items and the confirm service throws; stock unchanged |
| Unmatched text creates a review case | `extract.test.ts`; `rules.test.ts` › rule 4 | An `unmatched_candidate` case is opened with the photo and text preserved |
| Controlled/high-risk cannot be self-confirmed | `confirm.test.ts` › restricted items | A nurse is refused on morphine; a supply reviewer succeeds, recorded as their role |
| Confirm deducts exactly once | `confirm.test.ts` › deducts exactly once | Two transaction rows, each balance down by exactly its line |
| Repeated confirmation is idempotent | `confirm.test.ts` › idempotent; › double-click | Second and third calls replay; two concurrent calls → one deduction, both succeed |
| Reorder threshold creates a replenishment task | `confirm.test.ts` › replenishment | Saline flush 21 → 19 crosses 20; one task, not a second while it is open |
| Insufficient stock follows the policy | `confirm.test.ts` › insufficient stock | Default: records, goes to −1, raises a discrepancy. `block`: refuses, still raises a case |
| Role permissions are enforced | `permissions.test.ts`; `auth.test.ts` | Nurse own-only; reviewer/admin any; tokens tamper-proof and expiring |
| Audit events are created | `extract.test.ts`; `confirm.test.ts` › audit trail | Every mutating path writes events with before/after and no extracted text |

## The properties that make the above trustworthy

| Property | Test |
|---|---|
| Extraction changes **no** balance and **no** version, however clear the note | `extract.test.ts` › changes no stock at all |
| Ambiguity beats an approved alias hit | `rules.test.ts` › ambiguity beats an alias |
| Restricted is checked before ambiguous | `rules.test.ts` › rule 2 wins |
| Confidence cannot promote past rules 1–6 | `rules.test.ts` › rule 7 |
| An invented item id is discarded and blocks `eligible` | `rules.test.ts` › rule 8; `anthropic-provider.test.ts` |
| Text on the page cannot instruct the system | `rules.test.ts` › injected instruction; `anthropic-provider.test.ts` › injection |
| A malformed provider response fails loudly | `anthropic-provider.test.ts` |
| Provider context has no field for patient data | `extraction.test.ts` › closed key set |
| No alias maps to two items, in the seed **and** in the database | `seed-catalogue.test.ts`; `catalogue.test.ts` › unique index |
| Catalogue is location-scoped | `catalogue.test.ts`; `match.test.ts` |
| Log lines cannot carry content | `log.test.ts` |
| A malformed config value refuses to start | `config.test.ts` |
| The rules are deterministic | `rules.test.ts` › determinism |

## Running them

```bash
npm run db:up      # once
npm test           # everything
npx vitest run tests/unit          # pure, no database, < 1 s
npx vitest run tests/integration   # real Postgres
```
