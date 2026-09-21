# Visual recognition, and how it learns

A nurse photographs an item with no writing on it. The first time, the system has never
seen it and says so. Somebody tells it what it is. The third time, it suggests the right
thing before anyone has typed anything.

Nobody trains it. There is no model to retrain and no weights to redeploy. **The learning
is a table.**

---

## 1. Why a table, and not a fine-tuned model

The obvious approach — fine-tune an image classifier on your catalogue — is the wrong one
here, and not by a little.

| | Fine-tuning | Nearest neighbour over embeddings |
|---|---|---|
| Examples needed per item | Hundreds | **One** |
| Adding an example | Retrain, redeploy | An `INSERT` |
| Removing a bad one | Retrain, and hope | A soft delete, effective immediately |
| "Why did it match?" | Unanswerable | "It looks like these three photos, which Sam labelled in March" |
| Cost | A GPU | Free, CPU, sub-millisecond |

The two rows in bold are the ones that decide it. A hospital system that cannot explain a
suggestion, and cannot immediately undo a wrong thing it learned, is a system nobody
should deploy. Both properties come free with nearest neighbour and are extremely hard to
retrofit onto a fine-tuned model.

So: run each photo through a model that turns images into vectors, store the vector
against the item id, and answer "have I seen this before?" with a distance calculation.

25 items × 12 photos = 300 vectors. Brute-force cosine over that is faster than the
database round trip that fetched them. A vector database earns its place in the
thousands, not here.

---

## 2. The two ways it learns

**Teaching.** The recognition screen (`/catalogue/recognition`) lists every item at a
location with a "Photograph this item" button that opens the rear camera directly. One
tap, one photo, done. This is the cold-start path.

**Confirmed corrections — the part that needs no work from anybody.** When a visually
identified line is confirmed, that is a labelled example, verified by somebody being
willing to change stock over it. It costs nobody anything, and it is why the system gets
better simply because people used it.

### The four guards on learning from corrections

1. **Only a confirmed withdrawal teaches.** An abandoned or cancelled submission is
   somebody who was not sure. Learning from those fills the index with the cases that
   went wrong.
2. **Only an explicit human choice.** `resolvedItemId` is set by a person tapping an
   item, never by the rules. A visual line is always `needs_review`, so it cannot reach a
   confirmation without one — every label here was *chosen*, not accepted by default.
3. **Only a single-item photograph.** An embedding describes a whole image. A tray
   holding four things embeds to "a tray holding four things", which is near none of the
   four. Filing it under whichever line came first would teach something false about all
   of them, so a multi-item photo teaches nothing.
4. **A line teaches at most once.** `sourceCandidateId` is unique, so a replayed
   confirmation adds nothing.

Guard 3 is the expensive one, and it is why **per-item bounding boxes are the single
highest-value thing to build next**: they would turn every tray photo into four examples
instead of none.

---

## 3. What it can never do

> **Learning improves the suggestion. It never improves the authority.**

A line identified by sight is `needs_review` on every path, at every score, with any
number of examples agreeing. This is not a policy that could be relaxed by a config flag;
it is a branch in `lib/decision/rules.ts` with no `eligible` in it, and
`tests/unit/learned-recognition.test.ts` asserts it across every combination of score,
example count and agreement count, including a perfect 1.0 with 500 agreements.

The recogniser also cannot:

- reach an item that is not stocked at that location (teaching one is refused);
- make a controlled or high-risk item self-confirmable (rule 2 fires first);
- influence a line that was read from writing (a photo of a note is a piece of paper —
  "which catalogue item does this note look like?" has no meaningful answer);
- write to any table but `ItemReferencePhoto`.

---

## 4. Designing for the ceiling

The improvement curve flattens. This section exists because a plateau nobody predicted
looks like a system that broke, and a plateau you designed for looks like a system being
straight with you. Everything below is built, not aspirational — the UI state names in
brackets are what the recognition screen actually shows.

### Why it plateaus

**1. The photo does not contain the information.** The hard ceiling. No number of
examples teaches a model to see what is not in the pixels. The catalogue splits three
ways:

| | Example | Curve |
|---|---|---|
| Visually distinct | Giving set, BVM, defib pads | Learns fast, stays good |
| Distinguishable only by label | 5 mL vs 10 mL syringe | Learns only if the label faces the camera |
| Genuinely identical | Nitrile gloves medium vs large | **Never learnable** |

Gloves are the honest case: same box, same colour, size in 8pt text.
`tests/unit/descriptor.test.ts` asserts this limit rather than leaving it in a comment.

