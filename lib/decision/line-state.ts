import type { Disposition } from '@prisma/client';

/**
 * What a review card should offer, decided from the line's state rather than from which
 * rule produced it.
 *
 * The bug this replaces: the "It's not on the list" action was shown for `unmatched` and
 * `unreadable` only. But one photograph produces a MIX — a prescription came back as some
 * unmatched, some needs_review, some ambiguous — and all of them render as "Not
 * identified" to the person reading the screen. So the button appeared on one card out of
 * four, for no reason anybody looking at it could see.
 *
 * The question a person is actually asking is "have you got an item for this line or
 * not?". Key the UI on that.
 */
export type LineState = {
  disposition: Disposition;
  matchedItemId: string | null;
  resolvedItemId: string | null;
};

/** The item this line will use: a human's choice first, otherwise our own match. */
export function chosenItemId(line: LineState): string | null {
  return line.resolvedItemId ?? line.matchedItemId ?? null;
}

/**
 * Offer "it's not on the list" whenever the line is still live and has no item.
 *
 * Deliberately independent of the decision code. A line the rules called `ambiguous` and
 * a line they called `unmatched` are the same problem to the person holding the phone:
 * nothing is selected, and they need a way forward that is not "delete the evidence".
 */
export function offerNotOnList(line: LineState): boolean {
  if (line.disposition === 'rejected') return false;
  return chosenItemId(line) === null;
}
