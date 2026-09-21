/**
 * Where a line is in the photograph, and how to draw that without it looking broken.
 *
 * Two separate jobs live here, both pure, because both are where box overlays usually go
 * wrong and neither needs the DOM to be tested.
 *
 * ## 1. The coordinate frame, stated once
 *
 * A box is FOUR FRACTIONS OF THE PREPARED IMAGE, never pixels. That matters more than it
 * sounds. `lib/extraction/image.ts` hands the model a photo that has been EXIF-rotated,
 * resized to a 1568px long edge and contrast-normalised; the browser displays the
 * ORIGINAL bytes. Pixel coordinates from the model are therefore in a frame that exists
 * nowhere on screen, and on a photo an iPhone stored as "rotate 90°" they are not even on
 * the same axis — which is exactly how an overlay ends up drawn beside the item instead
 * of around it.
 *
 * Fractions survive all of that. The resize preserves aspect ratio (`fit: 'inside'`), and
 * a browser applies EXIF orientation to an `<img>` by default, which is the same rotation
 * sharp applied — so 0..1 in the prepared frame is 0..1 in the rendered frame.
 *
 * The one thing that breaks the correspondence is displaying the photo cropped. An
 * `object-cover` square throws away up to 40% of a portrait photo, and every box drawn
 * over it is displaced and the wrong shape. The overlay must be measured against the
 * RENDERED IMAGE RECTANGLE, which is what `layoutBoxes` takes.
 *
 * ## 2. Boxes as drawn are not boxes as reported
 *
 * A faithful rendering of what a model returns looks awful: 9px slivers round a gauge
 * marking, two outlines fused into one blob where two items touch, labels stacked on top
 * of each other. So the reported box stays the record, and a separate layout pass decides
 * what is drawn — a minimum size grown about the CENTRE (so the box stays on the item
 * rather than sliding off it), padding that yields when a neighbour is close, and labels
 * placed in the first slot that is free.
 *
 * Nothing in this file changes what anybody is allowed to confirm. A box makes a
 * suggestion easier to check and makes per-item learning possible; a visual line is still
 * `needs_review`, every time, by rule 8b.
 */

/** A box as reported: fractions of the prepared image, x/y at the top-left corner. */
export type NormalisedBox = { x: number; y: number; width: number; height: number };

/** A rectangle in rendered CSS pixels, relative to the top-left of the displayed image. */
export type Rect = { left: number; top: number; width: number; height: number };

export type Frame = { width: number; height: number };

/**
 * What a box has to clear to be drawn at all.
 *
 * A rejected box is NOT a smaller box — it is no box, and the line falls back to reading
 * its description. Drawing a wrong rectangle is worse than drawing none, because a
 * rectangle is an assertion about where to look.
 */
export const BOX_LIMITS = {
  /** Under this share of the frame there is nothing a person could verify. */
  minArea: 0.0004,
  /** Neither edge may be thinner than this: a 1px sliver is a line, not a box. */
  minEdge: 0.012,
  /**
   * A box round essentially the whole photo is the model saying "it's in here
   * somewhere". True, useless, and it makes every other box look wrong by comparison.
   */
  maxCoverage: 0.9,
} as const;

/** Where a label sits relative to its box. Tried in this order. */
export type LabelPlacement = 'above' | 'below' | 'inside-top' | 'inside-bottom';

const FIRST_PLACEMENT: LabelPlacement = 'above';
const PLACEMENTS: readonly LabelPlacement[] = [FIRST_PLACEMENT, 'below', 'inside-top', 'inside-bottom'];

export type LayoutOptions = {
  /**
   * The smallest a drawn box may be, in CSS pixels. 44 is the tap target used elsewhere
   * in this app: a box you cannot reliably tap is a box that cannot link to its card.
   */
  minSize: number;
  /** Breathing room added round each box, given up when a neighbour is close. */
  pad: number;
  /** The label chip, so placement can be solved before React renders anything. */
  label: { width: number; height: number; gap: number };
};

