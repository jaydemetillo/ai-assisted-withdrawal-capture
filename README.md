# Write it down and scan it

Photograph a handwritten stock list, and have it counted into inventory.

A nurse scribbles `3x Masks / 4x Syringes / 5x Saline — Withdrawn` on a scrap of paper,
photographs it in the app, checks what was read, and taps submit. Masks go from 130 to
127. The photo stays attached to the transaction as evidence an admin can open and, if
the count was wrong, correct.

`Disposed` works identically — same subtraction, different event, different wording
throughout.

Built from the Pulse Master V2 Figma file: mobile home `8791:34509`, photo reason
`8792:28573`, capture `8792:28616`, desktop transaction table `8138:141367`.

---

## Quick start

```bash
npm install
cp .env.example .env
npm run setup       # creates the SQLite database and seeds 35 items across 2 storerooms
npm run dev         # http://localhost:3000
```

Open `/` for the phone flow (drawn inside a device frame on a desktop browser) and
`/admin` for the desktop console.

**No API key needed, and the handwriting is still really read.** The phone reads the photo
itself — Tesseract's LSTM engine compiled to WebAssembly, running in the browser that took
the picture. Free, offline, and the photo is never sent anywhere to be read. `ANTHROPIC_API_KEY`
is optional and buys accuracy, not the feature.

---

## Deploying it (free, and the phone updates the desktop)

Import the repo at **vercel.com** (Add New -> Project -> pick the repo -> Import), then
add one thing before deploying:

**Storage -> Create Database -> Neon (Postgres)**, on the Free plan. That is the whole
setup. Neon's free tier needs no credit card, and attaching it sets `DATABASE_URL` for
you. On the first deploy the build creates the tables and seeds the catalogue by itself -
nothing to run locally.

Then:

- phone: `https://your-app.vercel.app`
- desktop: `https://your-app.vercel.app/admin`

Submit a list on the phone and it is in the desktop table on the next load, with the
photo attached. **One database, both surfaces** - which is the point of the thing.

No API key is needed, and photographing a note really does read it: the reading happens in
the phone's own browser (see *How the reading actually works*). Nothing is metered, because
nothing leaves the device to be read. Add `ANTHROPIC_API_KEY` in Project Settings later if
you want the more accurate vision read instead (a few cents per photo).

### If pushes don't seem to deploy

Two things account for almost every "Vercel isn't updating" case here.

**The production branch.** Vercel picks one when the project is imported and then keeps
it. If it is tracking a branch you are no longer pushing to, your pushes become preview
deployments (different URLs) and the production URL never changes. Fix it under
**Settings -> Environments -> Production -> Branch Tracking** (older projects:
**Settings -> Git -> Production Branch**), then redeploy. Deploying from `main` avoids
this entirely, which is why `main` exists in this repo.

**A failed build leaves the old one live.** Check the Deployments tab for red builds
before assuming nothing happened. The usual cause here was the pooled database
connection - see below.

### Why the build uses a different database URL than the app

Neon and Vercel Postgres set `DATABASE_URL` to a *pooled* endpoint. That is the right
choice for a serverless app making many short-lived connections, but schema changes
cannot run through a transaction-mode pooler, so `prisma db push` fails and takes the
build down with it. Both integrations also expose the direct endpoint
(`DATABASE_URL_UNPOOLED` or `POSTGRES_URL_NON_POOLING`); `scripts/prepare-db.ts` uses
whichever is present for the push and the seed, and leaves the running app on the pooled
URL.

### Why only a database, and no file storage

A serverless host gives every request its own disposable disk, so a photo written during
an upload is gone by the time the review screen asks for it. Rather than make you
provision an object store too, the browser makes a small thumbnail before uploading and
that is what gets kept as the evidence image. The full-resolution photo is still what
gets read - it just isn't stored. Attach a Vercel Blob store and full images are used
instead, automatically.

### The no-database version

If you skip the Neon step entirely, the deploy still works and `/` and `/admin` redirect
to `/demo.html` - a self-contained build that keeps everything in that browser's own
storage. The full flow runs, but the phone and a laptop each have their own copy rather
than one shared record. It exists so a key-only or nothing-at-all deployment never lands
anyone on a broken page.

### Or run it on your own laptop

```bash
npm run setup
npm run dev:https
```

