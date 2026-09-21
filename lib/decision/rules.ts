import type { CatalogueItem, LocationCatalogue } from '@/lib/domain/catalogue';
import { isRestricted, itemById } from '@/lib/domain/catalogue';
import type { ExtractionCandidate, ProviderStatusValue } from '@/lib/domain/extraction';
import { distinctMatchedItems, matchPhrase } from '@/lib/catalogue/match';
import { DEFAULT_DECISION_CONFIG, type DecisionConfig } from '@/lib/decision/config';
import type { VisualRecognition } from '@/lib/vision/similarity';

/**
 * The decision rules.
 *
 * This module is PURE: no database, no network, no clock, no randomness. Give it the
 * same candidate and the same catalogue and it returns the same decision, on a phone, in
 * CI, and in an audit reconstruction two years from now. That is the whole reason the
 * safety story is credible, and it is why nothing in here may be made async "just for
 * one lookup".
 *
 * It is also the only thing allowed to decide whether a line may move stock. A provider
 * returns a status and a confidence; both are INPUTS here. Confidence can only ever
 * demote a candidate — there is deliberately no rule of the form "confidence is high,
 * therefore correct".
 *
 * Specified in docs/safety-and-decision-rules.md §3.
 */

export type DecisionValue =
  | 'eligible'
  | 'needs_review'
  | 'ambiguous'
  | 'unmatched'
  | 'unreadable'
  | 'restricted';

export type DecisionOutcome = {
  decision: DecisionValue;
  /** Stable identifier for the rule that fired. Persisted, so it can be counted later. */
  reasonCode: string;
  /** What the nurse reads. Plain words, no jargon, no confidence percentage. */
  message: string;
  /** What OUR matcher concluded, independently of the provider. Null unless unique. */
  matchedItemId: string | null;
  /** The quantity the rules accept. Null whenever it could not be trusted. */
  quantity: number | null;
  /** Options to offer a human. Never a basis for confirmation. */
  suggestedItemIds: string[];
  /** True when the provider named an item id that is not in this location's catalogue. */
  providerIdRejected: boolean;
};

/** The three plain-language buckets the review screen shows. */
export type ConfidenceLabel = 'High confidence' | 'Needs review' | 'Cannot identify';

export function confidenceLabel(decision: DecisionValue): ConfidenceLabel {
  switch (decision) {
    case 'eligible':
      return 'High confidence';
    case 'unmatched':
    case 'unreadable':
      return 'Cannot identify';
    default:
      return 'Needs review';
  }
}

/** Decisions that can never move stock without a human resolving them first. */
export function isBlocking(decision: DecisionValue): boolean {
  return decision !== 'eligible';
}

const PROVIDER_STATUSES_THAT_ALLOW_ELIGIBLE: ProviderStatusValue[] = ['high_confidence', 'restricted'];

function quantityIsUsable(quantity: number | null, config: DecisionConfig): quantity is number {
  return (
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity > 0 &&
    quantity <= config.maxLineQuantity
  );
}

/**
 * Evaluate one extracted candidate against one location's catalogue.
 *
 * Rules are ordered and the first match wins. The order matters: restricted is checked
 * before ambiguity because "this is a controlled item" governs WHO may act, and that
 * question outranks "which of these two items was it".
 */