export const DEFAULT_LAYOUT: LayoutOptions = {
  minSize: 44,
  pad: 6,
  label: { width: 28, height: 28, gap: 6 },
};

export type PlacedBox = {
  id: string;
  /** 1-based, matching the number shown on the line's card. */
  number: number;
  rect: Rect;
  label: Rect;
  placement: LabelPlacement;
  /** True when the drawn box had to be grown to stay usable — it is bigger than reported. */
  grown: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Turn whatever a provider returned into a box we are willing to draw, or null.
 *
 * Defensive on purpose: this is a trust boundary in the same sense the extraction schema
 * is. Models emit inverted corners, negative widths, values above 1 (percentages that
 * forgot to divide), and NaN. Each of those has been seen in the wild, and each of them
 * renders as a visibly broken overlay rather than as an error anybody would notice.
 */
export function normaliseBox(raw: unknown): NormalisedBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  // Accept either {x, y, width, height} or {x1, y1, x2, y2} — providers use both, and
  // guessing wrong about which one is another way to draw a rectangle in the wrong place.
  let left: number;
  let top: number;
  let right: number;
  let bottom: number;

  if (isFiniteNumber(value.x) && isFiniteNumber(value.y)) {
    if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
    left = value.x;
    top = value.y;
    right = value.x + value.width;
    bottom = value.y + value.height;
  } else if (
    isFiniteNumber(value.x1) &&
    isFiniteNumber(value.y1) &&
    isFiniteNumber(value.x2) &&
    isFiniteNumber(value.y2)
  ) {
    left = value.x1;
    top = value.y1;
    right = value.x2;
    bottom = value.y2;
  } else {
    return null;
  }

  // A negative width, or corners given in the other order, is a box described backwards
  // rather than an invalid one.
  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];

  left = clamp01(left);
  top = clamp01(top);
  right = clamp01(right);
  bottom = clamp01(bottom);

  const width = right - left;
  const height = bottom - top;

  if (width < BOX_LIMITS.minEdge || height < BOX_LIMITS.minEdge) return null;
  if (width * height < BOX_LIMITS.minArea) return null;
  if (width * height > BOX_LIMITS.maxCoverage) return null;

  return { x: left, y: top, width, height };
}

/** The share of the frame a box covers, 0..1. */
export function boxArea(box: NormalisedBox): number {
  return box.width * box.height;
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/**
 * How far apart two non-overlapping rectangles are, in the sense that matters for
 * padding: the amount each may grow before they touch.
 *
 * Rectangles separated on both axes (diagonally) do not collide until BOTH gaps close,
 * so the binding constraint is the larger gap, not the smaller one.
 */
function separation(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.left - (b.left + b.width), b.left - (a.left + a.width));
  const dy = Math.max(0, a.top - (b.top + b.height), b.top - (a.top + a.height));
  return Math.max(dx, dy);
}

/**
 * Padding that gives way to its neighbours.
 *
 * Uniform padding is what fuses two adjacent boxes into one shape — the thing that makes
 * a tray photo unreadable. Two items 8px apart get 3px of padding each and keep a visible
 * channel between them; an item alone in the frame gets the full amount.
 *
 * Boxes that ALREADY overlap are left alone: they are genuinely overlapping objects, and
 * shrinking their padding does not make that any clearer.
 */
function padAgainst(rect: Rect, others: Rect[], maxPad: number): number {
  let pad = maxPad;
  for (const other of others) {
    if (other === rect) continue;
    if (intersects(rect, other)) continue;
    const gap = separation(rect, other);
    // Leave a 2px channel so the two outlines never share an edge.
    pad = Math.min(pad, Math.max(0, (gap - 2) / 2));
  }
  return pad;
}

