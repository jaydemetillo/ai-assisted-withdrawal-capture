import { describe, expect, it } from 'vitest';
import {
  BOX_LIMITS,
  boxFromRow,
  containedRect,
  DEFAULT_LAYOUT,
  layoutBoxes,
  normaliseBox,
  pixelRegion,
  widenForCrop,
  type NormalisedBox,
} from '@/lib/vision/boxes';

const box = (x: number, y: number, width: number, height: number): NormalisedBox => ({
  x,
  y,
  width,
  height,
});

/**
 * Compare boxes with a tolerance. Every arithmetic path here subtracts fractions —
 * 0.5 - 0.1 is 0.4000000000000001 in IEEE 754 — and asserting exact equality would make
 * the suite fail on arithmetic rather than on behaviour. Sub-pixel error is invisible in
 * a rendered box and rounded away entirely before a crop.
 */
function expectBox(actual: NormalisedBox | null, expected: NormalisedBox): void {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 10);
  expect(actual!.y).toBeCloseTo(expected.y, 10);
  expect(actual!.width).toBeCloseTo(expected.width, 10);
  expect(actual!.height).toBeCloseTo(expected.height, 10);
}

function overlaps(a: { left: number; top: number; width: number; height: number }, b: typeof a): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

describe('normaliseBox', () => {
  it('passes a well-formed box through unchanged', () => {
    expectBox(normaliseBox({ x: 0.2, y: 0.3, width: 0.4, height: 0.25 }), box(0.2, 0.3, 0.4, 0.25));
  });

  it('repairs a box described backwards rather than dropping it', () => {
    // A negative width is a model saying the same rectangle from the other corner.
    expectBox(normaliseBox({ x: 0.6, y: 0.7, width: -0.4, height: -0.25 }), box(0.2, 0.45, 0.4, 0.25));
  });

  it('accepts corner pairs as well as width and height', () => {
    expectBox(normaliseBox({ x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.4 }), box(0.1, 0.1, 0.4, 0.3));
  });

  it('sorts corner pairs given in the wrong order', () => {
    expectBox(normaliseBox({ x1: 0.5, y1: 0.4, x2: 0.1, y2: 0.1 }), box(0.1, 0.1, 0.4, 0.3));
  });

  it('clamps a box that runs off the edge of the frame', () => {
    expectBox(normaliseBox({ x: -0.2, y: 0.8, width: 0.5, height: 0.9 }), box(0, 0.8, 0.3, 0.2));
  });

  it.each([
    ['null', null],
    ['a string', 'x: 0.2'],
    ['an empty object', {}],
    ['a partial box', { x: 0.2, y: 0.3, width: 0.4 }],
    ['NaN', { x: Number.NaN, y: 0.3, width: 0.4, height: 0.2 }],
    ['Infinity', { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 0.2 }],
  ])('refuses %s', (_label, input) => {
    expect(normaliseBox(input)).toBeNull();
  });

  it('refuses a sliver, because a 1px line is not a rectangle anybody can check', () => {
    expect(normaliseBox({ x: 0.4, y: 0.4, width: 0.002, height: 0.5 })).toBeNull();
  });

  it('refuses a box round essentially the whole photograph', () => {
    // True, and useless: "it is in here somewhere" tells a nurse nothing and makes every
    // honest box on the same photo look wrong by comparison.
    expect(normaliseBox({ x: 0.01, y: 0.01, width: 0.98, height: 0.98 })).toBeNull();
    expect(BOX_LIMITS.maxCoverage).toBeLessThan(1);
  });

  it('keeps a large but plausible box', () => {
    expect(normaliseBox({ x: 0.05, y: 0.1, width: 0.9, height: 0.8 })).not.toBeNull();
  });

  it('is deterministic', () => {
    const input = { x: 0.31, y: 0.22, width: 0.4, height: 0.3 };
    expect(normaliseBox(input)).toEqual(normaliseBox(input));
  });
});

describe('boxFromRow', () => {
  it('rebuilds a box from four columns', () => {
    expectBox(boxFromRow({ boxX: 0.1, boxY: 0.2, boxWidth: 0.3, boxHeight: 0.4 }), box(0.1, 0.2, 0.3, 0.4));
  });

  it('treats a partially written row as having no box', () => {
    expect(boxFromRow({ boxX: 0.1, boxY: 0.2, boxWidth: null, boxHeight: 0.4 })).toBeNull();
  });

  it('re-applies the limits, so a row that no longer qualifies stops being drawn', () => {
    expect(boxFromRow({ boxX: 0, boxY: 0, boxWidth: 1, boxHeight: 1 })).toBeNull();
  });
});

