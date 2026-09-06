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

**No API key needed to click through everything.** With `ANTHROPIC_API_KEY` unset the app
uses bundled sample readings and labels them "Demo reading" wherever they appear, so a
fixture is never mistaken for a real read. Set the key to read actual handwriting.

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

No API key is needed. Without one it reads a built-in sample note instead of your photo
and says "Demo reading" on screen; everything else - the review gate, the amber flagging,
the stock arithmetic, the admin corrections - is the real code. Add `ANTHROPIC_API_KEY` in
Project Settings later to have it read your actual handwriting (a few cents per photo).

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
# 2. Add ANTHROPIC_API_KEY in Project Settings -> Environment Variables.
# 3. Deploy.
vercel

# 4. Seed the deployed database once:
vercel env pull .env.production.local
DATABASE_URL="<the postgres url>" npm run setup
```

`prisma/schema.prisma` pins its provider, so `scripts/set-db-provider.mjs` rewrites it to
`postgresql` at build time whenever `DATABASE_URL` is a Postgres URL. You do not edit
anything by hand.

`vercel.json` raises the `/api/captures` timeout to 120s, because reading a full page of
handwriting takes longer than the 10s default.

Once deployed, the phone opens `https://your-app.vercel.app` and the desktop opens
`https://your-app.vercel.app/admin`. One URL, one database, both surfaces.

> **Before you demo publicly:** there is no authentication. Every visitor acts as the
> seeded admin and can see and edit everything. Fine for a prototype behind a link you
> control; not fine for anything real. See *Known limits*.

---

## How the reading actually works

One call to `claude-opus-5` does the whole job. The photo and the item catalogue go in;
validated JSON comes back.

```
photo ──▶ claude-opus-5 (vision)
            transcribe → find line items → parse quantities
            → match to catalogue SKUs → infer withdraw/dispose
            → return a box around each line
          ▼
       resolveLines()  fuzzy-match anything the model left unmatched,
                       flag anything low-confidence for a human
          ▼
       review screen   nurse confirms or corrects  ◀── nothing has moved yet
          ▼
       commitCapture() one database transaction: write the ledger, recompute stock
```

There is no separate OCR step. Splitting transcription from parsing throws away the
context that makes the parse good — the model can see that `NS 500ml` sits in a column of
quantities and that `Withdrawn` at the bottom governs the whole page.

**No model training is required.** This is zero-shot: the model reads handwriting out of
the box, and the only thing you tune is the prompt (`lib/ocr/prompt.ts`) and the item
aliases in the database. There is no dataset to collect and no fine-tune to maintain.

Key files:

| File | What it does |
|---|---|
| `lib/ocr/prompt.ts` | The instructions and the catalogue block. **Tune accuracy here first.** |
| `lib/ocr/types.ts` | The Zod schema that constrains the reply. Change the shape here. |
| `lib/ocr/claude.ts` | The single vision call. |
| `lib/ocr/match.ts` | Fuzzy fallback matching and the review-flagging rules. |
| `lib/ocr/mock.ts` | Offline fixtures used when no API key is set. |
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
npm test         # 25 unit tests: matching, review-flagging, ledger arithmetic
npm run verify   # end-to-end against a running server: 130 -> 127, corrections, replays
npm run ocr:check    # the real vision model against the handwriting fixtures
```

`npm run verify` needs a server up (`npm run dev` in another terminal). It uploads a
handwritten note, asserts stock has *not* moved while the capture is a draft, commits it,
asserts masks went 130 → 127, corrects the row to 5 and asserts stock recomputes to 125,
then asserts a replayed submit is refused.

`npm run ocr:check` needs `ANTHROPIC_API_KEY`. It refuses to fall back to the demo
fixtures, because a green run against canned data would tell you nothing.

**Point it at your own handwriting before trusting any accuracy number:**

```bash
ANTHROPIC_API_KEY=sk-... npm run ocr:check -- ~/Desktop/photo-of-my-note.jpg
```

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
- **Bounding boxes are approximate.** They come from the same vision pass, so the overlay
  chips sit near their line rather than exactly on it. If you need pixel-tight boxes, a
  dedicated OCR service with word-level geometry would do better — at the cost of a second
  provider and a separate parsing step.
- Barcode scanning needs `BarcodeDetector` (Chrome/Android). Elsewhere the QR fallback
  decodes QR codes only.