function inflate(rect: Rect, by: number, frame: Frame): Rect {
  const left = Math.max(0, rect.left - by);
  const top = Math.max(0, rect.top - by);
  const right = Math.min(frame.width, rect.left + rect.width + by);
  const bottom = Math.min(frame.height, rect.top + rect.height + by);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Grow a rectangle to a minimum size WITHOUT moving it off its subject.
 *
 * Growing from the top-left — the obvious implementation — walks the box down and right
 * off the thing it is meant to be around. Growing about the centre keeps the subject in
 * the middle, and when that pushes past an edge the box is slid back inside rather than
 * squashed, so it keeps its size. Only a frame genuinely smaller than the minimum
 * produces a smaller box.
 */
function atLeast(rect: Rect, minSize: number, frame: Frame): Rect {
  const width = Math.min(frame.width, Math.max(rect.width, minSize));
  const height = Math.min(frame.height, Math.max(rect.height, minSize));
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  const left = Math.min(frame.width - width, Math.max(0, centreX - width / 2));
  const top = Math.min(frame.height - height, Math.max(0, centreY - height / 2));
  return { left, top, width, height };
}

function labelRect(rect: Rect, placement: LabelPlacement, frame: Frame, options: LayoutOptions): Rect {
  const { width, height, gap } = options.label;
  let top: number;
  switch (placement) {
    case 'above':
      top = rect.top - height - gap;
      break;
    case 'below':
      top = rect.top + rect.height + gap;
      break;
    case 'inside-top':
      top = rect.top + gap;
      break;
    case 'inside-bottom':
      top = rect.top + rect.height - height - gap;
      break;
  }
  // Kept inside the frame horizontally in every case: a chip half off the left edge reads
  // as a rendering bug even when the box it belongs to is perfect.
  const left = Math.min(frame.width - width, Math.max(0, rect.left));
  return { left, top, width, height };
}

function insideFrame(rect: Rect, frame: Frame): boolean {
  return (
    rect.left >= 0 &&
    rect.top >= 0 &&
    rect.left + rect.width <= frame.width &&
    rect.top + rect.height <= frame.height
  );
}

function overlapArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

/**
 * Place a label in the first slot that is free, falling back to the least bad one.
 *
 * Labels collide; boxes are allowed to. Two items touching on a tray genuinely produce
 * two overlapping rectangles, and moving one of them to make the picture tidier would be
 * a lie about where the item is. Their LABELS carry no positional meaning, so those are
 * free to move — which is why solving collisions here rather than by nudging boxes keeps
 * the overlay both readable and truthful.
 *
 * Three things are avoided, in descending order of how bad they look:
 *
 *  1. **Off the photo.** A chip hanging over the letterbox bar reads as a rendering bug
 *     even when the box it belongs to is perfect.
 *  2. **On another chip.** Two numbers on top of each other are simply unreadable.
 *  3. **Over somebody else's box.** The obvious "always above" placement puts each chip
 *     squarely inside the box above it, covering the very thing that box is pointing at —
 *     on a handwritten note that means the number sits on the words. Its OWN box does not
 *     count: a chip inside its own box is a caption, not an obstruction.
 */
function placeLabel(
  rect: Rect,
  frame: Frame,
  taken: Rect[],
  others: Rect[],
  options: LayoutOptions,
): { label: Rect; placement: LabelPlacement } {
  let best = {
    label: labelRect(rect, FIRST_PLACEMENT, frame, options),
    placement: FIRST_PLACEMENT,
    cost: Infinity,
  };

  for (const placement of PLACEMENTS) {
    const label = labelRect(rect, placement, frame, options);
    const offFrame = insideFrame(label, frame) ? 0 : 1;
    const onChip = taken.reduce((total, other) => total + overlapArea(label, other), 0);
    const onBox = others.reduce((total, other) => total + overlapArea(label, other), 0);
    if (offFrame === 0 && onChip === 0 && onBox === 0) return { label, placement };
    const cost = offFrame * 1_000_000 + onChip * 4 + onBox;
    if (cost < best.cost) best = { label, placement, cost };
  }

  return { label: best.label, placement: best.placement };
}

/**
 * Turn reported boxes into drawable rectangles for one rendered image size.
 *
 * `frame` is the rectangle the photo actually occupies on screen — not the container.
 * With `object-contain` those differ by the letterbox bars, and measuring the container
 * instead is the second classic way to draw every box in the wrong place.
 */
export function layoutBoxes(
  items: readonly { id: string; number: number; box: NormalisedBox }[],
  frame: Frame,
  options: LayoutOptions = DEFAULT_LAYOUT,
): PlacedBox[] {
  if (frame.width <= 0 || frame.height <= 0) return [];

  const raw = items.map((item) => ({
    ...item,
    rect: {
      left: item.box.x * frame.width,
      top: item.box.y * frame.height,
      width: item.box.width * frame.width,
      height: item.box.height * frame.height,
    },
  }));

  const rects = raw.map((entry) => entry.rect);

  // Two passes, because a label can only be placed well once every box's FINAL rectangle
  // is known. Placing them as each box is computed means chip 1 is positioned in
  // ignorance of box 2, which is how a chip ends up sitting on a box that had not been
  // laid out yet.
  const drawn = raw.map((entry) => {
    const pad = padAgainst(entry.rect, rects, options.pad);
    const padded = inflate(entry.rect, pad, frame);
    const rect = atLeast(padded, options.minSize, frame);
    return {
      id: entry.id,
      number: entry.number,
      rect,
      grown: rect.width > padded.width + 0.5 || rect.height > padded.height + 0.5,
    };
  });

  const placedLabels: Rect[] = [];

  return drawn.map((entry, index) => {
    const others = drawn.filter((_, other) => other !== index).map((other) => other.rect);
    const { label, placement } = placeLabel(entry.rect, frame, placedLabels, others, options);
    placedLabels.push(label);
    return { ...entry, label, placement };
  });
}

/**
 * The rectangle a photo occupies inside a container under `object-contain`.
 *
 * Exported because the overlay needs exactly this number and because getting it wrong is
 * invisible on a square photo and obvious on every other one — the kind of bug that ships.
 */
export function containedRect(image: Frame, container: Frame): Rect {
  if (image.width <= 0 || image.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}

/**
 * Convert a normalised box to the pixel rectangle of a source image, for cropping.
 *
 * Rounded outward so a crop never loses the item's edge to rounding, and always at least
 * one pixel in each direction so sharp is never handed a zero-width region.
 */
export function pixelRegion(
  box: NormalisedBox,
  source: Frame,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor(box.x * source.width));
  const top = Math.max(0, Math.floor(box.y * source.height));
  const right = Math.min(source.width, Math.ceil((box.x + box.width) * source.width));
  const bottom = Math.min(source.height, Math.ceil((box.y + box.height) * source.height));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Widen a box before cropping for recognition.
 *
 * A crop cut exactly on the reported edge throws away the item's own outline, and the
 * descriptor in lib/vision/embedding/descriptor.ts reads edges. A little of the
 * surrounding bench is cheaper than losing the shape — but only a little, or the crop
 * starts describing the bench, which is the failure this whole module exists to avoid.
 */
export function widenForCrop(box: NormalisedBox, by = 0.04): NormalisedBox {
  const x = clamp01(box.x - by);
  const y = clamp01(box.y - by);
  const right = clamp01(box.x + box.width + by);
  const bottom = clamp01(box.y + box.height + by);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Rebuild a box from the four nullable columns on ExtractedCandidate.
 *
 * All four or nothing. A row carrying three of them is a bug somewhere upstream, and the
 * right response is to behave as though the line has no box rather than to draw a
 * rectangle from whatever survived.
 */
export function boxFromRow(row: {
  boxX: number | null;
  boxY: number | null;
  boxWidth: number | null;
  boxHeight: number | null;
}): NormalisedBox | null {
  if (row.boxX === null || row.boxY === null || row.boxWidth === null || row.boxHeight === null) {
    return null;
  }
  return normaliseBox({ x: row.boxX, y: row.boxY, width: row.boxWidth, height: row.boxHeight });
}
