'use client';

import type { DeviceLine, DeviceReading, ReadWord } from '@/lib/ocr/device-text';
import { assembleReadText, tidyReadLine } from '@/lib/ocr/device-text';

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
 * What it is honestly good at: block printing and neat cursive on flat, well-lit paper,
 * which is what a stock list on a scrap of paper usually is. What it is not: a vision
 * model. It reads words, it does not understand the page - so it can turn `Masks` into
 * `Maske`, and the catalogue matcher and the review screen are what make that survivable.
 * Every read therefore goes through a "check what it read" step before anything is
 * created, and every row still goes through the existing review gate before stock moves.
 */

const ASSETS = '/tesseract';
const LANGUAGE = 'eng';
export const DEVICE_ENGINE = 'tesseract-lstm-eng (on device)';

/** Longest edge the engine reads. Past this it gets slower without getting better. */
const OCR_EDGE = 1500;
/** Mean confidence at or below which a harder second pass is worth the extra seconds. */
const SECOND_PASS_BELOW = 0.72;

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

/**
 * Grey, straighten out the exposure, and size it for the engine.
 *
 * A phone photo of paper is a colour image with a shadow across it. Tesseract works on
 * one channel and picks a single global threshold, so both the colour and the shadow are
 * noise to it. Greying it and stretching the middle of the histogram to the full range
 * is what turns pencil-on-cream into something with an actual black and an actual white.
 */
function greyscale(source: HTMLImageElement | ImageBitmap): HTMLCanvasElement | null {
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!sw || !sh) return null;

  const scale = Math.min(1, OCR_EDGE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;

  // Luma, and a histogram to find where the paper and the ink actually sit.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const grey = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    const value = grey < 0 ? 0 : grey > 255 ? 255 : Math.round(grey);
    pixels[i] = value;
    histogram[value]++;
  }

  // Ignore the darkest and lightest 0.5%: one dark speck or one blown-out highlight
  // should not decide the contrast of the whole page.
  const total = pixels.length / 4;
  const cut = Math.max(1, Math.round(total * 0.005));
  let low = 0;
  let high = 255;
  for (let seen = 0, v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= cut) {
      low = v;
      break;
    }
  }
  for (let seen = 0, v = 255; v >= 0; v--) {
    seen += histogram[v];
    if (seen >= cut) {
      high = v;
      break;
    }
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
  if ('close' in source) source.close();
  return canvas;
}

/**
 * Bradley adaptive threshold - the second-pass trick for a badly lit photo.
 *
 * One threshold for the whole image loses the writing wherever the page is shaded: a
 * note photographed under a ward light is bright at the top and grey at the bottom, and
 * a global cut either drops the bottom third or floods the top. Comparing each pixel to
 * the mean of the window around it instead gives a per-region cut, so both survive.
 *
 * It is only worth the extra pass when the plain read came back doubtful, because on a
 * clean, evenly-lit note it throws away the greys Tesseract can use.
 */
function binarize(grey: HTMLCanvasElement): HTMLCanvasElement | null {
  const w = grey.width;
  const h = grey.height;
  const source = grey.getContext('2d', { willReadFrequently: true });
  if (!source) return null;

  const image = source.getImageData(0, 0, w, h);
  const pixels = image.data;

  // Summed-area table, so a window mean of any size costs four lookups.
  const stride = w + 1;
  const integral = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += pixels[(y * w + x) * 4];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + row;
    }
  }

  const radius = Math.max(8, Math.round(Math.min(w, h) / 24));
  // How far below its neighbourhood a pixel must be to count as ink. 0.15 keeps thin
  // biro strokes without turning paper grain into letters.
  const k = 0.15;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const target = out.getContext('2d');
  if (!target) return null;
  const result = target.createImageData(w, h);
  const output = result.data;

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

      const index = (y * w + x) * 4;
      const ink = pixels[index] * count < sum * (1 - k);
      const value = ink ? 0 : 255;
      output[index] = value;
      output[index + 1] = value;
      output[index + 2] = value;
      output[index + 3] = 255;
    }
  }

  target.putImageData(result, 0, 0);
  return out;
}

/* ---------------------------------------------------------------------------------- *
 * The read itself
 * ---------------------------------------------------------------------------------- */

type Pass = { lines: DeviceLine[]; confidence: number };

/**
 * How promising a pass looks, without knowing anything about the catalogue.
 *
 * A line that has a number and a word beside it is the shape of every row on a stock
 * list, so counting those separates "read the note" from "read the paper grain" far
 * better than the engine's own confidence does - a confidently-read smudge still scores
 * high on confidence alone.
 */
function score(pass: Pass): number {
  const rowShaped = pass.lines.filter((line) => /\d/.test(line.text) && /[a-z]{3}/i.test(line.text)).length;
  return rowShaped * 10 + pass.confidence * 10;
}

function toLines(page: import('tesseract.js').Page, width: number, height: number): Pass {
  const lines: DeviceLine[] = [];
  let confidenceSum = 0;

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
        lines.push({
          text,
          confidence,
          // Normalised to a 0-1000 canvas, which is what the review overlay expects and
          // what survives the photo being laid out at any size on any screen.
          bbox: [
            (line.bbox.x0 / width) * 1000,
            (line.bbox.y0 / height) * 1000,
            (line.bbox.x1 / width) * 1000,
            (line.bbox.y1 / height) * 1000,
          ],
        });
      }
    }
  }

  return { lines, confidence: lines.length ? confidenceSum / lines.length : 0 };
}

async function recognise(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
): Promise<Pass> {
  const { PSM } = await import('tesseract.js');
  await worker.setParameters({
    // AUTO lets it find the lines itself. A stock list is a short ragged column, not a
    // uniform block, and forcing SINGLE_BLOCK glues the signature onto the last item.
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
    // Phone photos carry no useful DPI. Telling it what we actually handed over stops it
    // guessing from the pixel count and mis-sizing the text.
    user_defined_dpi: '300',
  });

  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return toLines(data, canvas.width, canvas.height);
}

/**
 * Read a photographed list on this device.
 *
 * Throws when the engine cannot be loaded or the image cannot be decoded, so the caller
 * can offer typing instead. It never throws for "nothing legible" - that comes back as
 * an empty reading, which is a real answer and one the check step handles.
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
    const grey = greyscale(source);
    if (!grey) throw new Error('That image could not be prepared for reading.');

    listener({ stage: 'reading', percent: 0, label: 'Reading your handwriting' });
    let best = await recognise(worker, grey);

    // Only pay for the harder pass when the easy one came back unsure.
    if (best.confidence < SECOND_PASS_BELOW || best.lines.length === 0) {
      listener({ stage: 'reading', percent: 60, label: 'Trying harder on the shadows' });
      const hard = binarize(grey);
      if (hard) {
        const second = await recognise(worker, hard);
        if (score(second) > score(best)) best = second;
      }
    }

    listener({ stage: 'done', percent: 100, label: 'Read' });
    return {
      engine: DEVICE_ENGINE,
      text: assembleReadText(best.lines),
      lines: best.lines,
      confidence: best.confidence,
    };
  } finally {
    loadListeners = loadListeners.filter((l) => l !== listener);
  }
}
