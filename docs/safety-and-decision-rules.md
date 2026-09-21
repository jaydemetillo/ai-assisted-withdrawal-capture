# Safety model and decision rules

> Status: **implemented**. `lib/decision/rules.ts` and `lib/decision/submission.ts` are
> this document in code, and `tests/unit/rules.test.ts` asserts every rule below. If the
> two ever disagree, the code is a bug — these rules are the specification.

## 1. The seven principles

1. **AI never changes stock.** OCR, vision, and matching produce *proposals* only.
2. **A human confirmation is mandatory** before any deduction, every time, with no
   "trusted user" or "high confidence" bypass.
3. **Doubt blocks.** Ambiguous, unreadable, unmatched, quantity-unknown, controlled, or
   high-risk → never deducted automatically.
4. **Doubt is preserved, not discarded.** Those cases go to the supply-review queue with
   the original image and the raw extracted text intact.
5. **The nurse's path is fast.** Photo + location, under ten seconds, no checklist.
6. **No patient identifiers.** Not collected, not stored, not sent to a provider. The
   capture screen says so in plain words.
7. **Inventory only.** No treatment, dosage, indication, or patient inference — not in the
   prompt, not in the schema, not in the UI.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Provider status** | What the extraction model claims: `high_confidence`, `ambiguous`, `unmatched`, `unreadable`, `restricted`. Untrusted input. |
| **Decision** | What the *application* determined, deterministically: `eligible`, `needs_review`, `ambiguous`, `unmatched`, `unreadable`, `restricted`. Authoritative. |
| **Disposition** | The final human outcome for a candidate: `pending`, `confirmed`, `corrected`, `rejected`, `escalated`, `applied`. |
| **Resolved** | Disposition is `confirmed`, `corrected`, or `rejected`. A rejected candidate is resolved *and* contributes no stock movement. |
| **Confirmable** | Every candidate is resolved, at least one will move stock, and no resolved-to-apply candidate carries a blocking decision. |

A candidate therefore always carries three things: what the model said, what the rules
decided, and what a human did about it. Losing any one of them would make the audit trail
unable to answer "who decided this, and on what evidence".

## 3. Decision rules

`evaluateCandidate(candidate, catalogue, config) → DecisionOutcome` in
`lib/decision/rules.ts` is a **pure function**. No I/O, no clock, no randomness — so the
tests are exhaustive and the behaviour is identical on a phone, in CI, and in an audit
reconstruction two years from now.

### Two pre-steps, before any rule runs

1. **The provider's item id is validated against the location catalogue.** An id that is
   not in it — invented, hallucinated, or remembered from another location — is
   discarded and the candidate is marked `providerIdRejected`. A candidate carrying a
   rejected id can never reach `eligible` (rule 8).
2. **Our own matcher runs on the written text**, independently of anything the provider
   claimed. The provider's id is only ever used to *widen* the match set when our matcher
   found nothing at all — never to narrow it, and never to overrule an ambiguity we found.

### The rules, in order. First match wins.

| # | `reasonCode` | Condition | Decision | Shown as |
|---|---|---|---|---|
| 1 | `rule_1_unreadable` | Provider status is `unreadable`, **or** the text contains no readable words | `unreadable` | Cannot identify |
| 2 | `rule_2_restricted_item` | **Every** plausible match is `isControlled` or `isHighRisk` | `restricted` | Needs review |
| 3 | `rule_3_multiple_matches` | More than one catalogue item matches the text | `ambiguous` | Needs review |
| 4 | `rule_4_no_match` | Nothing in this location's catalogue matches | `unmatched` | Cannot identify |
| 5 | `rule_5_not_stocked_here` | The match is inactive or not stocked at this location | `unmatched` | Cannot identify |
| 6 | `rule_6_quantity_unclear` / `rule_6_quantity_above_limit` | Quantity is null, ≤ 0, non-integer, or above `MAX_LINE_QUANTITY` | `needs_review` | Needs review |
| 7 | `rule_7_low_confidence` | `confidence` < `CONFIDENCE_THRESHOLD` (default **0.90**) | `needs_review` | Needs review |
| 8 | `rule_8_provider_flagged_doubt` / `rule_8_provider_id_rejected` / `rule_8_uncorroborated_match` | The provider flagged doubt itself, named an id outside the catalogue, or named an item the written text does not corroborate | `needs_review` | Needs review |
| 9 | `rule_9_unique_match` | Exactly one match, usable quantity, nothing flagged | `eligible` | High confidence |

