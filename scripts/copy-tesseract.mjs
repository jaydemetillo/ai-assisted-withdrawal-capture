/**
 * Copy the on-device handwriting reader into public/tesseract/ so the phone fetches it
 * from this app and nowhere else.
 *
 * Tesseract.js defaults to pulling its worker, its WebAssembly core and its language
 * data from two third-party CDNs at the moment someone takes a photo. That is the worst
 * possible time to depend on someone else's uptime, and it means the reading only works
 * for a phone with open internet access. Copying the files into `public/` makes the
 * reader part of the deployment: same origin, no third party, and cached by the browser
 * after the first read.
 *
 * The files are build output, not source - they are gitignored and this script runs as
 * part of `npm run build` and `npm run setup`. Nothing here is committed.
 *
 * Only the LSTM cores are copied. We ask for OEM.LSTM_ONLY, so tesseract.js picks one of
 * these three depending on what the device's WebAssembly supports (relaxed SIMD, plain
 * SIMD, or neither) - and would 404 on whichever one is missing. The legacy non-LSTM
 * cores are another 14MB that this app can never reach.
 */
import { createRequire } from 'node:module';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const OUT = path.join(process.cwd(), 'public', 'tesseract');

/** Resolve a file inside an installed package without hard-coding node_modules paths. */
function inPackage(pkg, file) {
  return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
}

const FILES = [
  // The WebWorker that drives the engine.
  [inPackage('tesseract.js', 'dist/worker.min.js'), 'worker.min.js'],
  // The engine itself, one build per level of WebAssembly SIMD support.
  [inPackage('tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [inPackage('tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [inPackage('tesseract.js-core', 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  // English LSTM model. `4.0.0_best_int` is the accurate model quantised to integers:
  // 2.9MB instead of 11MB, and noticeably better on handwriting than the `fast` model.
  [inPackage('@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];

await mkdir(OUT, { recursive: true });

let bytes = 0;
for (const [from, name] of FILES) {
  await copyFile(from, path.join(OUT, name));
  bytes += (await stat(from)).size;
}

console.log(
  `[tesseract] ${FILES.length} files -> public/tesseract (${(bytes / 1e6).toFixed(1)}MB on disk; ` +
    'a phone downloads about 6.8MB of it once)',
);
