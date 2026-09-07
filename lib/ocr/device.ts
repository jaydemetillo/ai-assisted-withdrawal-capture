'use client';

import type { DeviceLine, DeviceReading, ReadWord } from '@/lib/ocr/device-text';
import { assembleReadText, looksLikeAnItemLine, tidyReadLine } from '@/lib/ocr/device-text';

/**
 * Reading the handwriting ON THE PHONE, for nothing.
 *
 * This is the route that needs no ANTHROPIC_API_KEY and no account: Tesseract's LSTM
 * engine, compiled to WebAssembly, running in a WebWorker in the browser that took the
 * photo. The photo never leaves the device to be read. There is no per-photo cost
 * because there is no server involved in the reading at all - the server only ever sees
 * the text that came out, and does the same catalogue matching it does for a typed list.
 *
 * The engine files are served from this app (`public/tesseract/`, filled in by
 * `scripts/copy-tesseract.mjs`), not from a third-party CDN, so a read does not depend
 * on anyone else being up. About 6.8MB the first time, then cached: the WebAssembly core
 * by the HTTP cache and the language model in IndexedDB.
 *
 * ## Why this is more than "call recognize() on the photo"
 *
 * The naive version returned NOTHING on the first real phone photo it was given, and the
 * reason is scale rather than handwriting. Someone photographing a note on a worktop
 * frames the paper as maybe a quarter of the picture. Downscale that to fit an engine and
 * the writing is ten or fifteen pixels tall - far below what an LSTM line recogniser can
 * work with - and it comes back empty while the same handwriting fills a page perfectly
 * legibly.
 *
 * So the photo is prepared before it is read:
 *
 *  1. **Read the ORIGINAL photo, not the uploaded copy.** The upload is shrunk to 1600px
 *     for bandwidth. Reading that copy instead was costing most of the accuracy on its
 *     own - see `Shot.original` in the capture screen.
 *  2. **Find the paper and crop to it.** The largest bright region in the frame. It
 *     throws away the worktop and spends the whole pixel budget on the writing.
 *  3. **Straighten it.** Nobody photographs a note square-on, and a few degrees is enough
 *     to break the engine's line-finding into pieces. This mattered more than anything
 *     else here: getting the sign of the correction wrong turned a note shot at 7 degrees
 *     into one at 14, and turned three clean rows into eight fragments.
 *  4. **Scale the crop UP, not just down.** A small note gets enlarged so its text is
 *     tall enough to recognise.
 *  5. **Grey it and stretch the contrast**, so pencil-on-cream has an actual black and an
 *     actual white.
 *  6. **Try more than one way of looking at it**, cheapest first, and keep the best.
 *
 * Cropping and straightening mean the engine's coordinates are relative to a rotated
 * crop, so every box is transformed back into the full photo before it leaves here. The
 * review overlay draws on the photo that was uploaded, and a box that described the crop
 * would sit in the wrong place - the bug this file is under standing orders not to
 * reintroduce.
 *
 * Worth trying if this is not good enough: cropping to the WRITING rather than the sheet,
 * for a list of five lines at the top of a big page. It needs to happen after the
 * straightening, not before - on a tilted sheet the paper's own diagonal edges cross
 * every row of an upright crop, and an ink search finds the whole page.
 */

const ASSETS = '/tesseract';
const LANGUAGE = 'eng';
export const DEVICE_ENGINE = 'tesseract-lstm-eng (on device)';

/**
 * Longest edge handed to the engine.
 *
 * Deliberately larger than the uploaded photo: after cropping to the paper this is an
 * UPscale for anything but a full-frame note, and the extra pixels are what make small
 * writing readable at all.
 */
const OCR_EDGE = 2200;
/**
 * Edge for the passes that binarise.
 *
 * Smaller on purpose: adaptive thresholding needs a summed-area table over every pixel,
 * and at full reading size that is tens of megabytes on a phone that has none to spare.
 * What that pass is fixing is a shadow, and a shadow does not need resolution.
 */
const HARD_EDGE = 1600;
/** A pass that found this many rows is not worth following with another one. */
const GOOD_ENOUGH = 3;
/**
 * Width of the working copy the ink and skew searches run on.
 *
 * Wide enough that a thin pen stroke survives being scaled down. At 320px it did not:
 * one-pixel handwriting averaged into the paper and both searches concluded there was no
 * ink on the page.
 */