**Rule 2 is checked before rule 3 on purpose.** A controlled item that is *also* ambiguous
must surface as restricted, because "this is a controlled item" governs *who may act*, and
that question outranks "which of these two was it".

**But only when every reading is restricted.** If some matches are restricted and some are
not, the line is ambiguous and a human picks. That loses no safety — the restriction is
checked again on whatever item they choose, at confirmation, in `evaluateSubmission`.
Escalating regardless would mean a nurse writing *"syringes"* goes to supply review
because the cart happens to stock an adrenaline prefilled syringe: friction with nothing
bought for it.

### What counts as a match

Matching is deterministic, case- and punctuation-insensitive, and runs **only** against
the location-scoped catalogue. An item matches a phrase when any of:

- the phrase equals its **SKU**;
- the phrase equals an **approved alias**;
- the phrase equals its **display name**;
- **every word of the phrase appears within one single catalogue string** — its display
  name, or one of its aliases. Tokens may not be collected across several strings: "blue"
  from one alias and "gloves" from another do not combine into a match nobody wrote.

Two normalisations make that work on real handwriting, and both are inflection rather
than fuzziness — as deterministic as lowercasing:

- **Plurals are folded.** People write "4x syringes"; the catalogue says "Syringe 10 mL
  luer lock". Tokens of three letters or fewer are left alone, because the domain's own
  shorthand lives there ("ns", "gas").
- **Bare counts are dropped from the written side only.** "3 masks", "masks 3" and
  "masks - 3" all mean the same thing, and the count already arrives separately as
  `proposedQuantity`. Numbers glued to a unit or size survive, because there they name
  the item rather than count it: "18g", "10ml", "500ml", "10x10". The catalogue keeps
  every token it has; only the handwriting is read leniently.

`tests/unit/handwriting.test.ts` asserts that seven different ways of writing the same
line reach an identical decision. A matcher tuned to one example is a matcher that fails
on the next person's handwriting.

That last form is what makes real handwriting work, and — just as importantly — what makes
ambiguity visible. *"blue cannula"* matches every blue cannula stocked, so the rules can
refuse it.

**Fuzzy similarity is used only to suggest options to a human.** It can move a line from a
dead-end "Cannot identify" to "did you mean one of these?". It can never produce
`eligible`. Mixing the two is the classic way these systems go wrong: a fuzzy score creeps
into the confirm path, and one day "20G" becomes "18G" because the letters mostly agreed.

### Ambiguity beats an alias

The seeded catalogue contains both `IVC-18G-BLUE` and `IVC-22G-BLUE`, and *"blue cannula"*
is an approved alias of the 18G. It is **still** not confirmable, because the words also
describe the 22G. An alias only produces `eligible` when it is the **sole** match.

This is the single most important behaviour in the system. It is asserted by a test, and
it is the reason a sloppy alias added by an operator later degrades to "please choose"
rather than to a silent wrong deduction.

### Confidence is an input, not a proof

A `confidence` of `0.99` on a candidate whose text matches two items is still ambiguous.
Confidence can only ever **demote** a candidate (rule 7). There is deliberately no rule of
the form "confidence is high, therefore correct".

## 4. Submission-level rules

- **`canConfirm(submission)`** is true only when every candidate is resolved, at least one
  resolved candidate will move stock, and the submission status is `awaiting_review`.
- A submission containing **any** unresolved candidate cannot be bulk-confirmed. The UI
  disables the button *and* the server re-checks; the client-side disable is a courtesy,
  not the control.