**2. Embeddings saturate.** 0 → 1 example is transformative. 1 → 5 is good. 5 → 20 is
marginal. Past that you are re-sampling the same bench in the same light. Shown as
**[As good as it gets]** when an item is at the cap and its examples are near-identical —
`diversity()` below 0.1.

**3. The long tail never arrives.** Corrections only teach items people actually
withdraw. An item used twice a year gets two examples, ever — and those are exactly the
ones people are least sure about. The system gets excellent at the common 20% and stays
poor at the tail, which is where help was most valuable. Shown as **[No photos yet]**,
counted on the screen header, so the gap is visible rather than inferred.

**4. Confusable pairs get *worse* with more data, not better.** The catalogue
deliberately stocks 18G *and* 22G blue cannulas, 5×5 *and* 10×10 gauze. Embeddings
cluster by visual similarity, so those pairs land on top of each other, and more examples
of both makes the clusters denser and more overlapping. **The system plateaus hardest
precisely on the distinctions that matter.** Detected by `confusablePairs()` and shown as
**[Looks like something else]**, naming the other item. Such an item is never "good"
however high it scores, and the card tells the nurse to read the label.

**5. Drift silently undoes progress.** New packaging, a ward refit, a different phone's
colour processing — and the examples now describe a world that is gone. **A stale example
is worse than none**, because it still matches confidently and is now wrong. Examples
past `VISION_STALE_AFTER_DAYS` are down-weighted and the item is shown as **[Photos are
old]**.

### When the UX becomes a problem

**The dangerous one: when it gets good.** Early on it is visibly unsure, so people check
carefully. Once it is right 90% of the time they stop reading the screen, and the
remaining 10% starts slipping through *because* accuracy improved. **Better accuracy does
not fix automation bias — it causes it.** The only defence is friction that does not
scale down with confidence, which is exactly what "a visual line is always
`needs_review`" is.

**"Seen 14 times" read as "verified 14 times".** A reinforcement count is a *familiarity*
signal — how common the item is — not a correctness one. So the badge never appears
without the obligation in the same breath: *"Matched against 3 photos taken here ·
confirmed 14×. You still need to check this one."* And there is **no percentage anywhere
in the UI**: a score of 0.86 invites a judgement nobody holding a phone has the
information to make.

**One person's mistake spreads to everyone.** Teaching is open to nurses, because an
index only reviewers can add to is an index nobody adds to. The counterweights: every
example records who labelled it, every example is visible and deletable, and credit and
blame land on the *nearest* example rather than being spread across all twelve — so a
single bad photo actually accumulates overrules and quarantines itself at
`VISION_OVERRULE_LIMIT`. Spreading blame evenly would mean it never did.

**Teaching that feels like unpaid work.** "Photograph the whole catalogue" is an
afternoon nobody has. Hence: teaching is a side effect of correcting, and the deliberate
path is one tap on a screen you were already looking at.

**When the improvement stops being visible.** Weeks 1–4 feel magical; week 12 it has
plateaued and nobody can tell whether it is still learning. Which is why the recognition
screen shows per-item *states* rather than a rising accuracy number that will be a lie by
about week six.

### The promise that survives the plateau

> The goal is not "recognises everything". It is **"turns a six-tap correction into a
> one-tap confirmation for the items you actually use, and admits when it cannot tell"**.

---

## 4b. Bounding boxes, and why they were the ceiling

Before boxes, the recogniser refused every photograph holding more than one thing — and
so did the learner. That was not timidity, it was arithmetic: an embedding describes a
*whole image*, so a tray of four items embeds to "a tray of four items", which is near
none of the four. Filing that vector under whichever line came first would have taught
the index something false about all four.

The consequence was that **the system learned almost nothing from normal use**, because
most real photographs of a cart hold more than one thing. The learning loop worked
perfectly on the one case that rarely happens.

A box removes the ambiguity. Crop to it, and the vector describes the item. One tray
photograph now becomes four honest recognitions and, on confirmation, four training
examples.

### The coordinate frame, stated once

A box is **four fractions of the prepared image**, never pixels. `lib/extraction/image.ts`
hands the model a photo that has been EXIF-rotated, resized to a 1568px long edge and
contrast-normalised; the browser displays the *original* bytes. Pixel coordinates are
therefore in a frame that exists nowhere on screen — and on a photo an iPhone stored as
"rotate 90°" they are not even on the same axis.

Fractions survive all of it, because the resize preserves aspect ratio and a browser
applies EXIF orientation to an `<img>` by default — the same rotation sharp applied. The
crop path applies `.rotate()` before extracting for exactly the same reason; without it
the crop lands at right angles to the item, which is invisible in the database and shows
up months later as a recogniser that suggests the wrong thing.