Then browse to `https://<your-laptop-ip>:3000` from your phone on the same Wi-Fi and
accept the certificate warning once. No accounts anywhere.

---

## How your phone and the desktop console talk to each other

They are not separate applications. It is **one Next.js app with one database**: the phone
opens `/`, the desktop opens `/admin`, and both read and write the same rows. When the
phone commits a withdrawal, the desktop table shows it on the next page load. Nothing
needs to be synced.

The only real question is *where that one app runs*. Three options, easiest first.

### 1. Your laptop, phone on the same Wi-Fi — best for a quick demo

```bash
npm run dev:https      # HTTPS on 0.0.0.0, so the phone can reach it
```

Find your laptop's IP (`ipconfig getifaddr en0` on macOS, `hostname -I` on Linux) and open
`https://192.168.x.x:3000` on your phone. Accept the certificate warning once — the cert is
self-signed.

**The camera will not work over plain `http://`.** Browsers only expose `getUserMedia` on
HTTPS or `localhost`, which is exactly why this script exists rather than plain `npm run dev`.
If you skip it, the capture screen falls back to the file picker and tells you why.

Desktop console: `https://localhost:3000/admin` on the laptop. Same database, so a
withdrawal taken on the phone is in the table immediately.

### 2. A tunnel — when you're not on the same network

```bash
npm run dev
npx cloudflared tunnel --url http://localhost:3000    # or: ngrok http 3000
```

You get a public HTTPS URL that works from anywhere, still backed by your laptop's
database. Good for showing someone remotely without deploying.

### 3. Vercel — for a demo link that outlives your laptop

Vercel is serverless, and that changes two things. **This is the part that bites people:**

| Local | On Vercel | Why |
|---|---|---|
| SQLite file on disk | **Postgres** | Each function instance gets its own throwaway filesystem. A SQLite file would reset unpredictably and different requests would see different data. |
| Photos in `.data/uploads` | **Vercel Blob** | Same reason — a photo written during the upload request is gone by the time the review screen asks for it. |

Both are handled for you; you just have to provision them.

```bash
# 1. In the Vercel dashboard, add a Postgres database and a Blob store to the project.
#    That sets DATABASE_URL and BLOB_READ_WRITE_TOKEN automatically.
# 2. Optional: add ANTHROPIC_API_KEY in Project Settings -> Environment Variables, for the
#    more accurate paid read. Photos are read on the phone for free without it.
# 3. Deploy.
vercel

# 4. Seed the deployed database once:
vercel env pull .env.production.local
DATABASE_URL="<the postgres url>" npm run setup
```

`prisma/schema.prisma` pins its provider, so `scripts/set-db-provider.mjs` rewrites it to
`postgresql` at build time whenever `DATABASE_URL` is a Postgres URL. You do not edit
anything by hand.

`vercel.json` raises the `/api/captures` timeout to 120s, because a vision read of a full
page of handwriting takes longer than the 10s default. The free route does not need it —
that reading has already happened on the phone by the time the request is made.

Once deployed, the phone opens `https://your-app.vercel.app` and the desktop opens
`https://your-app.vercel.app/admin`. One URL, one database, both surfaces.

> **Before you demo publicly:** there is no authentication. Every visitor acts as the
> seeded admin and can see and edit everything. Fine for a prototype behind a link you
> control; not fine for anything real. See *Known limits*.

---

## How the reading actually works

There are two readers. **The default one costs nothing and needs no account**, and it is
the one you get unless you deliberately configure the other.

### The free one: the phone reads it

Tesseract's LSTM engine, compiled to WebAssembly, running in a WebWorker in the browser
that took the photo. No key, no server, no per-photo cost — and the photo is not uploaded
to be read, only to be kept as evidence afterwards.

```
photo ──▶ find the paper, crop to it, straighten it, scale UP   ─┐
            ▼                                                    │ all in the browser
          tesseract LSTM ──▶ words + per-word confidence          │ on the phone,
            ▼                                                     │ on the ORIGINAL
          drop the noise the paper produced, keep the lines      ─┘ full-res photo
            ▼
       "check what it read"   the text, editable, before anything is created
            ▼  ── upload: the photo, the text, and a box per line
       parseWrittenList()  quantities out of "3x Masks" / "Masks x 3" / "NS 500ml ... 3"
       matchItem()         alias and fuzzy matching to catalogue SKUs
       applyDeviceReading() the engine's boxes and its doubt, back onto the rows
            ▼
       review screen   nurse confirms or corrects  ◀── nothing has moved yet
            ▼
       commitCapture() one database transaction: write the ledger, recompute stock
```

