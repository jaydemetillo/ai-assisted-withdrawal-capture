# Demo script

Ten minutes, offline, no credentials. Everything below runs on the mock provider, and
every screen that shows a mock reading says so.

```bash
npm install && cp .env.example .env
npm run setup        # database up, migrated, seeded
npm run dev          # http://localhost:3000
```

Sign in as **nurse@demo.local** / `demo1234`.

---

## 1. A clear note → a proposal, not a deduction

1. `/withdrawals/new` — location is already **ED Resus Bay 02**.
2. Under *Demo mode*, leave **Clear note** selected.
3. **Upload photo** — any image will do; the mock ignores its contents.
4. **Submit photo.** Notice the response is instant; the reading happens afterwards.
5. On the processing screen, read the line *"You can leave this screen."* It is true.
6. The review screen opens: **Found 2 likely items** —
   *IV cannula 18G blue × 1* and *Sodium chloride 0.9% flush 10 mL × 2*, both
   **High confidence**.

Open `/inventory` in another tab: **nothing has moved.** The cannula is still at 24, the
flush still at 21. A reading is a proposal.

## 2. An ambiguous note → cannot be confirmed

1. Back to `/withdrawals/new`. Choose **Ambiguous note**. Submit any photo.
2. The review screen shows one line: **Not identified**, *Needs review*, and the message
   *We could not uniquely identify "blue cannula". It could be IV cannula 18G blue,
   IV cannula 22G blue.*
3. **Confirm withdrawal is disabled**, and the reason is written above it.
4. Point out: *"blue cannula"* is an approved alias of the 18G. The system still refuses,
   because the words also describe the 22G. Ambiguity beats an alias.
5. Tap **Send for supply review**.

## 3. The reviewer corrects it

1. Sign out (clear the cookie, or use a private window) and sign in as
   **reviewer@demo.local**.
2. `/supply-review` — the case is at the top: *Could be more than one item*.
3. Open it. The photo, the raw text, what the model said, and which rule fired
   (`rule_3_multiple_matches`) are all there.
4. Under *Possible matches*, tap **IV cannula 22G blue**, quantity **1**, **Save this
   match.** The case resolves; the audit trail now holds both the original proposal and
   the correction.

## 4. Confirmation

Still as the reviewer, on the same case: **Approve and update stock.**

The receipt shows *IV cannula 22G blue* **18 → 17**, recorded against the reviewer's role.

Now go back to the **nurse's** clear-note submission from step 1 (as the nurse, from the
review screen) and tap **Confirm withdrawal**:

- *IV cannula 18G blue* **24 → 23**
- *Sodium chloride 0.9% flush 10 mL* **21 → 19**

Tap Confirm again, or refresh and tap again. Nothing changes — the same receipt comes back.

## 5. The automatic replenishment task

The flush went **21 → 19**, crossing its reorder threshold of 20. The receipt shows
**Replenishment requested**, and `/inventory` now lists the flush under *Low stock* and an
open task under *Replenishment tasks* suggesting 60.

Confirm another clear note. The flush goes 19 → 17 — and **no second task** is raised
while the first is still open.

---

## Two more, if there is time

**The unreadable note.** Choose **Unreadable note** and submit. The line shows *Cannot
identify*, Confirm is disabled, and the case is already in the reviewer's queue with the
photo attached.

**A restricted item.** As the reviewer, open any case and match the line to *Morphine
sulfate 10 mg*. Save. Now sign in as the **nurse** and open that submission's review
screen: Confirm is disabled with *Morphine … Supply review must confirm this one.* The
nurse cannot self-confirm a controlled item, whoever chose it.

## Reading real handwriting

```
EXTRACTION_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-…
```

Restart. The demo-mode panel disappears, the badge goes away, and the photo is actually
read. Everything downstream — the rules, the review screen, the confirm transaction — is
identical. A few cents per photo.
