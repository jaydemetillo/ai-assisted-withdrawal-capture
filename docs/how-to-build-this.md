# How to build this

A guide to building an **"AI reads a photo, a human decides"** workflow — for designers and
engineers, assuming no prior context.

It covers what the thing is, why every piece exists, everything that went wrong while
building it, and what I'd do differently. The mistakes are real and most of them were not
obvious in advance, so if you only read one section, read **Part 4**.

---

## Part 1 — The idea, in plain words

### The problem

A nurse is in a resuscitation. They grab three masks, four syringes and some saline from
the emergency cart. They do **not** stop to log it — stopping to log it would be dangerous,
and in practice nobody does.

So the cart's recorded stock drifts from its real stock. Nobody notices until the cart is
empty at the worst possible moment.

### The idea

Don't capture the withdrawal *during* the emergency. Capture it in the ten seconds
**afterwards** — photograph whatever evidence exists (a scribbled note, a torn pack label,
the open drawer) and tap confirm on a short summary.

```
        DURING                        AFTER (10 seconds)
   ┌──────────────┐             ┌───────────────────────┐
   │ Grab what    │             │ 📷 photo               │
   │ you need.    │    ───▶     │  → "is this right?"    │
   │ Log nothing. │             │  → ✔ Confirm           │
   └──────────────┘             └───────────────────────┘
```

### The one rule

> **The AI suggests. A human decides. Only the human's decision changes stock.**

Everything else in this document is a consequence of that sentence.

**Explain it like I'm five:** the computer may *point at things and guess*. It may not
*touch the cupboard*. Only a person touches the cupboard, and only after looking at what the
computer pointed at.

### Why not just let the AI update stock?

Because it will be wrong sometimes and you won't know when.

If a model misreads "20G" as "18G" and writes it straight to inventory, your stock is now
quietly wrong and nobody will ever find out. Put the same misread on a confirmation screen
and the nurse — who held the thing thirty seconds ago — says "no, that's not it" instantly.

The model is good at **reading**. The human is good at **knowing what they took**. Use each
for what it's good at.

### Three words worth keeping straight

| Word | Meaning | Who |
|---|---|---|
| **Proposal** | "This line might be 3 surgical masks" | The model |
| **Decision** | "That's ambiguous — a human must pick" | Deterministic code |
| **Confirmation** | "Yes, deduct it" | The person |

The middle one is the part people skip, and it's the part that makes this safe. The model
does not decide what's confirmable. **Plain code does**, using rules you can read.

---

## Part 2 — For designers

### Three screens

**1. Capture** — a location (already chosen) and a photo.

```
┌──────────────────────────────┐
│ Location: ED Resus Bay 02  ▾ │
├──────────────────────────────┤
│ Photograph the supply note,  │
│ pack label, or the items.    │
│ DO NOT include patient       │
│ information.                 │
│                              │
│  [ Take photo ] [ Upload ]   │
├──────────────────────────────┤
│      [ Submit photo ]        │
│  Nothing is deducted yet.    │
└──────────────────────────────┘
```

No item list. No quantity boxes. No notes field. **Every field here is a field somebody
fills in while standing in a corridor.** The whole premise is ten seconds; a checklist
defeats the product.

**2. Processing** — a spinner, and one sentence that matters:

> **You can leave this screen.** Your photo is saved.

People close apps. If closing the app loses the submission, they stop trusting it after the
first time. Say it out loud.

**3. Review** — the photo, what was read, and what to do about it.

### Anatomy of a review card

This is where every design decision lands, so it's worth drawing:

```
┌────────────────────────────────────────────┐
│ IV cannula 18G blue × 1    High confidence │  ← plain words, not 97%
│ Written: "18G blue cannula x1"             │  ← always show the source text
├────────────────────────────────────────────┤
│ Not identified              Cannot identify│
│ Written: "Betaloc 100mg - 1 tab BID"       │
│                                            │
│ "betaloc 100mg" does not match anything    │  ← say what to DO
│ stocked here. Choose the item, or drop it. │
│                                            │
│   Item  [ Choose an item…             ▾ ]  │
│   How many  [ 1 ]                          │
│   [ Save this line ]                       │
│                                            │
│   [ It's not on the list ]                 │  ← the escape hatch, ON the card
│   Drop this line                           │
└────────────────────────────────────────────┘
```