export function evaluateCandidate(
  candidate: ExtractionCandidate,
  catalogue: LocationCatalogue,
  config: DecisionConfig = DEFAULT_DECISION_CONFIG,
  visual: VisualRecognition | null = null,
): DecisionOutcome {
  // ── Pre-step: discard any item id the provider invented or remembered from elsewhere.
  // A provider may only propose ids from the location-scoped context it was given.
  const claimedItem = itemById(catalogue, candidate.proposedItemId);
  const providerIdRejected = Boolean(candidate.proposedItemId) && claimedItem === null;

  // ── Pre-step: our own deterministic match, computed without reference to the claim.
  // A visual identification is a DESCRIPTION, not a transcription, so it is matched as
  // prose. See matchAgainstItem().
  const outcome = matchPhrase(candidate.rawText, catalogue, {
    prose: candidate.evidence === 'visible_item',
  });
  const matchedItems = distinctMatchedItems(outcome.matches);
  const suggestedItemIds = outcome.suggestions.map((i) => i.id);

  const base = {
    matchedItemId: matchedItems.length === 1 ? (matchedItems[0] as CatalogueItem).id : null,
    quantity: null as number | null,
    suggestedItemIds,
    providerIdRejected,
  };

  // ── Rule 1 — unreadable.
  if (candidate.status === 'unreadable' || outcome.phrase === '') {
    return {
      ...base,
      matchedItemId: null,
      decision: 'unreadable',
      reasonCode: 'rule_1_unreadable',
      message: 'We could not read this line. A person needs to look at the photo.',
    };
  }

  // ── Pre-step: what the LEARNED index thinks, from photographs people confirmed here.
  //
  // Only consulted for visual evidence. A written line's photograph is a piece of paper;
  // asking "which catalogue item does this note look like?" is a question with no
  // meaningful answer, and letting it contribute would be noise wearing the costume of a
  // second opinion.
  const visualItem =
    candidate.evidence === 'visible_item' ? itemById(catalogue, visual?.itemId) : null;

  // The provider's claim, and the learned index, are only used to widen the match set
  // when our own matcher found nothing — never to narrow it, and never to override an
  // ambiguity we detected.
  //
  // For a visual line the learned index goes FIRST. The provider's item id is a general
  // model's guess about a photograph; a learned match is a photograph somebody at this
  // location already identified and then confirmed a withdrawal against. Local evidence
  // that a human stood behind beats a remote guess.
  const widened =
    candidate.evidence === 'visible_item' ? [visualItem, claimedItem] : [claimedItem, visualItem];
  const fallback = widened.find((item): item is CatalogueItem => Boolean(item)) ?? null;

  const effectiveItems: CatalogueItem[] =
    matchedItems.length > 0 ? matchedItems : fallback ? [fallback] : [];
  const uncorroborated = matchedItems.length === 0 && claimedItem !== null && visualItem === null;

  // ── Rule 2 — restricted. Fires when EVERY plausible match is controlled or
  // high-risk, so there is no reading of this line that a nurse could confirm alone.
  //
  // When only some matches are restricted, the line is genuinely ambiguous instead
  // (rule 3) and a human picks. That loses no safety: the restriction is checked AGAIN
  // on whatever item they choose, at confirmation, in evaluateSubmission. Escalating
  // the whole line would mean a nurse writing "syringes" goes to supply review because
  // the cart happens to stock an adrenaline prefilled syringe — friction with nothing
  // bought for it.
  const restrictedItems = effectiveItems.filter(isRestricted);
  if (restrictedItems.length > 0 && restrictedItems.length === effectiveItems.length) {
    const only = effectiveItems.length === 1 ? (effectiveItems[0] as CatalogueItem) : null;
    return {
      ...base,
      // The id is preserved when the evidence points at exactly one item, so a reviewer
      // starts from something concrete — but the decision still blocks confirmation.
      matchedItemId: only ? only.id : null,
      quantity: quantityIsUsable(candidate.proposedQuantity, config) ? candidate.proposedQuantity : null,
      suggestedItemIds: only ? suggestedItemIds : effectiveItems.map((i) => i.id),
      decision: 'restricted',
      reasonCode: 'rule_2_restricted_item',
      message: only
        ? `${only.displayName} is a controlled or high-risk item. Supply review must verify this before stock changes.`
        : 'This may be a controlled or high-risk item. Supply review must verify it before stock changes.',
    };
  }

  // ── Rule 3 — ambiguous. More than one catalogue item matches the words written.
  // An exact alias hit does NOT rescue this: an alias only makes a line confirmable
  // when it is the sole match. See docs/safety-and-decision-rules.md §3.
  if (effectiveItems.length > 1) {
    // The learned index does not get to RESOLVE an ambiguity — a human still picks — but
    // it is allowed to decide which button is first. Putting the item this photograph
    // most resembles at the front of the row turns a two-second read into a one-tap
    // answer, and costs nothing if it is wrong, because both buttons are still there.
    const ordered =
      visualItem && effectiveItems.some((i) => i.id === visualItem.id)
        ? [visualItem, ...effectiveItems.filter((i) => i.id !== visualItem.id)]
        : effectiveItems;

    return {
      ...base,
      matchedItemId: null,
      suggestedItemIds: ordered.map((i) => i.id),
      decision: 'ambiguous',
      reasonCode: 'rule_3_multiple_matches',
      // Names are not listed here: they are rendered as tappable buttons from
      // suggestedItemIds, and repeating them in prose makes the card longer without
      // making the choice any faster.
      message:
        ordered !== effectiveItems
          ? `"${outcome.phrase}" could be ${effectiveItems.length} different items stocked here. The photo looks most like the first one — tap the one you took.`
          : `"${outcome.phrase}" could be ${effectiveItems.length} different items stocked here. Tap the one you took.`,
    };
  }

  // ── Rule 4 — unmatched. Nothing in this location's catalogue matches the words.
  if (effectiveItems.length === 0) {
    return {
      ...base,
      matchedItemId: null,
      decision: 'unmatched',
      reasonCode: 'rule_4_no_match',
      message:
        suggestedItemIds.length > 0
          ? `"${outcome.phrase}" is not a catalogue name. Tap the closest match, or choose the item yourself.`
          : `"${outcome.phrase}" does not match anything stocked at ${catalogue.locationName}. Choose the item, or drop this line.`,
    };
  }

  const item = effectiveItems[0] as CatalogueItem;

  // ── Rule 5 — matched, but not stocked or no longer active here. Belt and braces: the
  // catalogue is already location-scoped, so this only fires on an inactive item or a
  // catalogue assembled by hand.
  if (!item.isActive) {
    return {
      ...base,
      matchedItemId: null,
      decision: 'unmatched',
      reasonCode: 'rule_5_not_stocked_here',
      message: `${item.displayName} is not stocked at ${catalogue.locationName}.`,
    };
  }

  // ── Rule 8b — identified by sight rather than by words.
  //
  // A written line is a person's own record of what they took, and our matcher checks it
  // against the catalogue independently. A visual identification has neither: it is one
  // opinion about a photograph, with nothing to corroborate it. Counting is worse still —
  // "how many syringes are in this pile" is exactly the kind of question a model answers
  // confidently and wrongly.
  //
  // So a visual line can never be `eligible`. It is a good suggestion that a human
  // confirms, which is the whole point of the product rather than a limitation of it.
  //
  // **This is where the learning lands, and where it stops.** Every branch below returns
  // `needs_review`. The learned index changes which item is proposed, which alternatives
  // are offered, and what the card says — never whether a human has to look. An index
  // with ten thousand examples has exactly the same authority as an empty one.
  //
  // It sits ahead of the quantity and confidence rules because it handles both itself: a
  // visual line whose count could not be read is still a visual line, and telling the
  // nurse "the number could not be read" while silently dropping "and this was
  // recognised by sight, not read" would be the less useful half of the truth.
  if (candidate.evidence === 'visible_item') {
    return {
      ...base,
      ...describeVisualLine({ item, visual, visualItem, catalogue, candidate, config }),
      decision: 'needs_review',
    };
  }

  // ── Rule 6 — the quantity could not be trusted.
  if (!quantityIsUsable(candidate.proposedQuantity, config)) {
    const tooMany =
      typeof candidate.proposedQuantity === 'number' && candidate.proposedQuantity > config.maxLineQuantity;
    return {
      ...base,
      matchedItemId: item.id,
      decision: 'needs_review',
      reasonCode: tooMany ? 'rule_6_quantity_above_limit' : 'rule_6_quantity_unclear',
      message: tooMany
        ? `${item.displayName}: ${candidate.proposedQuantity} is more than a single withdrawal usually is. Please check the number.`
        : `${item.displayName}: how many were taken? The number could not be read.`,
    };
  }

  const quantity = candidate.proposedQuantity;

  // ── Rule 7 — confidence below the configured threshold. A demotion only; there is no
  // rule anywhere that promotes a candidate because confidence was high.
  if (candidate.confidence < config.confidenceThreshold) {
    return {
      ...base,
      matchedItemId: item.id,
      quantity,
      decision: 'needs_review',
      reasonCode: 'rule_7_low_confidence',
      message: `${item.displayName}: the reading was not clear enough to accept without a check.`,
    };
  }

  // ── Rule 8 — the provider itself flagged doubt, or named an item we could not
  // corroborate. Either way a human decides.
  if (!PROVIDER_STATUSES_THAT_ALLOW_ELIGIBLE.includes(candidate.status)) {
    return {
      ...base,
      matchedItemId: item.id,
      quantity,
      decision: 'needs_review',
      reasonCode: 'rule_8_provider_flagged_doubt',
      message: `${item.displayName}: the reading was marked uncertain. Please confirm it is right.`,
    };
  }

  if (providerIdRejected || uncorroborated) {
    return {
      ...base,
      matchedItemId: item.id,
      quantity,
      decision: 'needs_review',
      reasonCode: providerIdRejected ? 'rule_8_provider_id_rejected' : 'rule_8_uncorroborated_match',
      message: `${item.displayName}: we could not verify this against the written text. Please confirm it is right.`,
    };
  }

  // ── Rule 9 — exact SKU, sole approved alias, or a single unambiguous match, with a
  // usable quantity and nothing flagged. This is the only path to `eligible`.
  return {
    ...base,
    matchedItemId: item.id,
    quantity,
    decision: 'eligible',
    reasonCode: 'rule_9_unique_match',
    message: `${item.displayName} × ${quantity}`,
  };
}

