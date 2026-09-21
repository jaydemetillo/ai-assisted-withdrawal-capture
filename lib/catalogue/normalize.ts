/**
 * Text normalisation for catalogue matching.
 *
 * Deliberately dull: lowercase, strip punctuation, collapse whitespace. No stemming, no
 * synonym expansion, no spelling correction — every one of those would make matching
 * cleverer and less predictable, and predictability is the point. A phrase either
 * matches the catalogue the same way every time, or a human looks at it.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/**
 * Fold an English plural to its singular.
 *
 * Nurses write "4x syringes"; the catalogue says "Syringe 10 mL luer lock". Without this
 * the line matches nothing and arrives as "Cannot identify", which is both wrong and
 * infuriating. This is inflection, not fuzziness — "syringes" and "syringe" are the same
 * word, and folding them is as deterministic as lowercasing.
 *
 * Deliberately conservative. Short tokens are left alone because the catalogue's own
 * shorthand lives there ("ns", "gas"), and a three-letter word losing its last letter
 * would do real damage.
 */
export function singular(token: string): string {
  if (token.length <= 3) return token;
  if (/[a-z]ies$/.test(token)) return `${token.slice(0, -3)}y`; // supplies → supply
  if (/(s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2); // boxes → box, flushes → flush
  if (/[^s]s$/.test(token)) return token.slice(0, -1); // syringes → syringe, masks → mask
  return token;
}

/**
 * Tokens of a CATALOGUE string, with plurals folded. Kept separate from `tokens()`
 * because the text shown back to a person must be what they wrote, not a stemmed
 * version of it.
 */
export function matchTokens(text: string): string[] {
  return tokens(text).map(singular);
}

/**
 * Tokens of a WRITTEN phrase, with plurals folded and standalone numbers dropped.
 *
 * A bare number in a note is a count — "3 masks", "masks 3", "masks - 3" — and the
 * count already arrives separately as `proposedQuantity`. Leaving it in the token set
 * meant every one of those natural spellings matched nothing at all, because no
 * catalogue entry contains the word "3".
 *
 * Numbers glued to a unit or a size survive, because there they identify the item
 * rather than count it: "18g", "10ml", "5x5", "500ml".
 */
export function phraseTokens(text: string): string[] {
  return matchTokens(text).filter((token) => !/^\d+$/.test(token));
}

/**
 * Remove the quantity from a written line so only the item description is matched.
 *
 * "18G blue cannula x1" -> "18g blue cannula"
 * "2 x saline flush"    -> "saline flush"
 * "saline flush 2"      -> "saline flush"
 *
 * A bare leading or trailing integer is only dropped when at least two tokens survive,
 * so "18G" keeps its gauge and a line that is nothing but a number stays unreadable
 * rather than becoming an empty match.
 */
export function itemPhrase(rawText: string): string {
  let t = normalize(rawText);
  if (!t) return '';

  // Explicit multiplier forms, anywhere in the line.
  t = t.replace(/\bx\s*\d+\b/g, ' ');
  t = t.replace(/\b\d+\s*x\b/g, ' ');
  t = t.replace(/\bqty\s*\d+\b/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  // A bare integer at either end, only when the rest still says something.
  const parts = t.split(' ').filter(Boolean);
  if (parts.length >= 3 && /^\d+$/.test(parts[0] ?? '')) parts.shift();
  if (parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1] ?? '')) parts.pop();

  return parts.join(' ');
}

/** Sørensen-Dice similarity over character bigrams. Used for SUGGESTIONS ONLY. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const bigrams = (s: string): string[] => {
    const padded = ` ${s} `;
    const out: string[] = [];
    for (let i = 0; i < padded.length - 1; i++) out.push(padded.slice(i, i + 2));
    return out;
  };

  const bx = bigrams(x);
  const by = bigrams(y);
  const pool = new Map<string, number>();
  for (const g of bx) pool.set(g, (pool.get(g) ?? 0) + 1);

  let hits = 0;
  for (const g of by) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hits++;
      pool.set(g, n - 1);
    }
  }
  return (2 * hits) / (bx.length + by.length);
}
