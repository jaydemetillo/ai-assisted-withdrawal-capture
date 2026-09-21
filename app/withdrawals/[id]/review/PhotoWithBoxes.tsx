'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { containedRect, layoutBoxes, type NormalisedBox } from '@/lib/vision/boxes';

export type PhotoBox = {
  /** The candidate id, so tapping a box can find its card. */
  id: string;
  /** 1-based, and the same number printed on the card. */
  number: number;
  box: NormalisedBox;
  /** Read out by a screen reader and shown in the caption strip when selected. */
  label: string;
};

const STORAGE_KEY = 'awc.review.showBoxes';

/**
 * The photo, with a box round each line that could be placed.
 *
 * ## The overlay is not the interface
 *
 * The cards below are. A nurse confirms from the list; the boxes exist so that checking
 * "is that really a blue 18G?" does not mean hunting through a cluttered tray for the
 * thing the third card is talking about. That ordering decides most of the design:
 *
 *  - Every box is drawn quietly. Only the SELECTED one is emphasised, and only the
 *    selected one gets words — in a caption strip pinned to the bottom of the photo,
 *    where it cannot collide with anything, rather than floating beside its box.
 *  - Tapping a box selects its card and tapping a card selects its box, so the two
 *    representations are never out of step.
 *  - There is a "Hide boxes" control, and it is remembered. On a genuinely messy photo
 *    the overlay IS annoying, and the honest response is to let somebody turn it off
 *    rather than to insist they are wrong about their own screen.
 *
 * ## Why the geometry is not done here
 *
 * All of it lives in lib/vision/boxes.ts, which has no DOM in it and is therefore
 * actually tested. What is left here is measurement, and measurement is where the
 * classic overlay bugs live:
 *
 *  - The photo is drawn with `object-contain`, never `object-cover`. A cover crop throws
 *    away up to 40% of a portrait photo, and every box over it is displaced and
 *    misshapen — the "squashed, and not even on the item" failure.
 *  - Boxes are laid out against the rectangle the PHOTO occupies, from
 *    `containedRect()`, not against the container. With a height cap those differ by the
 *    letterbox bars, and using the container instead offsets every box by half a bar.
 *  - The container is given the photo's own aspect ratio, so the common case has no bars
 *    at all and nothing reflows once the image loads.
 */
export function PhotoWithBoxes({
  src,
  alt,
  boxes,
  selectedId,
  onSelect,
}: {
  src: string;
  alt: string;
  boxes: PhotoBox[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [show, setShow] = useState(true);

  // Read once on mount rather than during render: localStorage does not exist on the
  // server, and a first paint that disagreed with it would flash the boxes on.
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(STORAGE_KEY) !== 'off');
    } catch {
      // A browser with storage blocked still gets a working screen, defaulted to on.
    }
  }, []);

  const toggle = useCallback(() => {
    setShow((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
      } catch {
        // Not remembering the preference is survivable; failing the screen is not.
      }
      return next;
    });
  }, []);

  /**
   * A cached image has already finished loading before React attaches `onLoad`, so the
   * event never fires and the overlay never appears — on a reload, on a back-navigation,
   * on any second visit. It is intermittent by nature, which is the worst way for an
   * overlay to be broken: it works when you test it and not when somebody uses it. So the
   * dimensions are read directly on mount whenever the element reports itself complete.
   */
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    }
  }, [src]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setContainer({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const frame = useMemo(
    () => (natural ? containedRect(natural, container) : { left: 0, top: 0, width: 0, height: 0 }),
    [natural, container],
  );

  const placed = useMemo(
    () => layoutBoxes(boxes, { width: frame.width, height: frame.height }),
    [boxes, frame.width, frame.height],
  );

  const byId = useMemo(() => new Map(boxes.map((box) => [box.id, box])), [boxes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;

  return (
    <div>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden bg-ink"
        // The photo's own shape, so there are no letterbox bars in the ordinary case and
        // nothing jumps when it loads. Capped so a tall portrait photo does not push the
        // whole list off a phone screen.
        style={{ aspectRatio: natural ? `${natural.width} / ${natural.height}` : '4 / 3', maxHeight: '60vh' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          className="absolute inset-0 h-full w-full object-contain"
          onLoad={(event) => {
            const image = event.currentTarget;
            // naturalWidth/Height are post-EXIF in every current browser, which is the
            // same upright frame sharp produced for the model. That correspondence is
            // the whole reason a fraction from the model can be drawn here at all.
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setNatural({ width: image.naturalWidth, height: image.naturalHeight });
            }
          }}
        />

        {show && frame.width > 0
          ? placed.map((item) => {
              const source = byId.get(item.id);
              const isSelected = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-pressed={isSelected}
                  aria-label={`Line ${item.number}${source ? `: ${source.label}` : ''}`}
                  className="absolute rounded-lg transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-100"
                  style={{
                    left: frame.left + item.rect.left,
                    top: frame.top + item.rect.top,
                    width: item.rect.width,
                    height: item.rect.height,
                    /*
                     * Two rings, not one. A single coloured outline disappears into a
                     * white glove or a dark tray depending on which colour you pick, and
                     * a photo taken in a corridor contains both. An inner light ring
                     * against an outer dark one is legible on every background, which is
                     * the same reason map pins and video subtitles are drawn this way.
                     */
                    boxShadow: isSelected
                      ? '0 0 0 2px rgba(255,255,255,0.95), 0 0 0 5px #0f6f6c, 0 0 0 7px rgba(0,0,0,0.35)'
                      : '0 0 0 1.5px rgba(255,255,255,0.85), 0 0 0 3.5px rgba(28,36,48,0.55)',
                    background: isSelected ? 'rgba(15,111,108,0.14)' : 'transparent',
                  }}
                />
              );
            })
          : null}

        {show && frame.width > 0
          ? placed.map((item) => {
              const isSelected = item.id === selectedId;
              return (
                <span
                  key={`label-${item.id}`}
                  // Decorative: the number is already in the button's accessible name,
                  // and announcing it twice is how an overlay becomes unusable by voice.
                  aria-hidden
                  className={`pointer-events-none absolute flex items-center justify-center rounded-lg text-sm font-bold tabular-nums ${
                    isSelected ? 'bg-brand-600 text-white' : 'bg-canvas/95 text-ink'
                  }`}
                  style={{
                    left: frame.left + item.label.left,
                    top: frame.top + item.label.top,
                    width: item.label.width,
                    height: item.label.height,
                    boxShadow: '0 0 0 1.5px rgba(28,36,48,0.45)',
                  }}
                >
                  {item.number}
                </span>
              );
            })
          : null}

        {/* Pinned, not floating. A caption anchored to its box is the thing that ends up
            half off the photo or sitting on top of the next one; at the bottom edge it
            is always in the same place and always readable. */}
        {show && selected ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-ink/85 px-3 py-2 text-sm font-medium text-white">
            <span className="font-bold tabular-nums">{selected.number}.</span> {selected.label}
          </p>
        ) : null}
      </div>

      {boxes.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
          <p className="text-sm text-ink-muted">
            {boxes.length === 1 ? '1 line marked on the photo' : `${boxes.length} lines marked on the photo`}
          </p>
          <button type="button" className="btn-quiet px-3 text-sm" onClick={toggle}>
            {show ? 'Hide boxes' : 'Show boxes'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