### The photo, with boxes on it

Above those cards sits the photo, with a numbered box round each line the reader could
place. The numbers match the cards. Tap a box, its card scrolls into view; tap a card, its
box lights up.

```
┌──────────────────────────────┐
│  ①┌────────┐                 │  ← quiet outline, number chip beside it
│   │  pack  │   ②┌────────┐   │
│   └────────┘    │  pack  │   │  ← two items close together keep a
│                 └────────┘   │     visible channel between them
│                              │
│ ②. Two saline flush syringes │  ← caption pinned to the bottom edge,
└──────────────────────────────┘     only for the selected box
```

Four rules that keep it from looking broken:

1. **The overlay is not the interface — the cards are.** Boxes are drawn quietly; only
   the *selected* one is emphasised and only the selected one gets words. An overlay
   where everything shouts is just a mess with rectangles on it.
2. **Captions go to a fixed place, never beside their box.** A label anchored to its box
   is the thing that ends up half off the photo or sitting on the next one. Pinned to the
   bottom edge it is always in the same place and can never collide.
3. **Boxes may overlap; labels may not.** Two items really can overlap, and nudging a box
   to tidy the picture is a *lie about where the item is*. Labels carry no positional
   meaning, so they move instead.
4. **Let people turn it off, and remember it.** On a genuinely cluttered photo the overlay
   *is* annoying. Arguing with somebody about their own screen is not a design strategy.

And one accessibility point that is easy to miss: a box is a **button**, not a decoration.
It needs a real accessible name ("Line 2: two saline flush syringes"), a pressed state, a
visible focus ring, and a tap target no smaller than 44px — which means small boxes have
to grow, and grow **about their centre**, or they walk off the item they are marking.

### Rules of thumb worth stealing

**Never show a confidence percentage.** Three phrases instead:

| Phrase | Means |
|---|---|
| **High confidence** | One item matches. Tap confirm. |
| **Needs review** | We're unsure. You decide. |
| **Cannot identify** | No idea. You tell us. |

"94% confident" invites risk arithmetic in a corridor. "Needs review" says what to *do*. The
number feels more precise and is less useful.

**Disable Confirm — and say why, above the button.** Never leave someone poking a dead
control:

> **1 thing to settle first**
> "mask" still needs a decision before anything can be confirmed.

**Colour is never the only signal.** Every status carries a word. Colour alone fails for
colour-blind users, and for everyone in sunlight at 20% brightness.

**48px minimum tap targets.** One-handed, in a hurry, possibly gloved.

**Square photo areas.** A note is written *down* a page; a widescreen crop cuts the bottom
items out of shot.

**Every dead end needs a door, next to the dead end.** More on this below — it's the
mistake I made twice.

### The two design mistakes I made

**1. A fake reading that looked real.**

The offline demo reader returned a fixed sample — *"18G blue cannula x1, saline flush x2"* —
regardless of what you photographed. It rendered as a green **High confidence** pill with a
live Confirm button.

Someone photographed a real prescription. The app confidently offered to deduct a cannula
and a saline flush. **Nothing on screen said the reading was invented.**

That's the most dangerous thing this class of product can do, and it was a *presentation*
failure, not a logic one. The fix was design work: a red panel above the proposals reading
**"Your photo was not read"**, the heading changed to **"Sample data — not from your
photo"**, and every pill changed from "High confidence" to **"Simulated"**.

> **Lesson:** if any part of your system can produce fake output, the interface must make
> that impossible to mistake. A small grey "demo mode" label in the corner is not enough.

**2. The escape hatch in the wrong place.**