const MASK_WIDTH = 800;

export type ReadStage = 'loading' | 'reading' | 'done';
export type ReadProgress = { stage: ReadStage; percent: number; label: string };

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

/** Whether this browser can run the reader at all. */
export function deviceReaderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker === 'function' &&
    typeof WebAssembly === 'object' &&
    typeof document !== 'undefined' &&
    typeof document.createElement('canvas').getContext === 'function'
  );
}

let workerPromise: Promise<TesseractWorker> | null = null;
/** Progress for whichever load is in flight, so a later caller can still report it. */
let loadListeners: ((progress: ReadProgress) => void)[] = [];

function announce(progress: ReadProgress) {
  for (const listener of loadListeners) listener(progress);
}

/** Human wording for the engine's own status strings. */
function label(status: string): string {
  if (status.includes('core')) return 'Getting the reader ready';
  if (status.includes('traineddata') || status.includes('language')) return 'Loading the English model';
  if (status.includes('initializ')) return 'Starting the reader';
  if (status.includes('recognizing')) return 'Reading your handwriting';
  return 'Working';
}

/**
 * Start loading the engine without reading anything yet.
 *
 * Called as soon as the capture screen opens, so the download overlaps with the seconds
 * someone spends framing the note rather than being charged to them after the shutter.
 */
export function prewarmDeviceReader(): void {
  if (!deviceReaderSupported()) return;
  void getWorker().catch(() => undefined);
}

function getWorker(): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return createWorker(LANGUAGE, OEM.LSTM_ONLY, {
      workerPath: `${ASSETS}/worker.min.js`,
      // A directory, not a file: the worker picks the build this device's WebAssembly
      // can actually run (relaxed SIMD, SIMD, or neither).
      corePath: ASSETS,
      langPath: ASSETS,
      gzip: true,
      logger: (message) => {
        const percent = Math.round(Math.max(0, Math.min(1, message.progress ?? 0)) * 100);
        announce({ stage: 'loading', percent, label: label(message.status ?? '') });
      },
    });
  })();

  // A failed load must not poison every later attempt - someone who was offline when
  // the screen opened can still read a photo once they have signal.
  workerPromise.catch(() => {
    workerPromise = null;
  });

  return workerPromise;
}

/* ---------------------------------------------------------------------------------- *
 * Getting the photo into a state the engine can read
 * ---------------------------------------------------------------------------------- */

async function toBitmap(blob: Blob): Promise<HTMLImageElement | ImageBitmap | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Safari refuses some sources here that <img> still decodes.
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function sizeOf(source: HTMLImageElement | ImageBitmap): { width: number; height: number } {
  return {
    width: 'naturalWidth' in source ? source.naturalWidth : source.width,
    height: 'naturalHeight' in source ? source.naturalHeight : source.height,
  };
}

/** A rectangle in the full photo's own pixels. */
type Crop = { x: number; y: number; width: number; height: number };

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** Otsu's threshold: the grey value that best separates the image into dark and light. */
function otsu(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * histogram[v];

  let weightBelow = 0;
  let sumBelow = 0;
  let best = -1;
  let threshold = 128;

  for (let v = 0; v < 256; v++) {
    weightBelow += histogram[v];
    if (weightBelow === 0) continue;
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) break;

    sumBelow += v * histogram[v];
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sum - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = v;
    }
  }
  return threshold;
}

/**
 * Find the sheet of paper in the photo.
 *
 * Paper is the big bright thing. Threshold the picture into light and dark at the value
 * that best separates the two, then take the largest connected light region and use its
 * bounding box. Done on a 160px-wide copy, because a rectangle does not need detail and
 * this way the whole search costs a couple of milliseconds.
 *
 * Returns `null` when there is nothing worth cropping to - the note already fills the
 * frame, or the bright region is too small, too big or the wrong shape to be a page.
 * Cropping to the wrong thing would be far worse than not cropping, so every one of
 * those cases declines.
 */
