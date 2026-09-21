# The end-to-end workflow

## The shape of it

```
NURSE, in a corridor, <10 seconds          SERVER, while nobody waits
┌────────────────────────────┐             ┌──────────────────────────────────┐
│ /withdrawals/new           │             │ image → storage (opaque key)     │
│  location (preselected)    │──POST──────▶│ WithdrawalSubmission row         │
│  one photo                 │  201 fast   │ status=received                  │
└────────────────────────────┘             └──────────────────────────────────┘
              │                                          │
              ▼                                          ▼
┌────────────────────────────┐             ┌──────────────────────────────────┐
│ /withdrawals/[id]/processing│──POST /extract (compare-and-set)             │
│  "you can leave this page" │             │ ExtractionProvider.extract()     │
│  polls status              │◀──poll──────│ Zod parse → catalogue guard      │
└────────────────────────────┘             │ evaluateCandidate() per line     │
              │                            │ ExtractedCandidate rows          │
              │                            │ ReviewCase for anything unresolved│
              ▼                            └──────────────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────┐
│ /withdrawals/[id]/review                                                    │
│   the photo · what we read · the proposals · plain-language status          │
│   [Confirm withdrawal]  [Edit items]  [Send for supply review]  [Cancel]    │
│   Confirm is disabled while ANY line is unresolved                          │
└─────────────────────────────────────────────────────────────────────────────┘
              │                                    │
   all resolved│                                    │anything doubtful
              ▼                                    ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────────┐
│ POST /confirm  (idempotent)  │    │ /supply-review                           │
│  re-read everything          │    │  filter: location · age · status · risk  │
│  re-run the rules            │    │  match · change quantity · reject ·      │
│  ONE serializable transaction│◀───│  request a physical count · approve      │
│   FOR UPDATE + version check │    │  (every action audited, before → after)  │
│   immutable transactions     │    └──────────────────────────────────────────┘
│   balances + versions        │
│   audit events               │
│   replenishment tasks        │
│   discrepancy cases          │
└──────────────────────────────┘
              │
              ▼
┌──────────────────────────────┐
│ /withdrawals/[id]/confirmed  │   24 → 23, and what it raised
│ /inventory                   │   stock · low stock · movements · tasks
└──────────────────────────────┘
```

## Step by step

### 1. Capture — `/withdrawals/new`

The location is already chosen (`ED_RESUS_02` in the demo). There is a **Take photo**
button and an **Upload photo** button, and above them a line that does not go away:

> Photograph the supply note, used-pack label, or the items themselves. **Do not include
> patient information.**

There is no item list, no quantity field, and no note box. `POST /api/withdrawals` stores
the image, writes one row, and returns — it does not wait for anything to be read.

### 2. Processing — `/withdrawals/[id]/processing`

The screen fires `POST …/extract` and polls. Both are safe to repeat: the extraction is
claimed with a compare-and-set, so a refresh, a retry, or two tabs cannot start a second
read. The screen says, in as many words, that you can leave — because the submission is
already durable.

If the read fails, the submission is **kept**, a review case is opened, and the screen
offers a retry and a route into supply review. A failed read never loses a photo.

### 3. Review — `/withdrawals/[id]/review`

Shows the photo, the raw text (collapsed, one tap to open), and one card per proposed
line: the item, the quantity, what was written, and a status in plain words —
**High confidence**, **Needs review**, or **Cannot identify**. No percentage is shown
anywhere; a number invites arithmetic about risk in a corridor.

Four actions, always visible:

| Action | What it does |
|---|---|
| **Confirm withdrawal** | Deducts stock. Disabled while anything is unresolved, with the reasons listed above the button. |
| **Edit items** | Per line: choose the item (suggestions offered first), fix the quantity, or drop the line. |
| **+ Add an item** | Add a line the reader missed. *Already stocked here* → pick it and set a number. *Not on the list* → a reviewer or admin adds it to the catalogue on the spot; a nurse files a request instead. |
| **Send for supply review** | Hands the whole submission over. Never destructive. |
| **Cancel submission** | Marks it cancelled. The photo, text and proposals are kept for audit. |

### 4. Confirmation — `POST /api/withdrawals/[id]/confirm`

The request body is a proposal to check, never a source of truth. The server re-reads the
submission, its candidates and the location catalogue, re-runs `evaluateSubmission`, and
only then opens one `Serializable` transaction that locks each balance `FOR UPDATE` in id
order, writes immutable transaction rows, updates quantities with a version check, writes
audit events, and raises replenishment tasks and discrepancy cases.

Three overlapping guards make a double-tap harmless, and the loser of a genuine race
retries, finds the work done, and replays the same result rather than showing an error.

### 5. Supply review — `/supply-review`

A queue filtered by location, age, status and risk, sorted with high-risk first. Each case
carries its evidence: the photo, the raw text, what the model proposed, its confidence,
and which rule fired. A reviewer can take the case, match the item, change the quantity,
reject the line, request a physical count, or approve the corrected transaction — which
runs the same confirm service, recorded against their reviewer role.

### 6. Inventory — `/inventory`

Stock by location, low stock first, open replenishment tasks, and the last twenty
movements with `before → after` and a link back to the source photo.

## What an auditor can reconstruct

For any stock change, from the `AuditEvent` chain plus the rows it points at:

| Question | Where it comes from |
|---|---|
| What was the evidence? | `WithdrawalSubmission.imageKey` — the original photo, behind an authorised route |
| What was read? | `WithdrawalSubmission.rawText` and `ExtractedCandidate.rawText` |
| What did the model propose? | `proposedItemId`, `proposedQuantity`, `providerConfidence`, `providerStatus` |
| What did the system decide, and why? | `decision`, `decisionReasonCode` (e.g. `rule_3_multiple_matches`) |
| What did a human change it to? | `resolvedItemId`, `resolvedQuantity`, `resolvedById`, `disposition` |
| What actually moved? | `InventoryTransaction` — immutable, with `quantityBefore`, `quantityDelta`, `quantityAfter` |
| Who, where, when? | `actorId`, `actorRole`, `locationId`, `createdAt` on every row |
| What did it trigger? | `ReplenishmentTask`, `ReviewCase` |
