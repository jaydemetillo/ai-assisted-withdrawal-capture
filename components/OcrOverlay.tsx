'use client';

import { useState } from 'react';

export type OverlayChip = {
  id: string;
  /** [x0,y0,x1,y1] on a 0-1000 canvas, as returned by the model. */
  bbox: [number, number, number, number] | null;
  label: string;
  quantity: number;
  needsReview: boolean;
};

/**
 * Draws the photograph with each line the model read highlighted, and the item it
 * resolved to named beside it - the Google-Translate-over-a-menu effect.
 *
 * Boxes arrive normalized to 0-1000 rather than in pixels, so they stay correct at any
 * rendered size.
 *
 * Labels sit to the SIDE of their line, vertically centred, not stacked above it. Above
 * was the obvious placement and it was wrong: handwritten lines sit close together, so
 * every label landed on top of the line above it and the overlay turned into a pile of
 * overlapping bars. A written list is left-aligned with empty paper to its right, which
 * is exactly where a label can go without covering anything - and because each line
 * occupies its own vertical band, side labels cannot collide with each other either.
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
  const [loaded, setLoaded] = useState(false);
  const positioned = chips.filter((c) => c.bbox);

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-[#121316] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="The photographed handwritten list"
        className="block h-full w-full object-contain"
        onLoad={() => setLoaded(true)}
      />

      {loaded && showOverlay && (
        <div className="pointer-events-none absolute inset-0">
          {positioned.map((chip) => {
            const [x0, y0, x1, y1] = chip.bbox!;
            const active = activeId === chip.id;

            // How much empty paper is left of the image edge on this line, and how much
            // of it the label may use. Percentages here resolve against the box, not the
            // image, so the free space has to be converted into box-relative units -
            // otherwise a short line gets a uselessly short label ("3 x Sur...").
            const boxWidth = Math.max(1, (x1 - x0) / 10);
            const freeRight = (1000 - x1) / 10;
            // Under ~14% of the image left over is not enough for a readable label, so it
            // goes inside the highlight instead. Never to the left: that is where the
            // handwriting is.
            const inside = freeRight < 14;
            const maxWidth = inside
              ? '94%'
              : `${Math.max(40, ((freeRight - 2) / boxWidth) * 100)}%`;

            return (
              <div
                key={chip.id}
                className="absolute"
                style={{
                  left: `${x0 / 10}%`,
                  top: `${y0 / 10}%`,
                  width: `${(x1 - x0) / 10}%`,
                  height: `${(y1 - y0) / 10}%`,
                }}
              >
                {/* The highlight, sitting directly on the handwriting. */}
                <div
                  className={`absolute inset-0 rounded-[3px] border-2 transition-all ${
                    chip.needsReview
                      ? 'border-warning bg-warning/25'
                      : 'border-brand-600 bg-brand-600/20'
                  } ${active ? 'ring-2 ring-white/80' : ''}`}
                />
                {/* The read-out, beside the line rather than on top of its neighbour. */}
                <button
                  type="button"
                  onClick={onChipClick ? () => onChipClick(chip.id) : undefined}
                  title={chip.label}
                  className={`
                    pointer-events-auto absolute top-1/2 -translate-y-1/2 truncate rounded-md
                    px-1.5 py-0.5 text-[10px] font-semibold shadow-md transition-transform hover:scale-105
                    ${chip.needsReview ? 'bg-warning text-content-strong' : 'bg-brand-600 text-white'}
                    ${active ? 'ring-2 ring-white/80' : ''}
                  `}
                  style={
                    inside
                      ? { right: 4, maxWidth }
                      : { left: 'calc(100% + 6px)', maxWidth }
                  }
                >
                  {chip.quantity > 0 ? `${chip.quantity} × ` : ''}
                  {chip.label}
                  {chip.needsReview ? ' ?' : ''}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