When an item isn't in the catalogue, you need a way to say so. I built one — and put it in
a separate "+ Add an item" panel at the bottom of the page, which *adds a new line*.

So an unidentified line still offered exactly two things: pick from a dropdown that doesn't
contain it, or delete it. On a page with **four** unidentified lines, that's four dead ends
and no way to confirm anything.

The fix was placement, not logic. The action now sits on the card of the line it's about,
and resolves *that* line.

> **Lesson:** an escape hatch that isn't next to the thing you're escaping from isn't an
> escape hatch.

**…and then I got it wrong a second time.** Having moved the action onto the card, I showed
it only for lines the rules had called `unmatched` or `unreadable`. But one photograph
produces a **mix** — a prescription came back as some unmatched, some needs_review, some
ambiguous — and every one of them renders as "Not identified" to the person reading the
screen. So the button appeared on **one card out of four**, for no reason anyone looking at
it could see.

The rules' internal categories are not the user's categories. Key the UI on the question
the person is actually asking — *"have you got an item for this line or not?"* — not on
which branch of your logic fired.

> **Lesson:** if a control appears on some cards and not others, a user reads that as a
> bug, and they are usually right.

---

## Part 3 — For engineers

### The pipeline

```
photo ──▶ storage ──▶ extraction provider ──▶ schema validation
                                                     │
                                                     ▼
                                    catalogue guard (drop unknown ids)
                                                     │
                                                     ▼
                                  deterministic rules (pure function)
                                                     │
                                                     ▼
                                       proposals in the database
                                                     │
                                          ═══════════╪═══════════
                                           HUMAN CONFIRMATION
                                          ═══════════╪═══════════
                                                     ▼
                                 one transaction: ledger + balances +
                                 audit + replenishment tasks
```

### The structural trick

**The code that reads images cannot reach the code that moves stock.** Not by convention —
by construction. Extraction writes to one table (`ExtractedCandidate`) and nothing else.
There is no import of `InventoryBalance` anywhere along that path.

"AI cannot change stock" stops being a promise you have to keep and becomes a thing that
isn't possible to do by accident.

### The rules are a pure function

```ts
evaluateCandidate(candidate, catalogue, config) → { decision, reasonCode, message }
```

No database, no network, no clock, no randomness. Same input, same output — on a phone, in
CI, and in an audit reconstruction two years from now.

They run **in order**; first match wins:

| # | If… | Then | Shown as |
|---|---|---|---|
| 1 | Unreadable | `unreadable` | Cannot identify |
| 2 | **Every** possible match is controlled/high-risk | `restricted` | Needs supply review |
| 3 | More than one item matches | `ambiguous` | Needs review |
| 4 | Nothing matches | `unmatched` | Cannot identify |
| 5 | Matched, but not stocked here | `unmatched` | Cannot identify |
| 6 | Quantity missing, zero or absurd | `needs_review` | Needs review |
| 7 | Confidence below threshold (0.90) | `needs_review` | Needs review |
| 8 | Model flagged doubt, or named an id we can't verify | `needs_review` | Needs review |
| 9 | Exactly one match, sane quantity, nothing flagged | **`eligible`** | High confidence |

**Confidence can only demote.** There is deliberately no rule of the form "confidence is
high, therefore correct". A model returning `0.99` on nonsense changes nothing about what a
nurse may press.

### Three columns make audit work

Every proposed line stores **three different opinions**:

| Column | Who said it |
|---|---|
| `proposedItemId` | What the **model** claimed |
| `matchedItemId` | What **our own matcher** concluded, independently |
| `resolvedItemId` | What the **human** chose |

Lose any one and you can no longer answer *who decided this, and on what evidence*.

A line typed by a person carries `isManual = true`, no proposed id, and **confidence 0** —
no model claimed anything, and writing `1` would invent an agreement that never happened.

### Making confirmation safe

Three overlapping guards, deliberately redundant:

1. **Status compare-and-set** — only the caller that flips `awaiting_review → confirmed`
   does the work. Everyone else replays the stored result.