- A **nurse** may confirm only candidates with decision `eligible`, plus candidates they
  corrected to an eligible state by choosing an explicit catalogue item and a positive
  quantity. A nurse may **never** confirm a `restricted` candidate while
  `RESTRICTED_SELF_CONFIRM=false` (the default).
- A **supply_reviewer** may resolve any candidate, including restricted ones, and may
  approve a corrected transaction. Every such action is audited with before/after values.
- Sending to supply review is always available and never destructive.

### Lines identified by sight rather than by writing

A photograph may contain no writing at all — used packaging on a tray, a drawer of stock,
a wrapper. The provider may identify those items, and marks the line `evidence:
visible_item`.

**Such a line can never be `eligible`** (rule 8b). The reasoning is about the strength of
the evidence, not the cleverness of the model:

- A **written** line is a person's own record of what they took. Our matcher then checks
  that text against the catalogue *independently of the model*. Two sources agree.
- A **visual** line is one opinion about a photograph, with no text for anything to
  corroborate. And counting objects in a photo — "how many syringes are in this pile" — is
  exactly the question a model answers confidently and wrongly.

So a visual identification is a good suggestion that a human confirms, which is the
product working rather than a limitation of it. Restricted and ambiguous still take
precedence: seeing a morphine ampoule is `restricted`, not merely `needs_review`.

Visual lines are also **matched as prose**. Handwriting is terse ("3x mask"), so the
matcher asks whether every written word appears in a catalogue entry. A description is a
sentence — "blue pleated surgical mask with ear loops" — and words like "pleated" appear in
no catalogue, so that test fails on an item that is plainly visible. For prose the
containment runs the other way: does a catalogue entry appear *inside* the description?
Entries of a single word are skipped, because "pads" or "bvm" would match almost any
sentence. This looser matching is only safe because a visual line cannot be confirmed
without a human: the worst a loose match can do is put a wrong suggestion in front of
somebody, never move stock.

### What the learned index is allowed to change

Once a location has reference photos (see `docs/visual-recognition.md`), a visual line
carries a second, independent opinion: the nearest labelled photograph taken *at this
location*, by these people, of this packaging. It is consulted only for `visible_item`
lines, and only when the photo holds exactly one item — a whole-image vector cannot be
attributed to one of four things on a tray.

It changes three things and no others:

| It may change | It may never change |
|---|---|
| Which item is proposed (`matchedItemId`) | The decision — always `needs_review` |
| Which alternatives are offered | Whether a human has to look |
| What the card says | Whether a restricted item can be self-confirmed |

So rule 8b now has four branches, all of them `needs_review`:

| Reason code | When |
|---|---|
| `rule_8_visual_recognised` | The index and the description agree, or only the index found it |
| `rule_8_visual_disagreement` | They point at different items — both are offered, neither is chosen |
| `rule_8_visual_confusable` | Two stocked items are not separable by photograph — both are offered and the label is named |
| `rule_8_visual_identification` | Nothing learned yet; the original behaviour, unchanged |

A **bounding box changes none of this.** It says where in the photograph to look, which
makes a suggestion easier to check and makes per-item cropping — and therefore per-item
learning — possible. A boxed visual line is `needs_review` at any score, exactly as an
unboxed one is, and a box is never evidence of anything.

**An index with ten thousand examples has exactly the same authority as an empty one.**
That is the property to check first if you change anything here, and
`tests/unit/learned-recognition.test.ts` asserts it directly across every combination of
score, example count and agreement count.

Rules 2 and 3 still take precedence. Recognising a morphine ampoule perfectly is still a
`restricted` line, because the rule governing *who may act* outranks the one about *what
it is*.

### Lines added by hand

A person may add a line the reader never produced — the photo missed it, or nothing was
legible. Such a line is stored with `isManual = true`, `proposedItemId = null` and
`providerConfidence = 0`: no model claimed anything, and recording a confidence of 1 would
invent an agreement that never happened. An audit can therefore always separate *the model
read this* from *a person typed this*.