export function findPaper(source: HTMLImageElement | ImageBitmap | HTMLCanvasElement): Crop | null {
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!width || !height) return null;

  const w = 160;
  const h = Math.max(1, Math.round((height / width) * w));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = context(small);
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);

  const pixels = ctx.getImageData(0, 0, w, h).data;
  const total = w * h;
  const grey = new Uint8Array(total);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; p < total; i += 4, p++) {
    const value = Math.round((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000);
    grey[p] = value;
    histogram[value]++;
  }

  const threshold = otsu(histogram, total);
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);

  let bestArea = 0;
  let bestBox: Crop | null = null;

  for (let start = 0; start < total; start++) {
    if (seen[start] || grey[start] <= threshold) continue;

    let sp = 0;
    stack[0] = start;
    seen[start] = 1;

    let area = 0;
    let minX = w;
    let maxX = -1;
    let minY = h;
    let maxY = -1;

    // Flood fill, 4-connected. An explicit stack rather than recursion: a full-frame
    // page is 34,000 pixels and recursion would blow the call stack.
    while (sp >= 0) {
      const p = stack[sp--];
      const x = p % w;
      const y = (p - x) / w;

      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && !seen[p - 1] && grey[p - 1] > threshold) { seen[p - 1] = 1; stack[++sp] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && grey[p + 1] > threshold) { seen[p + 1] = 1; stack[++sp] = p + 1; }
      if (y > 0 && !seen[p - w] && grey[p - w] > threshold) { seen[p - w] = 1; stack[++sp] = p - w; }
      if (y < h - 1 && !seen[p + w] && grey[p + w] > threshold) { seen[p + w] = 1; stack[++sp] = p + w; }
    }

    if (area > bestArea) {
      bestArea = area;
      bestBox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
  }

  if (!bestBox) return null;

  const coverage = (bestBox.width * bestBox.height) / total;
  // Already most of the frame: cropping would gain nothing and risks shaving off a line.
  if (coverage > 0.75) return null;
  // Too small to be the page someone meant to photograph - probably a highlight or a
  // reflection, and cropping to it would throw the note away.
  if (coverage < 0.04) return null;
  const aspect = bestBox.width / bestBox.height;
  if (aspect > 8 || aspect < 0.125) return null;

  // A little margin, so a letter touching the edge of the sheet is not clipped.
  const pad = 0.02;
  const scale = width / w;
  const x = Math.max(0, (bestBox.x - w * pad) * scale);
  const y = Math.max(0, (bestBox.y - h * pad) * scale);
  const right = Math.min(width, (bestBox.x + bestBox.width + w * pad) * scale);
  const bottom = Math.min(height, (bestBox.y + bestBox.height + h * pad) * scale);

  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Mark the ink in a greyscale image by LOCAL contrast, not by a global threshold.
 *
 * Bradley's adaptive threshold: a pixel is ink when it is meaningfully darker than the
 * average of the window around it. This is the only thing that works on a photograph of
 * paper, and two earlier global thresholds both failed here for the same reason - a real
 * photo has a gradient across it. Anchored to the darkest pixel, the cut landed below the
 * writing and found nothing; anchored to the median, it landed inside the paper's own
 * shading and called 39% of a plain sheet "ink". Comparing each pixel to its own
 * neighbourhood has no global level to get wrong.
 *
 * Returns 1 for ink, 0 for paper.
 */
function adaptiveInk(grey: Uint8Array, w: number, h: number, radius: number, k: number): Uint8Array {
  // Summed-area table, so a window mean of any size costs four lookups. Uint32 rather
  // than Float64: the largest possible total is 255 x the pixel count, which fits with
  // room to spare, and it is a quarter of the memory on a phone that has none to spare.
  const stride = w + 1;
  const integral = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += grey[y * w + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + row;
    }
  }

  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];

      const p = y * w + x;
      ink[p] = grey[p] * count < sum * (1 - k) ? 1 : 0;
    }
  }
  return ink;
}

/** Greyscale a region of the photo into a small working copy. */
function greyCopy(
  source: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  crop: Crop,
  width: number,
): { grey: Uint8Array; w: number; h: number } | null {
  const w = width;
  const h = Math.max(1, Math.round((crop.height / crop.width) * w));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = context(canvas);
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);

  const pixels = ctx.getImageData(0, 0, w, h).data;
  const total = w * h;
  const grey = new Uint8Array(total);
  for (let i = 0, p = 0; p < total; i += 4, p++) {
    grey[p] = Math.round((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000);
  }
  return { grey, w, h };
}

