'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type OverlayChip = {
  id: string;
  /** [x0,y0,x1,y1] on a 0-1000 canvas, as returned by the model. */
  bbox: [number, number, number, number] | null;
  label: string;
  quantity: number;
  needsReview: boolean;
};

/** Rendered label geometry, in pixels within the overlay box. */
const LABEL_HEIGHT = 20;
/** Minimum clear space between two labels. Below this they read as one smear. */
const LABEL_GAP = 6;
/** A label needs at least this much room beside the line, else it goes inside it. */
const MIN_SIDE_ROOM = 78;

type Placed = {
  chip: OverlayChip;
  box: { left: number; top: number; width: number; height: number };
  label: { left: number; top: number; maxWidth: number; inside: boolean };
};

/**
 * The photograph with each line the model read highlighted, and the item it resolved to
 * named beside it - the Google-Translate-over-a-menu effect.
 *
 * Two things make this harder than it looks, and both were got wrong first time round:
 *
 *  1. Handwritten lines sit close together, so a label placed above its line lands on
 *     the line above it. Labels therefore sit BESIDE their line, on the empty paper a
 *     left-aligned list leaves to its right.
 *  2. Side placement alone is not enough. On a phone the photo renders a few hundred
 *     pixels tall, so lines 60 units apart on the 0-1000 canvas end up ~13px apart -
 *     closer than a label is tall, and they overlap anyway. So labels are laid out in
 *     real pixels with a collision pass that keeps at least LABEL_GAP between them,
 *     nudging each one down from its line rather than letting them pile up.
 *
 * That means measuring the rendered element, which is why this needs a ResizeObserver
 * rather than pure percentage CSS.
 */
export function OcrOverlay({
  src,
  chips,
  className = '',
  showOverlay = true,
  activeId,
  onChipClick,
}: {
  src: string;
  chips: OverlayChip[];
  className?: string;
  showOverlay?: boolean;
  activeId?: string | null;
  onChipClick?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; x: number; y: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  /**
   * Measure the PHOTO, not the box around it.
   *
   * The image is drawn with object-contain, so unless its aspect ratio happens to match
   * the container it is letterboxed - centred with bars down the sides or along the top
   * and bottom. Boxes are normalized against the photo, so mapping them to the container
   * shifts and stretches every one of them; on a portrait note in a landscape frame the
   * highlights miss the handwriting completely. This works out where the photo actually
   * landed and maps into that rectangle instead.
   */
  const measure = useCallback(() => {
    const host = hostRef.current;
    const img = imgRef.current;
    if (!host) return;
    const cw = host.clientWidth;
    const ch = host.clientHeight;
    const nw = img?.naturalWidth ?? 0;
    const nh = img?.naturalHeight ?? 0;
    if (!nw || !nh) {
      setSize({ w: cw, h: ch, x: 0, y: 0 });
      return;
    }
    const scale = Math.min(cw / nw, ch / nh);
    const w = nw * scale;
    const h = nh * scale;
    setSize({ w, h, x: (cw - w) / 2, y: (ch - h) / 2 });
  }, []);

  useEffect(() => {
    measure();
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  /**
   * An image that was already in the cache never fires `load`.
   *
   * The handler below is the only thing that sets `loaded`, and the overlay is hidden
   * until it does - so revisiting a capture, or arriving with the photo already fetched,
   * showed the photograph with no highlights on it at all and no hint that anything was
   * missing. Ask the element directly instead of waiting for an event that has been and
   * gone.
   */
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
      measure();
    }
  }, [measure, src]);

  let placed: Placed[] = [];
  if (size && size.w > 0 && size.h > 0) {
    const withBox = chips
      .filter((c) => c.bbox)
      .map((chip) => {
        const [x0, y0, x1, y1] = chip.bbox!;
        return {
          chip,
          box: {
            left: size.x + (x0 / 1000) * size.w,
            top: size.y + (y0 / 1000) * size.h,
            width: ((x1 - x0) / 1000) * size.w,
            height: ((y1 - y0) / 1000) * size.h,
          },
        };
      })
      // Top to bottom, so the collision pass only ever needs to look backwards.
      .sort((a, b) => a.box.top - b.box.top);

    let previousBottom = -Infinity;
    placed = withBox.map(({ chip, box }) => {
      const boxRight = box.left + box.width;
      const roomToTheRight = size.x + size.w - boxRight - 8;
      // Never place a label to the left: that is where the handwriting is.
      const inside = roomToTheRight < MIN_SIDE_ROOM;

      const idealTop = box.top + box.height / 2 - LABEL_HEIGHT / 2;
      let top = Math.max(idealTop, previousBottom + LABEL_GAP);
      // Keep the last few inside the frame rather than pushed off the bottom.
      top = Math.min(top, Math.max(size.y, size.y + size.h - LABEL_HEIGHT));
      previousBottom = top + LABEL_HEIGHT;

      const left = inside ? box.left + 4 : boxRight + 8;
      const maxWidth = Math.max(48, inside ? box.width - 8 : size.x + size.w - left - 6);

      return { chip, box, label: { left, top, maxWidth, inside } };
    });
  }

  return (
    <div ref={hostRef} className={`relative overflow-hidden rounded-2xl bg-[#121316] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt="The photographed handwritten list"
        className="block h-full w-full object-contain"
        onLoad={() => {
          setLoaded(true);
          measure();
        }}
      />

      {loaded && showOverlay && placed.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {/* Highlights, sitting directly on the handwriting. */}
          {placed.map(({ chip, box }) => (
            <div
              key={`box-${chip.id}`}
              className={`absolute rounded-[3px] border-2 transition-all ${
                chip.needsReview ? 'border-warning bg-warning/25' : 'border-brand-600 bg-brand-600/20'
              } ${activeId === chip.id ? 'ring-2 ring-white/80' : ''}`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
          ))}

          {/* Read-outs, spaced so they never touch each other. */}
          {placed.map(({ chip, label }) => (
            <button
              key={`label-${chip.id}`}
              type="button"
              onClick={onChipClick ? () => onChipClick(chip.id) : undefined}
              title={chip.label}
              className={`
                pointer-events-auto absolute truncate rounded-md px-1.5 text-[10px] font-semibold leading-none
                shadow-md transition-transform hover:scale-105
                ${chip.needsReview ? 'bg-warning text-content-strong' : 'bg-brand-600 text-white'}
                ${activeId === chip.id ? 'ring-2 ring-white/80' : ''}
              `}
              style={{
                left: label.left,
                top: label.top,
                maxWidth: label.maxWidth,
                height: LABEL_HEIGHT,
                lineHeight: `${LABEL_HEIGHT}px`,
              }}
            >
              {chip.quantity > 0 ? `${chip.quantity} × ` : ''}
              {chip.label}
              {chip.needsReview ? ' ?' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