### Drawing them without it looking broken

A faithful rendering of what a model returns looks awful, so the reported box stays the
record and a separate pure layout pass (`lib/vision/boxes.ts`) decides what is drawn:

| Failure | What it looks like | What is done about it |
|---|---|---|
| Cropped display | Boxes displaced and misshapen | The photo renders `object-contain` at its own aspect ratio; the overlay is measured against the **rendered image rect**, not the container |
| Degenerate box | A sliver, an inverted rectangle, a box round everything | `normaliseBox` sorts corners, clamps, and **rejects** — a rejected box is no box, never a bad one |
| Tiny box | A 9px sliver nobody can see or tap | Grown to a 44px minimum **about its centre**, so it stays on the item instead of walking off it |
| Adjacent boxes | Two outlines fused into one blob | Padding that **yields to a close neighbour**, keeping a 2px channel |
| Colliding labels | Numbers stacked on each other | Each chip takes the first of four slots that is free |
| A chip on a neighbour's box | The number covers the words it is pointing at | Chip placement scores overlap with *other* boxes too |
| Invisible outline | A thin line lost in a busy photo | Double stroke: light inner ring, dark outer |

And the part that is a judgement rather than a calculation: **the overlay is not the
interface.** The cards still are. Boxes sit quietly, only the selected one is emphasised,
only the selected one gets words — in a caption pinned to the bottom edge where it cannot
collide with anything. Tapping a box selects its card and tapping a card selects its box.
There is a **"Hide boxes" toggle and it is remembered**, because on a genuinely messy
photo the overlay *is* annoying, and the honest response is to let somebody turn it off.

### What a box does not change

Nothing about authority. A boxed visual line is `needs_review`, at any score, exactly as
an unboxed one is. A box says *where to look* — it is an aid to checking, never a reason
to skip it.

---

## 5. The providers

| `EMBEDDING_PROVIDER` | What it is |
|---|---|
| *(unset — the default)* | A hand-computed colour-and-structure descriptor. No dependency, no download, no cold start. |
| `transformers` | CLIP or SigLIP via transformers.js, on CPU, free and local. Needs `npm install @huggingface/transformers`. |

**The default is not CLIP, and that is deliberate.** Every previous piece of this
prototype that required setup before it worked at all produced an opaque failure in front
of a user. The built-in descriptor recognises *the same packet photographed twice on the
same bench*, which is the actual job, and recognises *the concept of a syringe* not at
all. It works everywhere, immediately.

It is also safe to ship precisely because it is weak: visual evidence can never reach
`eligible`, so the worst a bad vector achieves is a wrong suggestion in front of somebody
who is required to look anyway.

The descriptor is three blocks, each normalised separately then weighted:

1. **Global colour** (24 dims, weight 0.60) — a hue histogram weighted by saturation and
   brightness so grey pixels do not vote, plus saturation and brightness histograms.
   Translation-invariant. Medical packaging is aggressively colour-coded, so this is the
   strongest signal.
2. **Tiled colour** (48 dims, weight 0.15) — mean RGB over a 4×4 grid. Adds "blue on the
   left, white on the right".
3. **Edge orientation** (64 dims, weight 0.25) — per tile, gradient energy in four
   directions. Separates a ribbed syringe barrel from a flat wrapper of the same colour.

> **A bug worth remembering.** The first version concatenated all three colour
> sub-histograms and normalised once. The hue histogram sums `saturation × brightness` to
> a few thousand; the other two sum pixel *counts* to 4096 each. The counts swamped the
> hue, and hue is the only part that knows blue from orange — so a blue pack scored
> **0.983 against an orange one** and only 0.806 against another photo of itself. It
> looked like a plausible descriptor and was worse than useless. Normalising each
> sub-histogram before combining fixed it: 0.96 against itself, 0.59 against the orange.
> Measured, not reasoned about.

### What CLIP actually buys you, measured

The transformers adapter has now been run end to end against the real
`@huggingface/transformers` with `Xenova/clip-vit-base-patch32` — `RawImage.fromBlob`
accepts a JPEG buffer, the pipeline returns a `Tensor` of `dims: [1, 512]`, and
`toVector` parses it to 512 finite numbers.

Over four images that are two shapes in two colours:

| similarity | descriptor | CLIP |
|---|---|---|
| same shape, different colour | 0.648 | **0.944** |
| same colour, different shape | **0.790** | 0.859 |

**The ordering inverts.** The descriptor groups by colour; CLIP groups by what the thing
is. On a cart where an entire product range shares a livery, that is the difference
between a recogniser worth having and one that confidently confuses a syringe with a
dressing pack.