Everything else still applies. The item must be stocked at that location, the quantity is
range-checked, and a controlled or high-risk item added by hand is still `restricted` and
still cannot be self-confirmed by a nurse.

### Adding an item the catalogue does not have

Restricted to supply reviewers and admins. The rules work by refusing anything the
location does not stock; that refusal is worthless if any user can invent a row in the
middle of a withdrawal. A nurse who needs something added raises a `catalogue_request`
case instead — recorded, with the photo attached, and moving no stock.

Two guards on creation, both because a bad catalogue row is permanent:

- A duplicate display name is refused. Two rows with the same name would make every
  future match of that phrase ambiguous, for everybody, forever.
- The written phrase is saved as an alias only if no other item already owns it. A
  colliding alias would make BOTH items ambiguous, which is worse than no alias at all.

## 5. Stock-level policy

| Situation | Default behaviour (`NEGATIVE_STOCK_POLICY=allow_with_discrepancy`) | Alternative (`block`) |
|---|---|---|
| Requested ≤ on-hand | Deduct. | Deduct. |
| Requested > on-hand | Deduct the full requested amount (the items physically left the cart), let the balance go negative, and open a `stock_discrepancy` `ReviewCase` + a `ReplenishmentTask`. The confirmation screen says so plainly. | Refuse the confirmation, open a `ReviewCase`, and tell the nurse to send it to supply review. |

The default is deliberate: the withdrawal already happened. Refusing to record it would
make the ledger *more* wrong, not less. The discrepancy case is how the mismatch gets
investigated.

## 6. What is audited

Every one of these writes an `AuditEvent` — append-only, never updated or deleted:

`submission.created`, `image.stored`, `image.accessed`, `extraction.started`,
`extraction.succeeded`, `extraction.failed`, `candidate.decided`, `candidate.edited`,
`submission.escalated`, `submission.cancelled`, `submission.confirmed`,
`transaction.created`, `balance.changed`, `review_case.opened`, `review_case.action`,
`review_case.closed`, `replenishment.created`, `auth.login`, `auth.denied`.

Each event records: actor id and role, action, entity type and id, submission id, location
id, `beforeValue`, `afterValue`, timestamp, and a request correlation id. Between the
submission (image + raw text), the candidate (proposed value + decision + reason), and the
transaction (final value), every stock change can be traced to **an image, a raw string, a
proposal, a final value, a user, a location, a timestamp, and a status**.

## 7. Privacy boundaries

- The capture screen carries a permanent instruction: *"Photograph the supply note, used
  pack label, or items. Do not include patient information."*
- No schema field anywhere accepts a patient identifier. There is no free-text note field
  on the nurse path that is sent to a provider.
- Raw OCR text and image bytes are **never** written to application logs, client-side
  console output, or error-tracking payloads. Log lines carry ids and lengths only.
- Images are reachable only through an authenticated, role-checked, time-limited route.
- The default local demo sends **nothing** to any external service. The Anthropic provider
  is inert without both an explicit flag and a key.
- Retention is deliberately a configured decision, not a default: see the README warning.

## 8. Known limits of this prototype

- The decision rules cannot detect a *confidently wrong* read of a legible note that
  happens to match a real catalogue item (e.g. "18G" written where "20G" was meant). The
  mitigation is the human confirmation screen showing the proposal in large, plain text —
  not a threshold.
- Alias uniqueness is enforced at seed time and by constraint; an operator who adds a
  colliding alias later will see those lines become ambiguous, which is the safe failure.
- The mock provider proves the *pipeline*, not real-world reading accuracy. No accuracy
  claim in this repository is based on the mock. It refuses to run unannounced on a
  deployed host, because a reader that ignores the photo and returns a plausible supply
  list is the single most dangerous thing in this design — it was found in testing, when
  a photographed prescription came back as "18G blue cannula x1" marked High confidence.
  Every screen showing mock output now says the reading is invented, and no mock line is
  presented as high confidence.
- None of this constitutes a regulatory, privacy, or security assessment. See the README.