/** A small working copy of a region with its ink marked, for the crop and skew searches. */
function inkMask(
  source: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  crop: Crop,
  width: number,
): { ink: Uint8Array; w: number; h: number; count: number } | null {
  const copy = greyCopy(source, crop, width);
  if (!copy) return null;
  const { grey, w, h } = copy;

  const ink = adaptiveInk(grey, w, h, Math.max(6, Math.round(Math.min(w, h) / 40)), 0.14);
  let count = 0;
  for (let p = 0; p < ink.length; p++) count += ink[p];

  return { ink, w, h, count };
}

/**
 * Work out how far the writing is tilted, in radians.
 *
 * Nobody photographs a note square-on, and a few degrees is enough to wreck the read:
 * the engine finds lines by looking for rows of ink, so on a tilted page one written
 * line spills across several rows and comes back in pieces. A note at 7 degrees read as
 * `Ward 4 / 41-5 / 15 / Medical / 2x Macks / ( Cyringes / Coline / 5x` - every line
 * broken and every quantity separated from its item.
 *
 * The method is a projection profile. Rotate the ink by a candidate angle, count how much
 * lands in each row, and measure how uneven those counts are. When the angle is right the
 * lines of writing line up with the rows, so the counts go sharply between "a line" and
 * "the gap between lines" - and that unevenness peaks. Done on a 320px copy over ink
 * pixels only, so the whole search is a fraction of a single recognition pass.
 */