The reason it is still not the default is cost of a different kind: the weights are
~90 MB fetched at first use, inside a serverless bundle capped at 250 MB, on every cold
start. Free to license, not free to run — which is a deployment decision, not a code one.

### Switching providers

Vectors from two providers are unrelated coordinates; the cosine between them is noise
that looks exactly like a score. Every stored vector carries its `embeddingModel` and
every read filters to the active one, so **switching providers makes the index read as
empty and re-teach from scratch**. Visible and recoverable, rather than subtly wrong.

Retune the thresholds at the same time: the defaults are measured against the built-in
descriptor, and 0.80 means something quite different under CLIP.

---

## 6. Configuration

All in `.env.example`, all validated on load — a malformed value throws rather than
silently defaulting, because a typo here means a deployment running thresholds nobody
intended.

| Variable | Default | What it does |
|---|---|---|
| `VISUAL_RECOGNITION` | on | `off` disables it entirely; the index is kept and nothing reads it |
| `EMBEDDING_PROVIDER` | descriptor | `transformers` for CLIP |
| `VISION_MATCH_FLOOR` | 0.72 | Below this, a stored photo is not evidence of anything |
| `VISION_CONFIDENT_AT` | 0.84 | At or above this, and clear of the runner-up, recognition reads as settled |
| `VISION_CONFUSABLE_MARGIN` | 0.05 | Items within this of each other are not separable by sight |
| `VISION_MAX_EXAMPLES` | 12 | **This cap is the plateau, made explicit** |
| `VISION_CONFIDENT_EXAMPLES` | 3 | Below this, an item reads as "learning" |
| `VISION_STALE_AFTER_DAYS` | 365 | After this, examples are down-weighted and flagged |
| `VISION_OVERRULE_LIMIT` | 3 | Overrules before an example quarantines itself |

---

## 7. Hygiene

**Eviction keeps the most diverse example, not the most recent.** Twelve photos from the
same angle are worth roughly one photo; the eleven-month-old shot of the pack lying on
its side is the only thing that recognises it lying on its side. `mostRedundant()` drops
the example with the highest mean similarity to its siblings — the one the others already
cover.

**An item scores by its nearest example, not the average.** Averaging punishes an item
for having varied examples, which is the one thing we want a set of examples to be. The
cost is sensitivity to a single bad example, which is why overrule tracking exists.

**Reinforcement does not raise an example's weight.** Letting an example agreed with
fourteen times outscore a fresh one is confidence inflation: the numbers rise because the
item is common, not because the match is better.

**Removal is a soft delete.** It takes effect on the very next photograph, and the
retired row stays visible on the recognition screen so *"why did it stop recognising
this?"* has an answer.

---

## 8. Where the code is

| File | What |
|---|---|
| `lib/vision/similarity.ts` | **Pure.** Cosine, nearest neighbour, confusable detection, states, eviction |
| `lib/vision/boxes.ts` | **Pure.** Box validation, crop regions, and the whole overlay layout |
| `app/withdrawals/[id]/review/PhotoWithBoxes.tsx` | The overlay — measurement only, no geometry |
| `lib/vision/config.ts` | Thresholds, validated |
| `lib/vision/embedding/descriptor.ts` | The built-in fingerprint; `describePixels` is pure and synchronous |
| `lib/vision/embedding/transformers.ts` | The optional CLIP adapter |
| `lib/vision/reference-photos.ts` | The index: read, teach, retire, credit, blame, cap |
| `lib/vision/recognize.ts` | The seam — database and model on one side, pure matching on the other |
| `lib/vision/learn.ts` | What a confirmation teaches |
| `lib/decision/rules.ts` | Rule 8b — where the learning lands, and where it stops |
| `app/catalogue/recognition/` | The honest-plateau screen |

`similarity.ts` is pure for the same reason `rules.ts` is: `now` is a parameter, so the
same query and the same examples give the same answer in CI, on a phone, and in an audit
reconstruction two years from now.

---

## 9. What is not built

- **Boxes drawn by hand.** A line the reader could not place gets no box, and there is
  no way for a person to draw one themselves. That is the next obvious thing.
- **Capture guidance.** Nothing tells a nurse the photo is blurry, backlit, or too far
  away before they submit it.
- **A cross-location catalogue of *look*.** Examples never cross locations, which is
  right for lighting and cart layout but means every new bay starts from zero even for
  an item the hospital has photographed a thousand times elsewhere.
- **Anything resembling a real accuracy measurement.** The tests use synthetic packs.
  They prove the pipeline is sound and the thresholds are in the right neighbourhood.
  They prove nothing about a real resus cart in real light — which is the other reason
  every visually identified line still goes to a person.
