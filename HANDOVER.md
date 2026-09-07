# Handover — start here in a new session

Paste the block below as your first message in a fresh Claude Code session. It is written
to stand alone: a new session has none of the previous conversation.

---

> I'm continuing work on **jaydemetillo/write-down-and-scan-it**, branch `main`
> (also pushed to `claude/receipt-scanning-inventory-7sy02b` — keep both in sync).
>
> **What it is:** a prototype where a nurse photographs a handwritten stock list —
> *"3x Masks, 4x Syringes, 5x Saline — Withdrawn"* — and it becomes a stock movement.
> Masks go 130 → 127. Built from the Pulse Master V2 Figma. Read `README.md` first.
>
> **State:** deployed on Vercel with a free Neon Postgres. Production branch is `main`.
> There is **no `ANTHROPIC_API_KEY`**, deliberately — I don't want to pay. It doesn't need
> one: **photographing a note really reads it**, on the phone, with Tesseract's LSTM engine
> in WebAssembly (`lib/ocr/device.ts`, assets served from `public/tesseract/`). Free,
> offline, nothing uploaded to be read. Typing the list is still there as a fallback.
>
> **Full build guide (read this):** https://app.notion.com/p/3d377dbba788818cb3b3e2369a338e19
>
> **Do not undo these — each was a real bug found on a real phone:**
> - Bounding boxes map to the *rendered photo*, not the container (object-contain letterboxes it).
> - Overlay labels sit beside their line and are spaced in pixels, never stacked above.
> - The app shell is `fixed` on phones AND every scrolling pane has `min-height: 0`. Both, or one breaks the other.
> - Safe-area insets on everything bottom-anchored, with `viewport-fit=cover`.
> - Photos are re-encoded to JPEG in the browser (iPhones send HEIC).
> - Demo/sample rows must never be drawn over a real photo or look like a real reading.
> - Stock is derived from an append-only ledger, never patched in place.
> - The photo areas are square — a note is written *down* a page, and a letterbox frame cut the bottom items out of shot.
> - **The two gates on the free reader stay.** The engine reads words, not meaning: the
>   text is shown back editable before a capture exists, and a row the engine doubted needs
>   an explicit "Looks right" tap before it can be submitted. No confidence number can
>   catch an invented quantity — it read a handwritten `??` as an ordinary `2`.
> - The reader's WebAssembly and language model are served from this app, never a CDN, so a
>   read never depends on a third party. `scripts/copy-tesseract.mjs` puts them there at
>   build time; `public/tesseract/` is gitignored build output.
>
> **Before claiming anything works:** `npm test` (66 tests), `npm run ocr:device` (the free
> reader against the fixtures, 16/17 — no key needed), then `npm run verify` against a
> running server. Headless browsers cannot reproduce the phone bugs — say so rather than
> implying a screenshot proved it.
>
> Here's what I want to do next: **<describe your task>**

---

## Quick reference

| | |
|---|---|
| Repo | `jaydemetillo/write-down-and-scan-it` |
| Branches | `main` and `claude/receipt-scanning-inventory-7sy02b`, kept identical |
| Build guide | [Notion](https://app.notion.com/p/3d377dbba788818cb3b3e2369a338e19) |
| Clickable demo | [Artifact](https://claude.ai/code/artifact/f5c9f6c0-a8cc-4b13-8f3c-292c2a0e66d6) (needs a claude.ai login) |
| Phone | your Vercel URL |
| Desktop console | same URL + `/admin` |
| Free capture route | Scan → photograph the note. It is read on the phone. |
| Free fallback | Scan → "Type or paste it instead" |

## Commands

```bash
npm run setup      # create and seed a local database, and copy the reader into public/
npm run dev:https  # run locally over HTTPS (the camera needs it)
npm test           # 66 unit tests
npm run verify     # end-to-end against a running server, free route included
npm run ocr:device # free on-device reading accuracy — no key, no database, no network
npm run ocr:check  # paid vision accuracy — needs an API key
```