2. **Unique index** on `(submissionId, sourceCandidateId)` — even past the CAS, a second
   `INSERT` cannot land.
3. **`SELECT … FOR UPDATE` ordered by id, plus a version-checked `UPDATE`** — two
   submissions touching the same item serialise instead of interleaving.

A redundant guard costs milliseconds. A missing one costs a resus bay with wrong stock.

**Double-tap:** when two requests race, the loser retries, finds the work done, and replays
the *same* receipt. The user sees a confirmation twice, never an error.

### The provider interface

```ts
interface ExtractionProvider {
  readonly name: string
  readonly isMock: boolean      // ← the UI shows this, loudly
  extract(image, context): Promise<ExtractionResult>
}
```

The context holds **only the items stocked at that one location** — not the whole
catalogue. The type is closed: there's nowhere for a patient identifier or another
location's items to travel.

---

## Part 4 — The hard parts

The section I'd want to read first.

### 1. Classical OCR cannot read handwriting

We started with Tesseract. Excellent, free, offline — and trained on **printed** text. On a
scribbled note it's close to useless, and tuning doesn't fix it.

**Fix:** a vision model. But the model is only half of it.

### 2. The biggest accuracy trick: put the catalogue in the prompt

Don't ask *"what does this say?"*. Ask **"which of these 25 things does this say?"**

```
<allowed_catalogue>
- id=abc | sku=IVC-18G-BLUE   | IV cannula 18G blue (each) | also: 18g blue cannula; blue cannula
- id=def | sku=NS-FLUSH-10ML  | Sodium chloride 0.9% flush 10 mL (each) | also: saline flush
  … 23 more
</allowed_catalogue>
```

Open-vocabulary transcription is hard. Constrained selection from a known list is much
easier, and the model can use the list to resolve ambiguous handwriting. **Worth more than
upgrading your model tier.**

### 3. A bare number destroyed matching

Matching checked that every word of the written phrase appears in a catalogue entry.

Then `"3 masks"` matched **nothing** — because no catalogue entry contains the word "3".

That broke the most natural way to write a note. `"masks 3"`, `"masks - 3"`, `"2 gloves"`,
`"5 electrodes"`, `"1 bvm"` — all dead.

**Fix:** drop standalone numbers from the *written* side only. The count already arrives
separately. But keep numbers glued to units — `18g`, `10ml`, `500ml`, `10x10` — because
those *name* the item rather than count it.

**Result across a 43-line corpus: unmatched lines went from 15 to 4** — and those four were
a date, a ward name, a signature, and the word "Withdrawn".

### 4. Plurals

Nurses write "syringes". The catalogue says "Syringe 10 mL luer lock". No match.

**Fix:** fold English plurals on both sides. Leave short tokens alone — the domain's own
shorthand lives there (`ns`, `gas`), and stripping a letter from a three-letter word does
real damage.

### 5. Ambiguity is a feature, and the hardest thing to explain

The cart stocks **three** masks (surgical, oxygen, bag-valve) and **two** salines (10 mL
flush, 500 mL bag). So `"3x mask"` genuinely doesn't say which.

The app refuses to guess and offers three buttons. Users read this as broken. It's correct.

What made it feel less like failure:

- Message says what to *do*: "Tap the one you took", not "could not uniquely identify".
- Options are tappable buttons, not prose.
- Options sort by closeness to what matched, so the likely one is first.

**The subtle one:** `"blue cannula"` is an approved **alias** of the 18G cannula. It is
*still* ambiguous, because the words also describe the 22G. **Ambiguity beats an alias.** An
alias only makes a line confirmable when it's the *sole* match — otherwise one sloppy alias
added in a year's time silently deducts the wrong item forever.

### 6. Rule ordering bit us

Original rule: *"if **any** possible match is controlled or high-risk → escalate."*

Then `"syringes"` started going to supply review, because the cart stocks an *adrenaline
prefilled syringe*. Friction bought nothing.