/**
 * What a visually identified line says, and which alternatives it offers.
 *
 * Split out because there are four genuinely different situations and inlining them made
 * rule 8b a wall of nested conditionals. The decision is the caller's and is always
 * `needs_review`; this only shapes the words and the buttons.
 *
 * The wording rules are deliberate and worth keeping:
 *
 *  - **"Seen N times here" is stated as a fact, never as a reason to trust it.** It is a
 *    familiarity count — how often this location has confirmed a line that matched these
 *    photos — and a high number means the item is common, not that this match is right.
 *    Every message that carries one also carries the instruction to check.
 *  - **No percentage ever reaches a nurse.** A score of 0.86 invites a judgement nobody
 *    has the information to make; "recognised from photos taken here before" does not.
 *  - **Look-alikes are named.** When the index cannot separate two items, saying so is
 *    the honest answer and a permanent one. It is the ceiling of this approach, and a
 *    ceiling described as a known boundary is information; the same ceiling hidden behind
 *    a confident guess is a wrong deduction waiting for a busy shift.
 */
function describeVisualLine(input: {
  item: CatalogueItem;
  visual: VisualRecognition | null;
  visualItem: CatalogueItem | null;
  catalogue: LocationCatalogue;
  candidate: ExtractionCandidate;
  config: DecisionConfig;
}): Pick<DecisionOutcome, 'matchedItemId' | 'quantity' | 'suggestedItemIds' | 'reasonCode' | 'message'> {
  const { item, visual, visualItem, catalogue, candidate, config } = input;

  const usable = quantityIsUsable(candidate.proposedQuantity, config);
  const quantity = usable ? candidate.proposedQuantity : null;
  // Counting items in a pile is the weakest thing a vision model does, so the count is
  // called out on every visual line rather than only when it failed to parse.
  const countNote = usable ? 'Check the item and the count.' : 'How many were taken? The number could not be read.';

  const named = (id: string): string => itemById(catalogue, id)?.displayName ?? 'another item';

  // ── The index recognises it, but cannot tell it from something else stocked here.
  // Permanent, not a stage on the way to getting better: two items that look identical
  // in a photograph will look identical in the next thousand photographs.
  const confusable = (visual?.confusableWith ?? []).filter((id) => itemById(catalogue, id) !== null);
  if (visualItem && confusable.length > 0) {
    return {
      matchedItemId: visualItem.id,
      quantity,
      suggestedItemIds: [visualItem.id, ...confusable],
      reasonCode: 'rule_8_visual_confusable',
      message: `This looks like ${visualItem.displayName}, but ${confusable.map(named).join(' and ')} look the same in a photo. Check the label and pick one. ${countNote}`,
    };
  }

  // ── The description and the learned photos point at different items. Two independent
  // opinions that disagree is exactly the case a human should see, stated plainly rather
  // than resolved by whichever one we happened to check first.
  if (visualItem && visualItem.id !== item.id) {
    return {
      matchedItemId: null,
      quantity,
      suggestedItemIds: [visualItem.id, item.id],
      reasonCode: 'rule_8_visual_disagreement',
      message: `The description reads like ${item.displayName}, but photos taken here look more like ${visualItem.displayName}. Pick the right one. ${countNote}`,
    };
  }

  // ── Both agree, or the description alone found it and the index has seen it too.
  if (visualItem) {
    const seen =
      visual && visual.timesAgreed > 0
        ? ` Seen ${visual.timesAgreed} ${visual.timesAgreed === 1 ? 'time' : 'times'} here before — you still need to confirm it.`
        : '';
    return {
      matchedItemId: visualItem.id,
      quantity,
      suggestedItemIds: [],
      reasonCode: 'rule_8_visual_recognised',
      message: `${visualItem.displayName} — matched against photos taken here, not read from writing. ${countNote}${seen}`,
    };
  }

  // ── Nothing learned. The original rule 8b: a general model's opinion about a
  // photograph, offered as a suggestion and nothing more.
  return {
    matchedItemId: item.id,
    quantity,
    suggestedItemIds: [],
    reasonCode: 'rule_8_visual_identification',
    message: `${item.displayName} — recognised from the photo, not read from writing. ${countNote}`,
  };
}