export function estimateSkew(source: HTMLImageElement | ImageBitmap | HTMLCanvasElement, crop: Crop): number {
  const mask = inkMask(source, crop, MASK_WIDTH);
  if (!mask) return 0;
  const { ink, w, h } = mask;
  const total = w * h;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let p = 0; p < total; p++) {
    if (!ink[p]) continue;
    const x = p % w;
    xs.push(x);
    ys.push((p - x) / w);
  }
  // Too little ink to tell, or so much that the threshold has told us nothing. Ruled
  // lines counting as ink is fine here, unlike in the crop: they run parallel to the
  // writing, so they point at the same angle.
  if (xs.length < 100 || xs.length > total * 0.85) return 0;

  const size = w + h + 2;
  const offset = w;
  const counts = new Float64Array(size);

  let bestAngle = 0;
  let bestSpread = -1;

  // ±12° in half-degree steps. Beyond that someone is holding the phone sideways, and a
  // wider search starts finding spurious alignments in the paper's own ruled lines.
  for (let degrees = -12; degrees <= 12; degrees += 0.5) {
    const angle = (degrees * Math.PI) / 180;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    counts.fill(0);

    for (let i = 0; i < xs.length; i++) {
      const row = Math.round(xs[i] * sin + ys[i] * cos) + offset;
      if (row >= 0 && row < size) counts[row]++;
    }

    // Variance of the row counts. Same number of ink pixels at every angle, so this is a
    // fair comparison: whichever angle concentrates them into fewest rows wins.
    let mean = 0;
    for (let r = 0; r < size; r++) mean += counts[r];
    mean /= size;
    let spread = 0;
    for (let r = 0; r < size; r++) spread += (counts[r] - mean) ** 2;

    if (spread > bestSpread) {
      bestSpread = spread;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

/** Maps a point in the prepared canvas back to a 0-1000 point on the whole photo. */
type Mapper = (x: number, y: number) => [number, number];

/**
 * Draw a region of the photo at reading size: cropped, straightened, greyed, contrast
 * stretched - and with a function to map the engine's coordinates back to the photo.
 *
 * A phone photo of paper is a colour image with a shadow across it. Tesseract works on
 * one channel and picks a single global threshold, so both the colour and the shadow are
 * noise to it. Greying it and stretching the middle of the histogram to the full range is
 * what turns pencil-on-cream into something with an actual black and an actual white.
 */
function prepare(
  source: HTMLImageElement | ImageBitmap,
  crop: Crop,
  longestEdge: number,
  angle: number,
  photo: { width: number; height: number },
): { canvas: HTMLCanvasElement; map: Mapper } | null {
  if (crop.width < 1 || crop.height < 1) return null;

  const scale = longestEdge / Math.max(crop.width, crop.height);
  const flatWidth = Math.max(1, Math.round(crop.width * scale));
  const flatHeight = Math.max(1, Math.round(crop.height * scale));

  // Rotating by -angle straightens the writing, and the canvas grows to hold the corners.
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(Math.abs(flatWidth * cos) + Math.abs(flatHeight * sin)));
  canvas.height = Math.max(1, Math.round(Math.abs(flatWidth * sin) + Math.abs(flatHeight * cos)));

  const ctx = context(canvas);
  if (!ctx) return null;
  // Smoothing matters when this is an upscale, which for a small note it is.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  // PLUS the angle, not minus it. `estimateSkew` reports the rotation that makes the
  // lines horizontal, so applying it as given is the correction; negating it tilts the
  // page twice as far the wrong way, which is what it did at first - and a note shot at
  // 7 degrees came back as a straight one shot at 14.
  ctx.rotate(angle);
  ctx.drawImage(
    source as CanvasImageSource,
    crop.x, crop.y, crop.width, crop.height,
    -flatWidth / 2, -flatHeight / 2, flatWidth, flatHeight,
  );
  ctx.restore();

  // The inverse of that transform: canvas pixel -> straightened frame -> crop fraction
  // -> whole photo -> 0-1000. Every box the engine returns goes through this, or the
  // overlay draws it in the wrong place.
  const map: Mapper = (x, y) => {
    const u = x - canvas.width / 2;
    const v = y - canvas.height / 2;
    const localX = u * cos + v * sin;
    const localY = -u * sin + v * cos;
    const fx = (localX + flatWidth / 2) / flatWidth;
    const fy = (localY + flatHeight / 2) / flatHeight;
    return [
      ((crop.x + fx * crop.width) / photo.width) * 1000,
      ((crop.y + fy * crop.height) / photo.height) * 1000,
    ];
  };

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;

  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const value = Math.round((pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000);
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value;
    pixels[i] = clamped;
    histogram[clamped]++;
  }

  // Ignore the darkest and lightest 0.5%: one dark speck or one blown-out highlight
  // should not decide the contrast of the whole page.
  const total = pixels.length / 4;
  const cut = Math.max(1, Math.round(total * 0.005));
  let low = 0;
  let high = 255;
  for (let seen = 0, v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= cut) { low = v; break; }
  }
  for (let seen = 0, v = 255; v >= 0; v--) {
    seen += histogram[v];
    if (seen >= cut) { high = v; break; }
  }

  const span = Math.max(1, high - low);
  const lookup = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lookup[v] = Math.max(0, Math.min(255, Math.round(((v - low) / span) * 255)));
  }
  for (let i = 0; i < pixels.length; i += 4) {
    const value = lookup[pixels[i]];
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
    pixels[i + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return { canvas, map };
}

/**
 * Turn a prepared canvas into pure black and white - for a photo with a shadow across it.
 *
 * One threshold for the whole image loses the writing wherever the page is shaded: a note
 * photographed under a ward light is bright at the top and grey at the bottom, and a
 * global cut either drops the bottom third or floods the top. `adaptiveInk` compares each
 * pixel to its own neighbourhood instead, so both survive.
 *
 * Tesseract does its own global binarisation, so this only earns its keep on a photo
 * where a global threshold is the thing that failed - hence it running on the later
 * passes, not the first.
 */
function binarize(prepared: HTMLCanvasElement): HTMLCanvasElement | null {
  const w = prepared.width;
  const h = prepared.height;
  const source = context(prepared);
  if (!source) return null;

  const pixels = source.getImageData(0, 0, w, h).data;
  const grey = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < grey.length; i += 4, p++) grey[p] = pixels[i];

  // A window around a quarter of the short edge, and 0.15 below its mean to count as
  // ink: enough to keep a thin biro stroke without turning paper grain into letters.
  const ink = adaptiveInk(grey, w, h, Math.max(8, Math.round(Math.min(w, h) / 24)), 0.15);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const target = out.getContext('2d');
  if (!target) return null;

  const result = target.createImageData(w, h);
  const output = result.data;
  for (let p = 0, i = 0; p < ink.length; p++, i += 4) {
    const value = ink[p] ? 0 : 255;
    output[i] = value;
    output[i + 1] = value;
    output[i + 2] = value;
    output[i + 3] = 255;
  }
  target.putImageData(result, 0, 0);
  return out;
}

/* ---------------------------------------------------------------------------------- *
 * The read itself
 * ---------------------------------------------------------------------------------- */