**Fix:** escalate only when **every** possible reading is restricted. When a safe reading
exists it's ambiguous — the human picks, and the restriction is re-checked on whatever they
chose, at confirmation.

> **Lesson:** "be maximally cautious at every step" produces a system people route around.
> Be cautious at the step that actually decides.

### 7. The fake-success-state disaster

Covered in Part 2. Beyond the UI fix, the structural one: **the mock refuses to run on a
deployed host unless explicitly asked for.** Locally, unset means mock — that's an offline
demo. On a server, unset is a misconfiguration, and it errors with exactly what to set.

> **Lesson:** "safe default" depends on environment. The default that's convenient on a
> laptop is dangerous on a server.

### 8. Deployment problems that looked like code problems

Days disappear here. All of these presented as *"the app is broken"*:

| Symptom | Actual cause |
|---|---|
| Upload 500s, log says "unhandled route error" | No object store attached; our code *refused to start* instead of falling back |
| Readings are fake but plausible | `EXTRACTION_PROVIDER` never set on that environment |
| Variables set but ignored | Set for **Production** only, while testing a **Preview** URL |
| Variables *still* ignored | **Two projects** from one repo with near-identical names — editing one, testing the other |
| Build fails: "Invalid value undefined for datasource db" | Prisma client constructed at *import* time, so compiling a page needed a connection string |
| Sign-in page 500s | Session code threw when `SESSION_SECRET` was missing — on the one page that could have explained it |

**What fixed this whole class of problem** was `GET /api/health`:

```json
{
  "healthy": false,
  "database": { "ok": true, "detail": "2 locations, 25 items, 3 accounts" },
  "reader":   { "name": "none", "ok": false, "detail": "No reader is configured…" },
  "storage":  "database",
  "deployment": { "productionUrl": "…", "branch": "…", "commit": "a1b2c3d" },
  "problems": [ { "severity": "blocking", "title": "…", "detail": "…" } ]
}
```

It names the missing variable and never reveals a secret's value. **Build this on day one.**
Every hour it saves, it saves during the hour you can least afford it.

Three rules that came out of it:

1. **Never let missing config produce a generic 500.** Say which variable, and where to set it.
2. **Never crash the page that explains the problem.** Config errors must degrade, not throw.
3. **Make the app say which deployment it is.** "Am I editing what I'm looking at?" should be one request away.

### 9. People photograph the wrong things

Prescriptions, mostly — complete with patient name, address and age.

The app correctly matched nothing. But four blank "Cannot identify" cards look like a
malfunction rather than an answer.

**Fix:** when nothing matches, say why —

> **Nothing on this page is stocked at ED Resus Bay 02.** This looks like a prescription.
> This app records supplies taken from the cart and does not handle dispensing.

— and when the page carries patient fields:

> **This page may contain patient information.** Please do not photograph patient details.
> Cancel this submission so the image is not kept alongside a stock record.

The detector is crude on purpose (`Rx`, `Sig:`, `BID/TID`, a licence line) and needs **two**
markers before firing. A warning on every note is a warning nobody reads.

### 10. "It didn't recognise it — now what?"

If the reader misses a line, the withdrawal is lost. Unacceptable.

**Fix:** two paths, both reachable from the line itself:

- **Already stocked here** → search, tap, set a quantity.
- **Not on the list** → a reviewer/admin adds it to the catalogue and points *this line* at
  it; a nurse files a request and the line is marked as moving no stock, because an item the
  catalogue doesn't have has nothing to deduct from.

**Why the split:** the rules work by refusing anything the location doesn't stock. That
refusal is worthless if any user can invent a catalogue row mid-withdrawal.

Two guards on creation, because a bad catalogue row is permanent:

- **Duplicate names refused** — two rows with the same name make every future match of that
  phrase ambiguous, for everybody, forever.
- **Aliases can't be stolen** — the written phrase becomes an alias only if no other item
  owns it. A collision makes *both* items ambiguous, which is worse than no alias.

### 11. Teaching it to recognise items, without teaching it to be wrong

