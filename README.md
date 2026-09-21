# AI-Assisted Withdrawal Capture

Record an emergency supply withdrawal from **one photograph, taken afterwards** — without
letting any image-reading model touch stock. And have it get **better every time somebody
confirms one**.

**Repository:** <https://github.com/jaydemetillo/ai-assisted-withdrawal-capture>

> ### ⚠️ To run this for real you need two things
>
> **1. An `ANTHROPIC_API_KEY`** — this is what reads the photograph. Set
> `EXTRACTION_PROVIDER=anthropic` alongside it. Costs a few cents per photo.
>
> **2. A database.** Free on [Neon](https://neon.tech) — on Vercel it is
> **Storage → Create Database → Neon (Postgres)**, free plan, no credit card, and it sets
> `DATABASE_URL` for you. Locally, `npm run db:up` runs one in this repo instead.
>
> You also need `SESSION_SECRET` (`openssl rand -hex 32`) or sign-in will not work. Full
> list in [Deploying to Vercel](#deploying-to-vercel-so-other-people-can-use-it).
>
> **Without a key it still runs end to end** — `EXTRACTION_PROVIDER=mock` is the default
> and plays fixed demo scenarios, so every screen, rule and audit trail is the real code.
> It just is not reading *your* photo. Good for a walkthrough; not good for judging
> accuracy.

> **Status: built.** Twelve phases, 465 tests, typecheck and production build clean. A
> nurse can photograph a note and confirm a proposal; only that confirmation moves stock,
> exactly once, with an audit trail from the photo to the ledger row. It also recognises
> the **items themselves** in a photo with no writing on it, **learns from every
> confirmation**, and draws a **box** round each line it can place.

|  | |
|---|---|
| **1 · [The idea](#1--the-idea)** | What it does, the one rule everything hangs off, and how it improves itself |
| **2 · [Try it](#2--try-it-in-five-minutes)** | Running locally in four commands, no credentials |
| **3 · [How we built it](#3--how-we-built-it)** | The pipeline, the build order, the learning loop, and the decisions that made it work — for designers and for engineers |
| **4 · [Challenges](#4--challenges-what-we-tried-and-what-to-consider)** | What went wrong, what we measured, what we chose not to build, and the gaps |
| **5 · [Reference](#5--reference)** | Screens, stack, deployment, security, docs |

---

## 1 · The idea

A nurse takes what they need during a resuscitation. Seconds later they photograph the
scribbled note, the torn pack label, or the open drawer, pick a location, and are done.
The system reads the image, proposes withdrawals against that location's catalogue, and
asks a human to confirm a short summary. **Only the confirmed transaction changes stock.**

The whole premise is **ten seconds**. Any screen that asks somebody to type an item name
while standing in a corridor has already lost to the paper form it replaced.

### It improves every time somebody uses it

This is the part worth building for, and it costs nothing extra.

Reviewing a proposal is work a human is doing **anyway** — it is the safety rule, not an
overhead added for the machine. So every confirmation is also a *labelled example*: a
person looked at a photo, said "that one is a surgical mask", and pressed confirm. Store
the picture of the item beside the name they chose and the system is measurably better at
that item, at that location, on the very next photo.

```
photo → proposal → a human corrects it → confirm → THAT CORRECTION BECOMES AN EXAMPLE
  ▲                                                                              │
  └──────────────── the next photo of that item is easier ───────────────────────┘
```

**There is no model to retrain.** Recognition is nearest-neighbour search over a table of
vectors, so adding an example is an `INSERT` that works on the next photo, removing a bad
one is a soft delete that takes effect just as fast, and the system can always say *why*
it matched — "it looks like these three photos, which Sam labelled in March". A fine-tuned
model can do none of those things.

**And it learns appearance, not just words.** It improves at *that location, photographed
by those people, of that packaging* — which is exactly the thing a generic model is worst
at and a hospital cares most about.

The one thing that never improves is **authority**. An index with ten thousand examples
has precisely the same power as an empty one: a line identified by sight is `needs_review`
on every path, at any score. Learning makes the suggestion better. It never makes the
suggestion sufficient.

### The one rule

```
photo → extraction → deterministic rules → HUMAN CONFIRMATION → audited transaction
                                             ▲
                        nothing to the left of this line can change stock
```

- AI, OCR, and image recognition **never** change inventory. They write proposals.
- A human confirmation is **mandatory** before any deduction.
- Ambiguous, unreadable, unmatched, quantity-unknown, controlled, or high-risk lines
  **cannot be confirmed** — they route to a supply-review queue with the original image
  and raw text preserved.
- The **application**, not the model, decides what is confirmable. Model confidence is an
  input to that decision, never a substitute for it.

Read [`docs/safety-and-decision-rules.md`](docs/safety-and-decision-rules.md) before
changing anything in `lib/decision/`.

### Why not just let the model update stock?

Because then a misread becomes a wrong balance with nobody in the loop, and the first
person to find out is whoever reaches for something the system thinks is there. A model
that is right 97% of the time is wrong about one line in thirty — and those thirty are not
evenly spread, they cluster on exactly the messy handwriting and unusual items where being
wrong matters most.

So the model **proposes**. A human **decides**. Only the decision writes anything.

---

## 2 · Try it in five minutes

```bash
npm install
cp .env.example .env
npm run setup          # starts local PostgreSQL 16 in .pgdata/, migrates, seeds
npm run dev            # http://localhost:3000
```

Then follow [`docs/demo-script.md`](docs/demo-script.md).

```bash
npm test               # 465 tests — unit (pure) + integration (real Postgres)
npm run typecheck
npm run build
npm run db:down        # stop the database; `bash scripts/dev-db.sh nuke` deletes it
```

Postgres runs from a repo script so nothing has to be installed globally; the Docker
alternative is in the header of `scripts/dev-db.sh`. Tests use a separate database
(`TEST_DATABASE_URL`) and skip **visibly** if none is reachable — the unit tests always run.

**Demo accounts** (password `demo1234`, from `DEMO_PASSWORD`):

| Email | Role | Can |
|---|---|---|
| `nurse@demo.local` | `nurse` | Submit photos, confirm unambiguous withdrawals |
| `reviewer@demo.local` | `supply_reviewer` | Work the review queue, confirm restricted items |
| `admin@demo.local` | `admin` | Everything, plus the catalogue |

---

## 3 · How we built it

### The pipeline, end to end

Six steps. Nothing clever happens between them.

```
1. CAPTURE     A nurse picks a location (already selected) and takes one photo.
                  ↓            Nothing is deducted. The photo is saved first, so
                               closing the app loses nothing.
2. PREPARE     Rotate by EXIF, cap the long edge at 1568px, normalise contrast.
                  ↓            This is the image the MODEL sees. Remember that —
                               it is not the image the browser shows.
3. READ        One call to a vision model, with THAT LOCATION'S CATALOGUE in the
                  ↓            prompt. So the job is "pick from these 25 items",
                               not "transcribe this handwriting". That single
                               choice is the biggest accuracy win in the project.
4. DECIDE      A pure function — no network, no database — turns each proposed
                  ↓            line into eligible / needs_review / restricted.
                               The APPLICATION decides, never the model.
5. REVIEW      A human sees the photo, a box round each placed line, and the
                  ↓            proposals in plain words. Anything doubtful cannot
                               be confirmed until they resolve it.
6. CONFIRM     One transaction: deduct stock, write the ledger row, write the
                               audit event. THIS is the only thing that changes
                               stock, and it cannot run twice.
```

**Where recognition fits.** At step 3, a line can be something the model *read* (written
text) or something it *saw* (a visible item). A seen line is also matched against photos
people took at that location — nearest-neighbour over a table of vectors, no training. At
step 6, if a human corrected a seen line, its crop is stored as a new example. That is the
whole learning loop: **it gets better because people were already doing the work.**

**Where boxes fit.** The model returns four fractions per line — `x, y, width, height`,
each 0–1. Fractions, never pixels, because step 2 means the model's image and the
browser's image are different sizes and sometimes different *orientations*. Fractions
survive that; pixels do not. The box does two jobs: it shows a reviewer which item a card
means, and it lets step 6 crop **one item** out of a photo of six.

### Build it in this order

The order matters more than any individual decision. Each phase ends with: typecheck, run
the tests, fix what broke.

| # | Build | Why here |
|---|---|---|
| 1 | The safety rules, **written in English** | If you cannot write them in prose you cannot code them |
| 2 | Data model + seed catalogue + the rules as a **pure function** | The rules are the product. Test them before any UI exists |
| 3 | `GET /api/health` | Saves days later. Do it on day one |
| 4 | Storage + auth + a **mock** reader | Proves the whole pipeline with zero credentials and zero cost |
| 5 | Capture, processing and review screens | Now you can see it |
| 6 | The confirm transaction | The only thing that writes stock. Make double-submit impossible here |
| 7 | The real vision provider, behind a flag | The mock stays the default |
| 8 | Reviewer queue + inventory | The other half of the workflow |
| 9 | Manual entry | You *will* need it. Don't leave it to last |
| 10 | Visual recognition + learning from corrections | Safe to add late, dangerous to add early — it changes the suggestion, never the authority |
| 11 | Bounding boxes | Last. They need a working reader *and* a working learner before they earn anything |

**Do not build the AI integration first.** It is the most exciting part and the least
important. If the rules and the confirmation flow are right, swapping readers is an
afternoon. If they are wrong, no model saves you.

[`docs/how-to-build-this.md`](docs/how-to-build-this.md) is the long version — the same
order with the reasoning, a section for designers, a section for engineers, and every hard
part we hit written up with what actually fixed it.

### Building the self-improving loop

The loop in §1 is five pieces. None of them is a model you train.

**1. One table.** `ItemReferencePhoto`: an item id, a location id, the vector, the image
key, a timestamp, and a soft-delete column. That is the entire "model".

**Only lines the reader *saw* teach anything.** A confirmed handwritten note teaches the
recogniser nothing — there was no picture of the item involved, just text. The loop feeds
on lines marked `visible_item`, which is why it grows fastest where people photograph the
items rather than the paperwork.

**2. Embed at read time.** For each line the reader says it *saw*, crop to its box, turn
the crop into a vector, and compare it against that location's examples. The nearest
match is attached to the line as a **suggestion**, with the photos that produced it.

**3. Teach at confirm time — after the transaction, never inside it.** Stock has already
moved by the time this runs, and failing a confirmation because a vision model would not
load would be the wrong trade by a wide margin. Wrap it in a try/catch that logs and
returns.

**4. Four guards on what may become an example.** Every one of them is load-bearing:

| Guard | Why |
|---|---|
| Only a **confirmed** withdrawal | An abandoned draft is not a judgement |
| Only an **explicit human choice** (`resolvedItemId`) | The system's own proposal is deliberately *not* accepted as a label. Learning from what you already thought is how a system teaches itself its own mistakes |
| Only an image region that **is** the item — a box crop, or a whole photo that holds one thing | An embedding describes the *whole image*. A tray embeds to "a tray", which is near none of the four things on it |
| **Once per line**, enforced by a unique `sourceCandidateId` | A replayed confirmation must add nothing |

**5. Keep the index honest.** Cap the active examples per item per location
(`VISION_MAX_EXAMPLES`, default 12) — **that cap is the plateau**, made deliberate instead
of pretending it is not there. Count agreement and overrules against the **nearest**
example rather than spreading them over all of them, or no single bad photo ever
accumulates enough evidence to be caught, which is the whole point of counting.

**And the failure that must never be a fallback:** a boxed line whose crop fails teaches
**nothing**. It must not quietly fall back to the whole photo — that is precisely the
misattribution the box exists to prevent, and it would poison the index silently, where
nobody would ever see it.

**This is why bounding boxes were worth building.** Before them, a confirmed tray of four
items taught *nothing at all* — and a tray is most of what a cart actually sees. With
them, the same photograph teaches four examples, each a crop of the thing it is labelled
as. The drawing on screen is the visible half; this is the half that matters.

### For designers — the decisions that made it usable

**Three screens, and only three.**

| Screen | On it | Deliberately not on it |
|---|---|---|
| **Capture** | A location, already chosen. One photo button. | No item list, no quantity fields, no notes box. Every field is one somebody fills in standing in a corridor |
| **Processing** | A spinner and one sentence: *you can leave this screen, your photo is saved* | No blocking wait. People close apps; if closing loses the submission they never trust it again |
| **Review** | The photo, a box round each placed line, the proposals in plain words, four actions | No percentages. No jargon. No dead ends |

**Never show a confidence percentage.** Three phrases instead — *High confidence*, *Needs
review*, *Cannot identify*. "97%" asks a nurse to do arithmetic about risk in a corridor;
a phrase tells them what to do.

**Always show the source text.** Every card carries what was actually written — `Written:
"18G blue cannula x1"` — beside what the system made of it. That one line is what makes a
wrong reading obvious at a glance instead of plausible.

**Every dead end needs a door, next to the dead end.** A line that cannot be identified
carries its own escape hatch — *choose the item*, *it's not on the list*, *drop this
line* — on the card, not in a menu somewhere else.

**Say what has been learned in words, never as a rising number.** Per-item states —
*learning*, *good*, *as good as it gets*, *looks like something else*, *photos are old* —
and a familiarity count that never appears without "you still need to check this one".
The curve flattens after a few weeks; a plateau nobody warned you about looks like a
system that broke.

**The photo overlay follows four rules.** The boxes exist so that checking "is that really
a blue 18G?" does not mean hunting through a cluttered tray:

1. **The overlay is not the interface — the cards are.** Boxes sit quietly; only the
   *selected* one is emphasised, and only the selected one gets words.
2. **Captions go to a fixed place**, pinned to the bottom edge, never floating beside their
   box where they end up half off the photo or on top of the next one.
3. **Boxes may overlap; labels may not.** Two items really can overlap — nudging a box to
   tidy the picture is a *lie about where the item is*. Labels carry no positional
   meaning, so they move instead.
4. **Let people turn it off, and remember it.** On a cluttered photo the overlay *is*
   annoying, and arguing with somebody about their own screen is not a design strategy.

A box is a **button**, not a decoration: it needs a real accessible name ("Line 2: two
saline flush syringes"), a pressed state, a visible focus ring and a 44px tap target —
which is why small boxes grow, and grow **about their centre**, so they stay on the item.

[`docs/how-to-build-this.md`](docs/how-to-build-this.md) Part 2 is the long version, with
the screen sketches and the two design mistakes worth avoiding.

### For engineers — the decisions that made it safe

**The code that reads images cannot reach the code that moves stock.** Not by convention —
by construction. Extraction writes to one table (`ExtractedCandidate`) and nothing else;
there is no import of `InventoryBalance` anywhere along that path. "AI cannot change stock"
stops being a promise you have to keep and becomes something you cannot do by accident.

**The rules are a pure function.** No database, no network, no clock, no randomness:

```ts
evaluateCandidate(candidate, catalogue, config) → { decision, reasonCode, message }
```

They run **in order**, first match wins:

| # | If… | Shown as |
|---|---|---|
| 1 | Unreadable | Cannot identify |
| 2 | **Every** possible match is controlled or high-risk | Needs supply review |
| 3 | More than one item matches | Needs review |
| 4 | Nothing matches | Cannot identify |
| 5 | Matched, but not stocked here | Cannot identify |
| 6 | Quantity missing, zero or absurd | Needs review |
| 7 | Confidence below threshold (0.90) | Needs review |
| 8 | Model flagged doubt, or named an id we cannot verify | Needs review |
| 9 | Exactly one match, sane quantity, nothing flagged | **High confidence** |

Rule **8b** is the one the learning loop hangs off: a line identified by **sight** rather
than writing returns `needs_review` on every branch, at any score, with any number of
examples agreeing.

**Confidence can only demote.** There is deliberately no rule of the form "confidence is
high, therefore correct". A model returning `0.99` on nonsense changes nothing about what
a nurse may press.

**Store three opinions, not one.** Every proposed line keeps `proposedItemId` (what the
model claimed), `matchedItemId` (what our own matcher concluded, independently) and
`resolvedItemId` (what the human chose). Lose any one and you can no longer answer *who
decided this, and on what evidence* — and, as above, the third is the only one the
learning loop will accept as a label.

**Make double-deduction impossible, three times over.** A status compare-and-set, a unique
index on `(submissionId, sourceCandidateId)`, and `SELECT … FOR UPDATE` ordered by id with
a version-checked write. A redundant guard costs milliseconds; a missing one costs a resus
bay with the wrong stock. When two taps race, the loser replays the *same* receipt — the
user sees a confirmation twice, never an error.

**Put the catalogue in the prompt.** The single biggest accuracy decision in the project:
the model is selecting from 25 known items, not transcribing open vocabulary.

**Keep geometry out of the component.** All the box maths lives in a pure module with no
DOM, which is why it has 40 tests. What is left in React is measurement — and measurement
is where the bugs actually were.

[`docs/how-to-build-this.md`](docs/how-to-build-this.md) Part 3 has the pipeline diagram,
the full nine rules and the provider interface.

### Recognising the items themselves

A photo with no writing on it — used packaging, a wrapper, a drawer — can be matched
against reference photos taken **at that location, by those people, of that packaging**.
Teaching it is one tap on `/catalogue/recognition`; it also learns for free whenever
somebody corrects a visual line and confirms the withdrawal.

There is no model to retrain: recognition is nearest-neighbour search over a table, so
adding an example works on the next photo and deleting one undoes it just as fast — and
the system can always say *why* it matched.

**Learning improves the suggestion. It never improves the authority.** A line identified
by sight is `needs_review` on every path, at any score, with any number of examples
agreeing.

Each line the reader can place carries a **bounding box**, drawn over the photo so you
can see which item a card is talking about. The box is also what makes the learning work
at all: cropping to it means a photograph of four things on a tray teaches four examples
instead of none, which — since most real photos hold more than one thing — was the
ceiling on the whole loop. A box says *where to look*; it changes nothing about what may
be confirmed.

The improvement curve flattens after a few weeks, and the UI is built to say so rather
than to hide it: per-item states (*learning*, *good*, *as good as it gets*, *looks like
something else*, *photos are old*) instead of a rising accuracy number, a familiarity
count that never appears without "you still need to check this one", and no percentage
anywhere. [`docs/visual-recognition.md`](docs/visual-recognition.md) explains why it
plateaus, where the UX goes wrong if you pretend otherwise, and what was built about it.

### Turning recognition on, and what it costs

**Nothing.** It is on by default, because it cannot move stock. There is no key, no
dependency and no download: the default embedding provider is a hand-computed
colour-and-structure fingerprint, so it works on a fresh Vercel deployment immediately.
Boxes ride the same extraction call — four numbers per line, no second request.

```
VISUAL_RECOGNITION="off"     # the only variable you need, and only to switch it OFF
```

**Be honest about what the default recogniser knows.** It recognises *the same pack,
photographed on the same bench, in the same light*. It does not know what a syringe is.
Swapping in real CLIP changes that, and is also free to license:

```
EMBEDDING_PROVIDER="transformers"
VISION_MODEL="Xenova/clip-vit-base-patch32"
VISION_MODEL_DIMENSIONS="512"
# plus: npm install @huggingface/transformers
```

**Thresholds are provider-specific.** The shipped defaults are measured against the
built-in descriptor, and a cosine of 0.80 means something quite different under CLIP.
Switching providers re-teaches the index from scratch anyway; retune
`VISION_MATCH_FLOOR`, `VISION_CONFIDENT_AT` and `VISION_CONFUSABLE_MARGIN` at the same
time. All of them are documented in `.env.example`.

### Turning on real handwriting reading

```
EXTRACTION_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-…
ANTHROPIC_MODEL=claude-opus-5      # optional
```

Both variables are required; the flag without the key is a startup error, never a silent
fall-back to invented data. Why a vision model rather than classical OCR: Tesseract and its
kin are trained on printed text and do badly on handwriting, which is the entire input
here. What makes the read accurate is not just the model — it is that the location's
catalogue is **in the prompt**, so the task is constrained selection from 25 known items
rather than open-ended transcription. Details in
[`docs/ai-provider-contract.md`](docs/ai-provider-contract.md). Roughly a few cents per photo.

### Deploying to Vercel (so other people can use it)

The repo is set up so the build creates the tables and seeds the demo data by itself —
nothing to run locally. Sign-in is required on every page, so the link is private to
people you give the demo accounts to.

1. **vercel.com → Add New → Project → import
   [`jaydemetillo/ai-assisted-withdrawal-capture`](https://github.com/jaydemetillo/ai-assisted-withdrawal-capture).**
   Set the production branch to the branch you want deployed.
2. **Storage → Create Database → Neon (Postgres)**, free plan. This sets `DATABASE_URL`
   and `DATABASE_URL_UNPOOLED` for you.
3. **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `SESSION_SECRET` | any long random string — `openssl rand -hex 32` |
   | `EXTRACTION_PROVIDER` | `anthropic` |
   | `ANTHROPIC_API_KEY` | your key |
   | `DEMO_PASSWORD` | *(optional)* a password other than `demo1234` for the three demo accounts |
   | `VISUAL_RECOGNITION` | *(optional)* `off` to disable item recognition. Leave it unset to keep it on — it needs no key and no dependency |
   | `EMBEDDING_PROVIDER` | *(optional)* `transformers` for real CLIP, after `npm install @huggingface/transformers` — see [above](#turning-recognition-on-and-what-it-costs) |

4. **Deploy.** Then open the URL on your phone and sign in as `nurse@demo.local`.

**Schema changes apply themselves.** `vercel-build` runs `prisma migrate deploy` over the
unpooled connection before `next build`, so a deploy that adds columns — the bounding-box
fields, say — updates the database on the way through. The migrations are additive and
nullable, so redeploying over a database somebody has been demoing against does not
disturb its stock.

Photos are stored **in the database** by default, so there is no object store to
provision. Add **Storage → Create → Blob** when you outgrow that — it is cheaper per byte
and keeps large blobs out of your backups — and the adapter switches over automatically
with no migration.

**Environment variables are scoped per environment in Vercel.** A preview deployment
(`…-git-<branch>-…`) does not see variables added for Production only, so tick every
environment when you add them.

### Where to test what you build

```bash
npm test                                  # everything, 465 tests
npx vitest run tests/unit/rules.test.ts   # one file, while you are working on it
npm run typecheck
```

Unit tests are pure and always run. Integration tests need `TEST_DATABASE_URL` and **skip
visibly** if none is reachable — they never pass quietly for the wrong reason.

| Building this | Test that proves it | What it would catch |
|---|---|---|
| The decision rules | `tests/unit/rules.test.ts` | An ambiguous or controlled line becoming confirmable |
| Matching | `tests/unit/match.test.ts`, `normalize.test.ts` | "blue cannula" silently picking one of two |
| Handwriting variance | `tests/unit/handwriting.test.ts` | Tuning to one example — seven spellings must reach the *same* decision |
| The live model adapter | `tests/unit/anthropic-provider.test.ts` | An invented item id, a prompt-injection attempt, a malformed reply, a missing schema field |
| Confirmation | `tests/integration/confirm.test.ts` | Two taps deducting twice |
| Reading changes nothing | `tests/integration/extract.test.ts` | A read moving a balance or bumping a version |
| Recognition | `tests/unit/similarity.test.ts`, `visual-identification.test.ts` | A seen line becoming confirmable at a high score |
| Learning | `tests/integration/visual-learning.test.ts` | Teaching from something a human never confirmed |
| Boxes, geometry | `tests/unit/boxes.test.ts` | Squashed, fused, off-item boxes; labels on top of each other |
| Boxes, cropping | `tests/integration/box-learning.test.ts` | A crop cutting the **wrong region** — runs the real provider over real JPEGs |

**And test it with your eyes, because some bugs only exist in a browser.** Two of the
worst in this build passed every unit test: an overlay that vanished on any *second* visit
(a cached image never fires `onLoad`), and a number chip sitting exactly on top of the line
above it. Both were found by opening the page and looking at it. Run
[`docs/demo-script.md`](docs/demo-script.md) — ten minutes, offline, no credentials — and
on a deployment open `/api/health`, which names the exact variable that is missing.

---

## 4 · Challenges, what we tried, and what to consider

### What went wrong, and what fixed it

The full write-ups, with fixes, are in
[`docs/how-to-build-this.md`](docs/how-to-build-this.md) Part 4. The ones worth knowing
before you start:

| What happened | Why | What fixed it |
|---|---|---|
| Classical OCR could not read the notes | Tesseract is trained on printed text; the input is handwriting | A vision model — and the catalogue in the prompt, so it is constrained selection, not transcription |
| A bare number wrecked matching | "2" matched dozens of items | Quantity and identity are parsed separately and never traded off |
| Rule order produced a wrong answer | A confidence check ran before the controlled-item check | The rules are an *ordered* pure function, tested as a sequence |
| The recogniser scored a blue pack 0.983 against an **orange** one | A hue histogram concatenated with two much larger histograms, then normalised once — the counts swamped the colour | Normalise each sub-histogram first. *Measure it; do not reason about it* |
| A tray photo taught nothing | An embedding describes a whole image; four items on a tray is near none of them | Bounding boxes. Crop per line → one photo teaches several items. **This was their real value, not the drawing** |
| Boxes looked squashed and off the item | The photo was rendered as a square `object-cover` crop, discarding up to 40% of a portrait photo | `object-contain`, and measure against the *rendered image rectangle*, not the container |
| Boxes landed at right angles on iPhone photos | The model reads a rotated, resized copy; the browser shows the original | Boxes are **fractions**, never pixels — plus `.rotate()` before cropping |
| Adjacent boxes fused into a blob | Uniform padding | Padding that yields to its neighbour, keeping a visible channel between them |
| The overlay vanished on every second visit | A cached image finishes loading before React attaches `onLoad` | Also read `img.complete` on mount |
| Rule 8b never fired in production | `evidence` was missing from the live tool schema, so every line arrived as "written text" | Added it, made it required, and asserted it against the real request body |

### What we tried, and measured

**Is a real vision model worth 90 MB?** The default recogniser is a hand-computed
colour-and-structure fingerprint; the alternative is CLIP, which is free to license and
swapped in with one environment variable (see
[turning recognition on](#turning-recognition-on-and-what-it-costs)). To find out what it
actually buys, we measured both over four images — two shapes × two colours — cosine
similarity:

| | built-in descriptor | CLIP |
|---|---|---|
| Same shape, different colour | 0.648 | **0.944** |
| Same colour, different shape | **0.790** | 0.859 |

The ordering inverts. The descriptor groups by **colour**; CLIP groups by **what the
thing is**. On a cart where a whole product range shares one livery, that is the
difference between useful and actively misleading. Why it is still not the default:
roughly 90 MB of weights inside a 250 MB serverless bundle, loaded on every cold start.
Free to license is not free to run — so it is a deployment decision, made with a variable,
not a code change.

**Read that table as a direction, not a score.** It is four generated images probing one
specific question — does the vector follow colour or shape? — and it answers that clearly.
It is not an accuracy measurement, and nothing here has been measured against real
packaging on a real cart. That work is named as outstanding in
[`docs/visual-recognition.md`](docs/visual-recognition.md), not quietly assumed.

### What we deliberately did not build

Worth stating, because each one gets asked for:

- **Auto-confirm above a confidence threshold.** Everyone asks. It destroys the entire
  safety property: the moment there is a path where no human looks, you have a system that
  silently corrupts inventory. It is also what would break the learning loop — the labels
  come *from* people confirming.
- **Free-text notes on the nurse path.** Another field to fill in, and a place for patient
  information to leak.
- **A cleverer fuzzy matcher in the confirm path.** Fuzzy matching is great for *offering
  suggestions* and terrible for *deciding*. Keep them strictly apart, or one day "20G"
  becomes "18G" because the letters mostly agreed.
- **A rising accuracy number.** Once a system is right 90% of the time people stop reading
  the screen. **Better accuracy does not fix automation bias — it causes it.**
- **Auto-created aliases from corrections.** The visual half of learning is safe because a
  human chose the label explicitly; auto-writing text aliases from the same data is how a
  catalogue poisons itself. Surface them to an admin as *suggestions* instead.

### Known gaps

Stated plainly, because a prototype that hides its edges is worse than one that names
them:

- **No hand-drawn boxes.** A line the reader could not place gets no box, and nobody can
  draw one. The most obvious next thing.
- **No capture guidance.** Nothing says a photo is blurry, backlit or too far away
  *before* it is submitted — the cheapest accuracy win still on the table.
- **No barcode scanning.** Most packs have one, and a scanned barcode beats any vision
  model on both cost and certainty.
- **Learned examples never cross locations.** Right for lighting and cart layout, wrong
  for a hospital that has photographed the same item a thousand times down the corridor.
- **No real accuracy measurement.** Every test uses synthetic packs and a mock reader.
  They prove the pipeline is sound; they prove nothing about a real cart in real light.
- **Auth, storage and retention are placeholders** — see
  [the security table](#security-that-is-real-and-security-that-is-a-placeholder) and the
  prototype warning at the end of this file.

---

## 5 · Reference

### Documentation

| Document | What is in it |
|---|---|
| [`docs/how-to-build-this.md`](docs/how-to-build-this.md) | **Start here.** Plain-language guide for designers and engineers: the idea, the design decisions, every hard part we hit and how it was fixed, and how to build it better |
| [`docs/architecture.md`](docs/architecture.md) | Pipeline, stack and why, module layout, request lifecycles, adapters, configuration, failure behaviour |
| [`docs/safety-and-decision-rules.md`](docs/safety-and-decision-rules.md) | The seven principles, the nine ordered decision rules, stock policy, audit coverage, privacy boundaries, known limits |
| [`docs/data-model.md`](docs/data-model.md) | The Prisma models, enums, indexes, and the seed catalogue |
| [`docs/assumptions-and-risks.md`](docs/assumptions-and-risks.md) | Every assumption made, the risk register, and lessons carried over from the reference prototype |
| [`docs/workflow.md`](docs/workflow.md) | The end-to-end flow, screen by screen, and what an auditor can reconstruct |
| [`docs/ai-provider-contract.md`](docs/ai-provider-contract.md) | What a provider is given, what it must return, and the boundaries it cannot cross |
| [`docs/visual-recognition.md`](docs/visual-recognition.md) | Recognising items from photographs, how it learns from confirmed corrections, the guards on that, and why the improvement curve plateaus — plus what the UI does about it |
| [`docs/test-scenarios.md`](docs/test-scenarios.md) | Every acceptance case mapped to the test that proves it |
| [`docs/demo-script.md`](docs/demo-script.md) | Ten minutes, offline: clear note → ambiguous → reviewer correction → confirm → replenishment |
| [`TODO.md`](TODO.md) | The phased checklist and the acceptance criteria |

### The catalogue, and why "blue cannula" is refused

The seed stocks both an **18G** and a **22G** blue cannula. So:

- *"18G blue cannula x1"* matches exactly one item → **High confidence**, confirmable.
- *"blue cannula x1"* matches two → **Needs review**, and cannot be confirmed — even
  though "blue cannula" is *also* an approved alias of the 18G. **Ambiguity beats an
  alias.** An alias only makes a line confirmable when it is the sole match.
- *"? gauze maybe"* → **Cannot identify**, and goes to supply review with the photo.

That middle case is the one worth staring at. It is what stops a sloppy alias, added by
an operator a year from now, from silently deducting the wrong item.

### Screens

| Route | Who | What |
|---|---|---|
| `/withdrawals/new` | everyone | Location (preselected) + one photo. Nothing else. |
| `/withdrawals/[id]/processing` | submitter | Resumable; says you can leave, and means it |
| `/withdrawals/[id]/review` | submitter, reviewers | Photo with a box round each line the reader could place — tap a box to find its card, tap a card to find its box, hide them if they are in the way. Text, proposals in plain words, four actions. Confirm disabled while anything is unresolved |
| `/withdrawals/[id]/confirmed` | submitter, reviewers | The receipt: `24 → 23`, and what it raised |
| `/supply-review` | reviewer, admin | Queue filtered by location, age, status, risk |
| `/supply-review/[caseId]` | reviewer, admin | Evidence + match / requantify / reject / physical check / approve |
| `/catalogue/recognition` | everyone; deleting an example needs a reviewer | Teach the recogniser: one tap, rear camera, done. Per-item state in words — *learning*, *good*, *as good as it gets*, *looks like something else* — and never a percentage |
| `/inventory` | everyone | Stock by location, low stock first, movements, replenishment tasks |

### Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS · PostgreSQL 16 · Prisma 6 ·
Zod 4 · Vitest. Roles: `nurse`, `supply_reviewer`, `admin`.

Every business rule is an environment variable with a documented default — confidence
threshold, maximum line quantity, negative-stock policy, whether a nurse may ever confirm
a restricted item. See `.env.example` and
[`docs/safety-and-decision-rules.md`](docs/safety-and-decision-rules.md). A malformed
value makes the application refuse to start rather than quietly fall back to a default,
because a deployment running safety rules nobody intended is worse than one that will not
boot.

### What is mocked, and what would need configuring

| Piece | Local demo | Production |
|---|---|---|
| **Image reading** | `MockExtractionProvider` — three fixed scenarios (high-confidence, ambiguous, unreadable). No network, no credentials, no cost. Shown as a visible badge in the UI. | An Anthropic Claude Vision adapter, inert unless `EXTRACTION_PROVIDER=anthropic` **and** `ANTHROPIC_API_KEY` are both set. Roughly a few cents per photo. Handwriting is where a vision model earns its keep — classical OCR is trained on printed text and does poorly on a scribbled note. |
| **Item recognition** | On by default: the built-in colour-and-structure fingerprint. No dependency, no download, no key. Learns from corrections people already make. | The same code with `EMBEDDING_PROVIDER=transformers` for real CLIP (~90 MB of weights on every cold start), or any other model behind the same one-method interface. Either way it only ever changes the suggestion, never what may be confirmed. |
| **Image storage** | `LocalDiskStorage`, files under `.data/uploads`, served through an authenticated route. | An object store behind the same `StorageAdapter` interface (S3 skeleton provided). Serverless hosts have ephemeral disks — local storage will silently lose images there. |
| **Authentication** | Cookie session, `scrypt` hashing, three seeded demo accounts. | Your hospital identity provider, behind the same `requireRole()` boundary. |
| **Database** | Local PostgreSQL 16 started by a repo script. | Managed Postgres. Migrations are checked in as reviewable SQL. |

**Nothing leaves the machine in the default local demo.** No external AI provider is
called unless you explicitly enable one.

**The sample reader will not run silently on a deployment.** Locally, an unset
`EXTRACTION_PROVIDER` means the offline mock — that is the point of an offline demo. On
Vercel it is a misconfiguration, and a dangerous one: the mock returns a fixed sample note
*whatever you photograph*, so a real document comes back as somebody else's supply list.
There, an unset variable is an error naming what to set. Set `EXTRACTION_PROVIDER=mock`
explicitly if you genuinely want samples, and every screen showing its output says, in red,
that the reading is invented.

### Security that is real, and security that is a placeholder

| Real, in this build | Placeholder — replace before any deployment |
|---|---|
| Role checks on every route and page (`requireRole`) | Cookie sessions with `scrypt` — swap for your identity provider |
| Image access needs a session **and** a per-user, expiring HMAC token | In-memory rate limiting — per instance, resets on restart; use Redis or an edge limiter |
| CSRF: `SameSite=lax` cookie **and** an Origin check on every mutation | Image storage — database rows by default, Vercel Blob when attached (unguessable public URLs, not private-at-rest). For real use, an S3-style store with signed access behind the same three-method adapter |
| Append-only audit events with before/after on every mutation | No retention policy — nothing is ever deleted |
| Logger that cannot carry content (tested) | No TLS termination, secrets management, or backup story — that is your platform's |
| Security headers: `nosniff`, `DENY` framing, `no-referrer`, camera-only permissions | |

### Something not working? Open `/api/health` first

`https://your-app.vercel.app/api/health` answers the question directly: is the database
reachable and seeded, which reader is active, where photos are stored, and **exactly which
environment variable is missing**. It reports whether a key is present, never any part of
its value. The capture screen shows the same problems in a red banner, so you find out
before photographing a note rather than after.

The commonest first-deploy failures, all of which that endpoint names:

| Symptom | Cause |
|---|---|
| Upload fails with a 500 | Fixed: photos now go to the database when no Blob store is attached |
| Sign-in fails | `SESSION_SECRET` not set, or set for Production only while you are on a preview URL |
| "Claude vision is switched on but has no API key" | `EXTRACTION_PROVIDER=anthropic` without `ANTHROPIC_API_KEY` |
| "Your photo was not read" banner | `EXTRACTION_PROVIDER` not set. On a deployment this now refuses to run rather than replaying a sample note |
| Build red | `DATABASE_URL` missing; add the Neon integration and redeploy |

When a read itself fails, the processing screen shows the real reason and keeps the photo,
so you can retry or send it to supply review.

The first build runs the migrations and seeds the catalogue; later builds leave your data
alone. If a build goes red, the Deployments tab shows why — nearly always a missing
variable from the table above. The `vercel-build` script is `prisma generate → apply
migrations over the unpooled connection → seed if empty → next build`.

Photos are resized to 1800 px in the browser before upload (Vercel caps request bodies
at 4.5 MB, and iPhones send HEIC), and the model read is capped at 60 s.

**Storage caveat, stated plainly:** Vercel Blob serves objects from an unguessable public
URL. That URL never reaches a browser — every read goes through the authenticated,
token-checked image route — but it is not private-at-rest storage. Fine for a test; a
real deployment wants an S3-style store with signed access behind the same three-method
adapter.

---

## ⚠️ This is a prototype, not a deployable clinical system

This repository demonstrates a workflow and a set of safety properties. It is **not**
ready for use in a care setting, and no part of it constitutes a regulatory, privacy, or
security assessment. Before any real deployment, your organisation must run its own review
of at least:

- **Privacy and data protection** — lawful basis, DPIA, patient-information risk in
  photographs (the UI instructs users not to photograph patient information; that is
  guidance, not a technical control).
- **Security** — authentication and identity integration, authorisation model, image
  access control, transport and at-rest encryption, key management, penetration testing.
- **Retention and disposal** — nothing here auto-deletes. Images, raw extracted text, and
  audit events accumulate indefinitely until you set a policy.
- **Vendor and third-party review** — if you enable an external AI provider, its data
  handling, retention, residency, and contractual terms.
- **Regulatory and clinical governance** — medical device classification where relevant,
  controlled-substance handling rules (this prototype requires reviewer sign-off but does
  **not** implement witness/double-signature workflows), and local pharmacy and materials
  management policy.
- **Validation** — accuracy of the extraction provider against your own handwriting,
  labels, and catalogue. No accuracy claim in this repository is based on anything but a
  mock.

This is an **inventory** workflow. It must not be extended to infer treatment, dosage, or
patient information without a separate clinical safety process.