Three things make a word-level engine usable for this:

**A check step.** The engine reads words, not meaning, so `Masks` comes back as `Maske`
about as often as not. It is shown back as editable text before a capture exists, so one
tap fixes a letter. This is not politeness; it is the difference between a reader that
mostly works and one nobody trusts.

**Aliases absorb the rest.** `Maske` still resolves to `Surgical Mask (Level 2)`, because
matching is fuzzy over the alias list. See *Aliases are what make it work* below — with
this reader they matter more than ever.

**Preparing the photo matters more than the engine does.** Four things, in order of how
much they turned out to be worth: reading the *original* photo rather than the 1600px
upload copy; cropping to the sheet of paper; straightening it (a note shot at 7° comes
back in fragments, and getting the sign of that correction backwards makes it 14°); and
scaling the crop *up* so small writing is tall enough to recognise. Before those, a note
filling a quarter of a phone frame read as nothing at all. After them, all three
quantities come back right.

**Nothing blocks.** A row the engine was unsure of is amber and says so, and the button
tells you how many rows it will record — but it always records them. An unreadable photo
is still kept, and you name the items yourself on the review screen with "+ Add an item".
The engine cannot tell you when it has invented a number (it read a handwritten `??` as an
ordinary `2` at the same confidence as a genuine one), so the defence is showing the
number plainly, next to the photo, twice — never refusing to move on.

The engine files are served from this app (`public/tesseract/`, filled in from
`node_modules` by `scripts/copy-tesseract.mjs` at build time, gitignored). Not from a
third-party CDN: that would make every read depend on someone else's uptime at the worst
possible moment. About 6.8MB on first use, then cached — the WebAssembly by the HTTP
cache, the language model in IndexedDB.

### The paid one: one vision call

Set `ANTHROPIC_API_KEY` and a photo goes to `claude-opus-5` instead. The photo and the item
catalogue go in; validated JSON comes back — transcript, line items, quantities, SKUs,
withdraw/dispose, and a box per line, in one call.

It is markedly better on bad handwriting, because it reads the *page*: it can see that
`NS 500ml` sits in a column of quantities and that `Withdrawn` at the bottom governs
everything above it. That context is exactly what the free reader does not have.

**No model training is required either way.** The vision path is zero-shot; the on-device
path uses a stock English model. The only things you tune are the prompt
(`lib/ocr/prompt.ts`) and the item aliases in the database. There is no dataset to collect
and no fine-tune to maintain.

Key files:

| File | What it does |
|---|---|
| `lib/ocr/device.ts` | **The free reader.** Preprocessing, the engine, the two passes. Browser only. |
| `lib/ocr/device-text.ts` | Noise rules, and putting the engine's boxes and doubt back on the rows. Unit-tested. |
| `lib/ocr/parse-text.ts` | Quantities and item names out of a line of text. No model involved. |
| `lib/ocr/match.ts` | Alias and fuzzy matching, and the review-flagging rules. |
| `lib/ocr/prompt.ts` | The vision instructions and catalogue block. **Tune paid accuracy here first.** |
| `lib/ocr/types.ts` | The Zod schema that constrains the vision reply. Change the shape here. |
| `lib/ocr/claude.ts` | The single vision call. |
| `lib/ocr/mock.ts` | Labelled fixtures, used only when neither reader can run. |
| `lib/inventory.ts` | The ledger. Stock is always derived, never patched. |

### Two rules that keep it honest

**Never guess a number.** When a quantity is genuinely unreadable the model returns `null`
and the row is flagged for a human. A row someone taps once costs a second; a silently
invented number corrupts stock and nobody finds out.

**Stock is derived, not patched.** `StockLevel.quantity` is always
`openingQuantity + Σ deltas` replayed from the ledger. Committing, correcting and voiding
all just change ledger rows and recompute. That is why an admin fixing a miscount from 3
to 5 lands on 125 rather than double-subtracting to 122.

### Aliases are what make it work

`3x Masks` resolves to `Surgical Mask (Level 2)` because `masks` is in that item's alias
list. This matters more than any prompt tuning:

```ts
{ sku: 'SAL-09-500', name: 'Normal Saline 0.9% 500ml',
  aliases: ['saline', 'ns', 'n/s', 'normal saline', 'iv saline', 'sodium chloride'] }
```

Write the sloppy, abbreviated, pluralised forms people actually use — not the tidy
procurement name. Add aliases in `prisma/seed.ts`; view them in `/admin/inventory`.

---

## Checking that it works

```bash
npm test             # 66 unit tests: matching, parsing, noise rules, ledger arithmetic
npm run verify       # end-to-end against a running server: 130 -> 127, corrections, replays
npm run ocr:device   # the FREE on-device reader against the handwriting fixtures
npm run ocr:check    # the paid vision model against the same fixtures
```

`npm run verify` needs a server up (`npm run dev` in another terminal). It uploads a
handwritten note, asserts stock has *not* moved while the capture is a draft, commits it,
asserts masks went 130 → 127, corrects the row to 5 and asserts stock recomputes to 125,
then asserts a replayed submit is refused. Its last step posts what the browser posts on
the free route, and asserts the capture that comes out is a real one: the photo kept, the
engine's boxes on the rows, a half-read line flagged for a human, and stock moving.

`npm run ocr:device` needs nothing at all — no key, no database, no network. It runs the
same engine, the same noise rules, the same parser and the same matcher the phone runs,
and scores them against `fixtures/notes/expected.json`. **This is the check that tells you
whether the free route works.** It currently passes 16 of 17: on `low-confidence.png` it
reads the handwritten `4` as a `Y`, which lands as a quantity of zero and a row flagged for
a human — the right failure, and the one the review gate exists for.

`npm run ocr:check` needs `ANTHROPIC_API_KEY`. It refuses to fall back to the demo
fixtures, because a green run against canned data would tell you nothing.

**Point either of them at your own handwriting before trusting any accuracy number:**

```bash
npm run ocr:device -- ~/Desktop/photo-of-my-note.jpg
ANTHROPIC_API_KEY=sk-... npm run ocr:check -- ~/Desktop/photo-of-my-note.jpg
```

`ocr:device` skips the greyscale and contrast work, which needs a canvas and so only runs
in the browser. On a real photo with a shadow across it the phone therefore does better
than that script, not worse — but the phone is also the only place you can judge the
whole interaction, so take a photo on one.

The bundled fixtures in `fixtures/notes/` are rendered with real handwriting typefaces on
a paper background — deliberately including messy quantity formats, domain abbreviations
(`NS`, `foly cath`) and one unreadable `??`. They are a floor, not a ceiling. Real
ballpoint on creased paper under ward lighting is harder. Regenerate them with
`npm run fixtures`.

---

## Known limits

- **No authentication.** Every visitor is the seeded admin. Replace `lib/session.ts`.
- **Photos are clinical evidence** and, on local disk, are served by a route with no
  access control. Vercel Blob URLs are public-but-unguessable. Neither is good enough for
  patient-adjacent data in production.
- **One storeroom is assumed** for capture (`defaultStoreroom()`); the QR mode reads codes
  but does not yet switch storeroom from one.
- **The free reader is word-level, not page-level.** It reads letters well and meaning not
  at all, so expect a wrong letter per line or two on ordinary handwriting and worse on
  cursive, faint pencil or a creased page photographed at an angle. That is why there is a
  check step before a capture exists and a per-row confirmation after it. It cannot tell
  you when it has invented a number — it read a handwritten `??` as an ordinary `2` at the
  same confidence as a real one — so do not remove either gate.
- **First use costs about 6.8MB.** The engine and language model download once per browser
  and are then cached. Prewarming starts as soon as the capture screen opens, but on a bad
  connection the first read is slow. Later reads need no network at all.
- **Bounding boxes are approximate on the vision path.** They come from the same vision
  pass, so the overlay chips sit near their line rather than exactly on it. The on-device
  reader is the better of the two here: its boxes are real word geometry and land on the
  handwriting.
- **`/demo.html` still needs a key.** The self-contained no-database build calls
  `/api/read`, which is the vision path only; it has not been given the on-device reader.
  It only comes into play if you deploy with no database at all.
- Barcode scanning needs `BarcodeDetector` (Chrome/Android). Elsewhere the QR fallback
  decodes QR codes only.