type Pass = { lines: DeviceLine[]; confidence: number; letters: number };

/**
 * How many lines of a pass would actually become rows.
 *
 * Measured with the same test the parser uses, deliberately. An earlier looser version -
 * "has a digit and three letters somewhere" - counted `ore 1)` off a photograph of a
 * worktop as a row, which let the reader stop early on nonsense and then present that
 * nonsense as a reading.
 */
function rowsFound(pass: Pass): number {
  return pass.lines.filter((line) => looksLikeAnItemLine(line.text)).length;
}

/**
 * How promising a pass looks, without knowing anything about the catalogue.
 *
 * Row-shaped lines dominate, because they are the shape of every line on a stock list
 * and they separate "read the note" from "read the worktop" far better than the engine's
 * own confidence does - a confidently-read smudge scores high on confidence alone.
 * Letters read is the tie-breaker, so a pass that found some words always beats one that
 * found none.
 */
function score(pass: Pass): number {
  return rowsFound(pass) * 100 + pass.confidence * 20 + Math.min(pass.letters, 200) / 10;
}

/**
 * Turn one recognition result into lines, with every box mapped onto the whole photo.
 *
 * The engine saw a cropped, straightened, rescaled copy. The overlay draws on the photo
 * that was uploaded. Without this mapping every box would be offset, scaled and tilted
 * wrongly - subtly enough to look like the reader had misidentified which line was which.
 *
 * A box that was a rectangle in the straightened frame is a tilted quad on the original,
 * and the overlay only draws upright rectangles, so all four corners are mapped and the
 * box that comes out is the upright one containing them. Slightly generous, still over
 * the right handwriting.
 */
function toLines(page: import('tesseract.js').Page, map: Mapper): Pass {
  const lines: DeviceLine[] = [];
  let confidenceSum = 0;
  let letters = 0;

  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words: ReadWord[] = (line.words ?? []).map((word) => ({
          text: word.text ?? '',
          confidence: (word.confidence ?? 0) / 100,
        }));
        const text = tidyReadLine(words);
        if (!text) continue;

        const confidence = Math.max(0, Math.min(1, (line.confidence ?? 0) / 100));
        confidenceSum += confidence;
        letters += text.replace(/[^a-z0-9]/gi, '').length;

        const corners = [
          map(line.bbox.x0, line.bbox.y0),
          map(line.bbox.x1, line.bbox.y0),
          map(line.bbox.x1, line.bbox.y1),
          map(line.bbox.x0, line.bbox.y1),
        ];
        const xs = corners.map(([x]) => x);
        const ys = corners.map(([, y]) => y);
        lines.push({
          text,
          confidence,
          bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        });
      }
    }
  }

  return {
    lines,
    confidence: lines.length ? confidenceSum / lines.length : 0,
    letters,
  };
}

async function recognise(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  mode: 'auto' | 'sparse' | 'block',
  map: Mapper,
): Promise<Pass> {
  const { PSM } = await import('tesseract.js');
  await worker.setParameters({
    tessedit_pageseg_mode:
      mode === 'sparse' ? PSM.SPARSE_TEXT : mode === 'block' ? PSM.SINGLE_BLOCK : PSM.AUTO,
    preserve_interword_spaces: '1',
    // Phone photos carry no useful DPI. Telling it what we actually handed over stops it
    // guessing from the pixel count and mis-sizing the text.
    user_defined_dpi: '300',
  });

  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return toLines(data, map);
}

/**
 * Read a photographed list on this device.
 *
 * Throws only when the engine cannot be loaded or the image cannot be decoded, so the
 * caller can offer typing instead. "Nothing legible" is not an error - it comes back as
 * an empty reading, which is a real answer, and the caller carries the person forward
 * with the photo attached rather than trapping them on the camera screen.
 */
