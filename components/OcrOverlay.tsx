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
 * Draws the photograph with a labelled block over each line the model read - the
 * Google-Translate-over-a-menu effect.
 *
 * Boxes arrive normalized to 0-1000 rather than in pixels, so they stay correct no matter
 * what size the browser lays the image out at. Chips flip to sit inside the frame when a
 * line runs near the right or bottom edge.
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
            const nearRight = x1 > 720;
            const nearBottom = y1 > 880;
            const active = activeId === chip.id;

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
                {/* The highlight sitting directly on the handwriting. */}
                <div
                  className={`absolute inset-0 rounded-[3px] border-2 transition-all ${
                    chip.needsReview
                      ? 'border-warning bg-warning/25'
                      : 'border-brand-600 bg-brand-600/20'
                  } ${active ? 'ring-2 ring-white/80' : ''}`}
                />
                {/* The translated read-out, anchored just outside the box. */}
                <button
                  type="button"
                  onClick={onChipClick ? () => onChipClick(chip.id) : undefined}
                  className={`
                    pointer-events-auto absolute whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold
                    shadow-md transition-transform hover:scale-105
                    ${chip.needsReview ? 'bg-warning text-content-strong' : 'bg-brand-600 text-white'}
                  `}
                  style={{
                    [nearRight ? 'right' : 'left']: 0,
                    [nearBottom ? 'bottom' : 'top']: 'calc(100% + 2px)',
                  }}
                >
                  {chip.quantity > 0 ? `${chip.quantity} x ` : ''}
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