Photographing an item and naming it should make the system better at that item. The
tempting version is a fine-tuned classifier; the right version is much duller.

**Fix:** store a vector per labelled photo and answer "have I seen this?" with a distance
calculation. Adding an example is an `INSERT`. Removing a bad one is a soft delete that
takes effect on the very next photo. And you can always answer *why* — "it looks like
these three photos, which Sam labelled in March" — which a fine-tuned model can never do.

**The rule that makes it safe:** learning improves the *suggestion*, never the
*authority*. Every branch of rule 8b returns `needs_review`. An index with ten thousand
examples has exactly the same power as an empty one.

**Three things I got wrong on the way:**

- **The descriptor was measuring the bench.** My first colour fingerprint concatenated a
  hue histogram (summing to a few thousand) with two pixel-count histograms (4096 each)
  and normalised once. The counts swamped the hue — the only part that knows blue from
  orange — so a blue pack scored **0.983 against an orange one** and 0.806 against
  another photo of itself. It looked entirely plausible. Normalising each sub-histogram
  first fixed it. *Measure the thing; don't reason about it.*
- **A tray photo taught nothing, and pretending otherwise would have poisoned
  everything.** An embedding describes a whole image. Four items on a tray embeds to
  "four items on a tray", which is near none of them. Filing that under whichever line
  was first would teach the recogniser something false about all four. So for a while
  learning only happened on single-item photos — which, since most real photos hold more
  than one thing, meant it learned almost nothing from normal use. Bounding boxes (§12)
  are what fixed it, and that was their real value, not the drawing.
- **Blame has to land on one example, not all of them.** I first spread overrule counts
  across every example of an item. That means no single bad photo ever accumulates enough
  to be caught, which is the entire point of counting. Credit and blame now land on the
  *nearest* example — the one whose distance actually produced the match.

**And the part that is really a design problem:** the curve flattens after a few weeks,
and a plateau nobody warned you about looks like a system that broke. Worse, once it is
right 90% of the time people stop reading the screen — **better accuracy does not fix
automation bias, it causes it.** So the screen shows honest per-item states
(`learning` / `good` / `as good as it gets` / `looks like something else` / `photos are
old`) instead of a rising accuracy number, the familiarity count never appears without
"you still need to check this one", and no percentage is shown anywhere.
`docs/visual-recognition.md` §4 is the long version.

### 12. Drawing boxes on a photo without it looking broken

Boxes are where this kind of feature usually goes visibly wrong: rectangles beside the
item instead of around it, squashed to the wrong shape, two of them fused into a blob,
labels stacked on each other. Every one of those has a specific cause, and none of them
is the model being bad at localising.

**The two that were already waiting in this codebase:**

- **The display was cropped.** The review screen rendered the photo as a square
  `object-cover`. That throws away up to 40% of a portrait photo, so every box drawn over
  it is displaced *and* the wrong shape — the "squashed and not even on the item"
  complaint, caused entirely by CSS. Fixed by rendering `object-contain` at the photo's
  own aspect ratio and measuring the overlay against the **rendered image rectangle**,
  not the container.
- **Two coordinate frames.** The model reads a *prepared* image — EXIF-rotated, resized —
  while the browser displays the original bytes. Pixels from one are meaningless in the
  other, and on a photo an iPhone stored as "rotate 90°" they are not even on the same
  axis. Fixed by making a box four **fractions**, never pixels, and by applying
  `.rotate()` before cropping. There is a test that fails if you remove that `.rotate()`.

**And the ones that only showed up in a browser:**

- **A cached image never fires `onLoad`.** The overlay read the photo's dimensions from
  the React `onLoad` handler. On a reload the image comes from cache and has already
  finished loading before React attaches the listener — so the event never fires and the
  overlay silently does not appear. It worked every time I tested it fresh and failed on
  every second visit. Fixed by also reading `img.complete` on mount.