export async function readOnDevice(
  blob: Blob,
  onProgress?: (progress: ReadProgress) => void,
): Promise<DeviceReading> {
  if (!deviceReaderSupported()) {
    throw new Error('This browser cannot read handwriting on the device.');
  }

  const listener = onProgress ?? (() => undefined);
  loadListeners.push(listener);
  try {
    const worker = await getWorker();

    const source = await toBitmap(blob);
    if (!source) throw new Error('That image could not be opened on this device.');
    const photo = sizeOf(source);
    if (!photo.width || !photo.height) throw new Error('That image could not be measured.');

    const whole: Crop = { x: 0, y: 0, width: photo.width, height: photo.height };
    const paper = findPaper(source);
    const region = paper ?? whole;

    // Below a degree and a half, rotating only resamples the image and softens the
    // strokes for nothing.
    const skew = estimateSkew(source, region);
    const angle = Math.abs(skew) > (1.5 * Math.PI) / 180 ? skew : 0;

    /**
     * The attempts, cheapest and most likely first. Each runs only if the ones before it
     * did not already find the note, so a well-framed photo costs one pass and a
     * difficult one pays for the extra seconds it needs.
     *
     * Cropping to the paper comes first when we found paper, because it is the pass most
     * likely to work on a real phone photo. Everything after it gives up an assumption:
     * the straightening, then the crop, then the page layout.
     */
    type Attempt = {
      crop: Crop;
      mode: 'auto' | 'sparse' | 'block';
      angle: number;
      edge: number;
      label: string;
    };

    const attempts: Attempt[] = [];
    const push = (crop: Crop, mode: Attempt['mode'], a: number, edge: number, label: string) =>
      attempts.push({ crop, mode, angle: a, edge, label });

    if (paper) {
      push(paper, 'auto', angle, OCR_EDGE, 'Reading your handwriting');
      push(paper, 'sparse', angle, OCR_EDGE, 'Looking line by line');
      if (angle !== 0) push(paper, 'auto', 0, OCR_EDGE, 'Reading it as it was shot');
      push(paper, 'auto', angle, HARD_EDGE, 'Trying harder on the shadows');
    }
    push(whole, 'auto', angle, OCR_EDGE, 'Reading the whole picture');
    push(whole, 'sparse', angle, OCR_EDGE, 'Looking line by line');
    push(whole, 'block', 0, OCR_EDGE, 'One last look');

    // Which of those decisions fired, for when a photo reads badly on someone's phone and
    // the only way to find out why is to look at the console on that phone.
    console.debug('[device-ocr] photo', photo, {
      paper: paper && { ...paper, of: +((paper.width * paper.height) / (photo.width * photo.height)).toFixed(3) },
      skewDegrees: +((angle * 180) / Math.PI).toFixed(1),
      attempts: attempts.length,
    });

    let best: Pass = { lines: [], confidence: 0, letters: 0 };

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      listener({
        stage: 'reading',
        percent: Math.round((i / attempts.length) * 100),
        label: attempt.label,
      });

      const prepared = prepare(source, attempt.crop, attempt.edge, attempt.angle, photo);
      if (!prepared) continue;
      // The reduced-size passes are the ones worth binarising: a global threshold is what
      // fails on a shadowed page, and that is independent of resolution.
      const canvas =
        attempt.edge === HARD_EDGE ? binarize(prepared.canvas) ?? prepared.canvas : prepared.canvas;

      let pass: Pass;
      try {
        pass = await recognise(worker, canvas, attempt.mode, prepared.map);
      } catch {
        continue; // A pass that throws is a pass we do without, not a failed read.
      }

      if (score(pass) > score(best)) best = pass;
      // Enough rows, or a couple of rows read confidently. Stopping at two mediocre ones
      // cost a whole item on a note where a later pass would have found all three.
      if (rowsFound(best) >= GOOD_ENOUGH || (rowsFound(best) >= 2 && best.confidence >= 0.8)) break;
    }

    if ('close' in source) source.close();

    /**
     * Nothing that looks like a stock list, and no confidence in what it did see.
     *
     * A recogniser always returns something. Pointed at a worktop it produced
     * `1 / gx / ore 1) / bea / CR / Cade` and would have offered that up as the reading
     * of someone's note. Six lines of nonsense presented as a reading is worse than
     * saying it could not make the writing out: one wastes their time deleting it, the
     * other tells them to retake the photo.
     */
    const legible = rowsFound(best) > 0 || best.confidence >= 0.65;

    listener({ stage: 'done', percent: 100, label: 'Read' });
    return {
      engine: DEVICE_ENGINE,
      text: legible ? assembleReadText(best.lines) : '',
      lines: legible ? best.lines : [],
      confidence: legible ? best.confidence : 0,
    };
  } finally {
    loadListeners = loadListeners.filter((l) => l !== listener);
  }
}