describe('containedRect', () => {
  it('letterboxes a wide photo in a square container', () => {
    const rect = containedRect({ width: 400, height: 200 }, { width: 300, height: 300 });
    expect(rect).toEqual({ left: 0, top: 75, width: 300, height: 150 });
  });

  it('pillarboxes a tall photo in a wide container', () => {
    const rect = containedRect({ width: 200, height: 400 }, { width: 300, height: 300 });
    expect(rect).toEqual({ left: 75, top: 0, width: 150, height: 300 });
  });

  it('fills the container exactly when the aspect ratios match', () => {
    const rect = containedRect({ width: 1200, height: 900 }, { width: 400, height: 300 });
    expect(rect).toEqual({ left: 0, top: 0, width: 400, height: 300 });
  });

  it('returns nothing for an unmeasured container rather than dividing by zero', () => {
    expect(containedRect({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });
});

describe('layoutBoxes', () => {
  const frame = { width: 360, height: 480 };

  it('maps a box to the pixels it describes', () => {
    const [placed] = layoutBoxes([{ id: 'a', number: 1, box: box(0.25, 0.5, 0.5, 0.25) }], frame, {
      ...DEFAULT_LAYOUT,
      pad: 0,
    });
    expect(placed?.rect).toEqual({ left: 90, top: 240, width: 180, height: 120 });
  });

  it('grows a box that would be too small to see or tap', () => {
    const [placed] = layoutBoxes([{ id: 'a', number: 1, box: box(0.5, 0.5, 0.02, 0.02) }], frame, {
      ...DEFAULT_LAYOUT,
      pad: 0,
    });
    expect(placed?.rect.width).toBe(DEFAULT_LAYOUT.minSize);
    expect(placed?.rect.height).toBe(DEFAULT_LAYOUT.minSize);
    expect(placed?.grown).toBe(true);
  });

  it('grows about the centre, so the box stays on the item', () => {
    // The whole point. Growing from the top-left — the obvious implementation — walks a
    // small box down and to the right, off the thing it is meant to be around.
    const original = box(0.5, 0.5, 0.02, 0.02);
    const [placed] = layoutBoxes([{ id: 'a', number: 1, box: original }], frame, {
      ...DEFAULT_LAYOUT,
      pad: 0,
    });
    const centreX = (original.x + original.width / 2) * frame.width;
    const centreY = (original.y + original.height / 2) * frame.height;
    expect((placed?.rect.left ?? 0) + (placed?.rect.width ?? 0) / 2).toBeCloseTo(centreX, 5);
    expect((placed?.rect.top ?? 0) + (placed?.rect.height ?? 0) / 2).toBeCloseTo(centreY, 5);
  });

  it('slides a grown box back inside the frame instead of squashing it', () => {
    const [placed] = layoutBoxes([{ id: 'a', number: 1, box: box(0.0, 0.0, 0.02, 0.02) }], frame, {
      ...DEFAULT_LAYOUT,
      pad: 0,
    });
    expect(placed?.rect.left).toBe(0);
    expect(placed?.rect.top).toBe(0);
    // Still full size: a corner box that shrank to fit would be the squashing complaint.
    expect(placed?.rect.width).toBe(DEFAULT_LAYOUT.minSize);
    expect(placed?.rect.height).toBe(DEFAULT_LAYOUT.minSize);
  });

  it('never draws outside the frame', () => {
    const placed = layoutBoxes(
      [
        { id: 'a', number: 1, box: box(0, 0, 0.05, 0.05) },
        { id: 'b', number: 2, box: box(0.95, 0.95, 0.05, 0.05) },
        { id: 'c', number: 3, box: box(0.9, 0.02, 0.1, 0.04) },
      ],
      frame,
    );
    for (const item of placed) {
      expect(item.rect.left).toBeGreaterThanOrEqual(0);
      expect(item.rect.top).toBeGreaterThanOrEqual(0);
      expect(item.rect.left + item.rect.width).toBeLessThanOrEqual(frame.width + 0.001);
      expect(item.rect.top + item.rect.height).toBeLessThanOrEqual(frame.height + 0.001);
    }
  });

  it('gives padding up when a neighbour is close, so two items do not fuse', () => {
    // Two boxes 0.02 of the frame apart — 7.2px at this width. Uniform 6px padding on
    // each would close the gap and draw them as one blob, which is the complaint that
    // started this module.
    const placed = layoutBoxes(
      [
        { id: 'a', number: 1, box: box(0.08, 0.3, 0.4, 0.34) },
        { id: 'b', number: 2, box: box(0.5, 0.33, 0.38, 0.3) },
      ],
      frame,
    );
    expect(placed).toHaveLength(2);
    expect(overlaps(placed[0]!.rect, placed[1]!.rect)).toBe(false);
  });

  it('still gives a lone box its full padding', () => {
    const [placed] = layoutBoxes([{ id: 'a', number: 1, box: box(0.3, 0.3, 0.3, 0.3) }], frame);
    // 0.3 * 360 = 108, plus 6px of padding on each side.
    expect(placed?.rect.width).toBeCloseTo(108 + DEFAULT_LAYOUT.pad * 2, 5);
  });

  it('lets genuinely overlapping boxes overlap', () => {
    // Two items that really do overlap on a tray. Nudging them apart to tidy the picture
    // would be a lie about where the items are.
    const placed = layoutBoxes(
      [
        { id: 'a', number: 1, box: box(0.2, 0.2, 0.4, 0.4) },
        { id: 'b', number: 2, box: box(0.35, 0.3, 0.4, 0.4) },
      ],
      frame,
    );
    expect(overlaps(placed[0]!.rect, placed[1]!.rect)).toBe(true);
  });

  it('never lets two labels sit on top of each other', () => {
    // Four stacked bands, the shape a handwritten note actually produces, each close
    // enough that the naive "always above" placement would stack every chip.
    const placed = layoutBoxes(
      [
        { id: 'a', number: 1, box: box(0.12, 0.2, 0.7, 0.08) },
        { id: 'b', number: 2, box: box(0.12, 0.3, 0.7, 0.08) },
        { id: 'c', number: 3, box: box(0.12, 0.4, 0.7, 0.08) },
        { id: 'd', number: 4, box: box(0.12, 0.5, 0.7, 0.08) },
      ],
      frame,
    );
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(overlaps(placed[i]!.label, placed[j]!.label)).toBe(false);
      }
    }
  });

  it('does not park a label on top of a neighbouring box', () => {
    // Seen in a browser before it was seen here: with only chip-on-chip collisions
    // avoided, chip 2 of a handwritten note sits squarely inside box 1, covering the
    // words that box is pointing at. Its own box is fair game; anybody else's is not.
    const placed = layoutBoxes(
      [
        { id: 'a', number: 1, box: box(0.12, 0.22, 0.7, 0.1) },
        { id: 'b', number: 2, box: box(0.12, 0.345, 0.7, 0.1) },
      ],
      frame,
    );
    expect(overlaps(placed[1]!.label, placed[0]!.rect)).toBe(false);
    expect(overlaps(placed[0]!.label, placed[1]!.rect)).toBe(false);
  });

  it('keeps every label inside the photo', () => {
    const placed = layoutBoxes(
      [
        { id: 'a', number: 1, box: box(0.02, 0.02, 0.2, 0.06) },
        { id: 'b', number: 2, box: box(0.78, 0.9, 0.2, 0.08) },
      ],
      frame,
    );
    for (const item of placed) {
      expect(item.label.left).toBeGreaterThanOrEqual(0);
      expect(item.label.top).toBeGreaterThanOrEqual(0);
      expect(item.label.left + item.label.width).toBeLessThanOrEqual(frame.width + 0.001);
      expect(item.label.top + item.label.height).toBeLessThanOrEqual(frame.height + 0.001);
    }
  });

  it('returns nothing before the photo has been measured', () => {
    expect(
      layoutBoxes([{ id: 'a', number: 1, box: box(0.2, 0.2, 0.2, 0.2) }], { width: 0, height: 0 }),
    ).toEqual([]);
  });

  it('is deterministic, so a re-render never reshuffles the labels', () => {
    const input = [
      { id: 'a', number: 1, box: box(0.1, 0.2, 0.3, 0.1) },
      { id: 'b', number: 2, box: box(0.1, 0.32, 0.3, 0.1) },
    ];
    expect(layoutBoxes(input, frame)).toEqual(layoutBoxes(input, frame));
  });
});

describe('pixelRegion', () => {
  it('rounds outward so a crop never loses the item’s own edge', () => {
    expect(pixelRegion(box(0.101, 0.101, 0.4, 0.4), { width: 1000, height: 1000 })).toEqual({
      left: 101,
      top: 101,
      width: 400,
      height: 400,
    });
  });

  it('never hands sharp a zero-width region', () => {
    const region = pixelRegion(box(0.9999, 0.9999, 0.0001, 0.0001), { width: 100, height: 100 });
    expect(region.width).toBeGreaterThanOrEqual(1);
    expect(region.height).toBeGreaterThanOrEqual(1);
  });

  it('stays inside the source image', () => {
    const region = pixelRegion(box(0.5, 0.5, 0.5, 0.5), { width: 640, height: 480 });
    expect(region.left + region.width).toBeLessThanOrEqual(640);
    expect(region.top + region.height).toBeLessThanOrEqual(480);
  });
});

describe('widenForCrop', () => {
  it('adds a margin so the crop keeps the item’s outline', () => {
    expectBox(widenForCrop(box(0.3, 0.3, 0.2, 0.2), 0.05), box(0.25, 0.25, 0.3, 0.3));
  });

  it('does not run off the edge for an item against the frame', () => {
    const widened = widenForCrop(box(0, 0, 0.2, 0.2), 0.05);
    expect(widened.x).toBe(0);
    expect(widened.y).toBe(0);
    expect(widened.x + widened.width).toBeLessThanOrEqual(1);
  });
});