- **The number chip sat on the line above it.** The collision solver avoided chip-on-chip
  overlaps, so on a handwritten note chip 2 was placed neatly above its own box — which
  is *inside box 1*, directly over the words. Fixed by scoring overlap with other boxes
  as well. Both of these were found by screenshotting the real page, not by reasoning.

**The design call underneath all of it:** the overlay is not the interface, the cards
are. So boxes sit quietly, only the selected one is emphasised, only the selected one
gets words — in a caption pinned to the bottom edge where it cannot collide with
anything. And there is a "Hide boxes" toggle that is remembered, because on a genuinely
messy photo the overlay *is* annoying, and arguing with somebody about their own screen
is not a design strategy.

**Keep the geometry out of the component.** All of it lives in a pure module with no DOM,
which is why there are 40 tests for it. What is left in React is measurement — and
measurement, as above, is where the bugs actually were.

---

## Part 5 — Build it in this order

Each phase ends with: typecheck, run tests, fix failures, update the README.

| Phase | Build | Why here |
|---|---|---|
| **1** | The safety rules, **as prose** | If you can't write the rules in English you can't code them |
| **2** | Data model + seed catalogue + the rules as a **pure function** | The rules are the product. Test them before any UI exists |
| **3** | `GET /api/health` | Saves days later. Genuinely. Do it now |
| **4** | Storage + auth + a **mock** reader | Prove the pipeline with zero credentials |
| **5** | The three screens | Now you can see it |
| **6** | The confirm transaction | The only thing that writes stock |
| **7** | Real vision provider behind a flag | Mock stays the default |
| **8** | Reviewer queue + inventory views | The other half of the workflow |
| **9** | Manual entry | You *will* need it — don't leave it to the end like I did |
| **10** | Visual recognition + learning from corrections | Only once the rules are immovable. It changes the *suggestion* and never the *authority*, so it is safe to add late and dangerous to add early |
| **11** | Bounding boxes | Last. They need a working reader *and* a working learner before they are worth anything — and the learner is the reason to build them |

**Do not build the AI integration first.** It's the most exciting part and the least
important. If the rules and the confirmation flow are right, swapping readers is an
afternoon. If they're wrong, no model saves you.

### Test the things that would actually hurt

- Reading a photo changes **no** balance and **no** version — assert it against a real database
- An ambiguous line cannot be confirmed
- A controlled item cannot be self-confirmed by a nurse — including one added by hand
- Two concurrent confirms → **one** deduction, two successful responses
- **Seven spellings of the same line reach an identical decision** ← guards against tuning to one example
- Text on the page cannot instruct the system (prompt injection)
- A malformed model response fails loudly rather than being coerced
- A settled line stops blocking the rest of the submission

Once you add recognition and boxes, four more:

- A line identified **by sight** is `needs_review` — at any score, with any number of
  examples agreeing. Assert it across the whole grid, not at one score
- The crop cuts out the **right region**, checked by comparing what was learned against a
  known colour. A crop landing on the wrong half still writes a tidy-looking database row
- A **failed crop teaches nothing** — it must never quietly fall back to the whole photo,
  which is the exact misattribution the box exists to prevent
- A photo the phone stored as "rotate 90°" crops **upright**. Delete the `.rotate()` and
  confirm a test goes red; if none does, you are not testing the thing that breaks

---

## Part 6 — How to build it better

Roughly by value:

**1. Barcode and QR scanning.** Most packs have one. A scanned barcode is an exact match
with no ambiguity at all — cheaper and more accurate than any vision model. The obvious
next feature.

**2. Crop and deskew before reading.** We apply EXIF rotation, cap the long edge at 1568px
and normalise contrast. We do **not** detect the paper's edges or correct skew. Both
meaningfully improve a photo taken at an angle from across a bay.

**3. Suggested aliases from corrections.** The *visual* half of this is built: correcting a
line the system identified by sight teaches it that item's appearance on confirmation. The
text half is not. Every time a human picks "Surgical mask" for the word "mask", that is a
labelled example sitting in your database too — surface the top corrections to an admin as
*suggested* aliases. Do **not** auto-create them, in either half: an alias added without a
person looking is how a catalogue poisons itself, and the same argument is why a learned
photograph can never make a line confirmable.

**4. Location-aware ranking.** If a bay withdraws surgical masks 40× a week and BVMs twice a
year, "mask" should offer the surgical mask first. For **ordering only**, never to
auto-resolve.

**5. Offline queue.** Hospital Wi-Fi is bad in exactly the places this gets used. Queue
submissions in the browser, sync when connectivity returns.

**6. Batch review.** A reviewer working 30 cases wants a list view and keyboard shortcuts,
not 30 page loads.

**7. Real object storage.** We store photos in Postgres so the app runs with nothing but a
database. Fine for a prototype, wrong at scale — it bloats backups and costs more per byte.
The adapter is three methods; swapping is easy.

**8. Witness signature for controlled drugs.** Real controlled-drug handling usually needs
two people. Reviewer sign-off is weaker.

**9. Per-location roles.** Reviewers are global here. A real hospital scopes them.

### Things I'd deliberately *not* add

- **Auto-confirm above a confidence threshold.** Everyone asks for this. It destroys the
  entire safety property: the moment there's a path where no human looks, you have a system
  that silently corrupts inventory.
- **Free-text notes on the nurse path.** Another field to fill in, and a place for patient
  information to leak.
- **A cleverer fuzzy matcher in the confirm path.** Fuzzy matching is great for *offering
  suggestions* and terrible for *deciding*. Keep them strictly apart, or one day "20G"
  becomes "18G" because the letters mostly agreed.

---

## Part 7 — Where this is not ready

A **prototype**. None of it constitutes a regulatory, privacy or security assessment. Before
anything real:

- **Privacy** — lawful basis, DPIA, patient-information risk in photographs. Our UI
  *instructs* users not to photograph patient details. That's guidance, not a control.
- **Security** — real identity provider, penetration testing, key management, encryption at
  rest. Session handling here is deliberately simple and expects replacing.
- **Retention** — nothing auto-deletes. Images, extracted text and audit events accumulate
  forever until someone sets a policy.
- **Vendor review** — if you enable an external AI provider: its data handling, retention,
  residency and contractual terms.
- **Clinical governance** — controlled-substance rules, medical device classification where
  relevant, local pharmacy and materials-management policy.
- **Validation** — accuracy against *your* handwriting, *your* labels, *your* catalogue.

Recognition and boxes brought four more, all named rather than quietly assumed:

- **No hand-drawn boxes.** A line the reader could not place gets no box, and nobody can
  draw one. The most obvious next thing to build.
- **No capture guidance.** Nothing warns that a photo is blurry, backlit or too far away
  *before* it is submitted — which is the cheapest accuracy win available.
- **Examples never cross locations.** Right for lighting and cart layout, but every new
  bay starts from zero even for an item photographed a thousand times down the corridor.
- **No real accuracy measurement.** The tests use synthetic packs. They prove the
  pipeline is sound and the thresholds are in the right neighbourhood; they prove nothing
  about a real cart in real light. Which is the other reason every visually identified
  line still goes to a person.

And the limit no threshold catches: **a confidently wrong read of a legible note that
happens to match a real item.** Write "18G" where you meant "20G" and every check in this
system passes. The only mitigation is the confirmation screen showing the proposal in large
plain text beside the original photo — which is exactly why that screen looks the way it
does.

---

## The shortest possible summary

1. The AI **proposes**. A human **decides**. Only the decision changes stock.
2. Put the catalogue **in the prompt** — constrained selection beats open transcription.
3. Show **words**, not percentages.
4. **Ambiguity is correct behaviour.** Make it one tap to resolve, not a dead end.
5. Every dead end needs a door, **next to the dead end**.
6. Make a double-tap **impossible** to double-deduct. Three overlapping guards.
7. Build `/api/health` **on day one**.
8. If anything can produce fake output, make it **impossible to mistake** for real.
