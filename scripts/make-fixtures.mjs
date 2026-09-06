/**
 * Generates the handwritten-note test fixtures in fixtures/notes/.
 *
 * These stand in for a nurse's scribbled list: they are rendered with real
 * handwriting typefaces onto a paper-ish background, slightly rotated and
 * lit unevenly so the OCR path sees something closer to a phone photo than to
 * clean text. Each note has a matching ground truth in fixtures/notes/expected.json,
 * which is what tests/ocr-live.test.ts and `npm run ocr:check` assert against.
 *
 * Regenerate with:  node scripts/make-fixtures.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'fixtures', 'notes');
const TMP = path.join(process.cwd(), '.fixture-build');

function findChrome() {
  const explicit = process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    for (const dir of readdirSync(root)) {
      const p = path.join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium-browser']) {
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found. Set CHROME_PATH to a Chrome/Chromium binary.');
}

/** @type {{slug:string,font:string,size:number,rotate:number,ink:string,lines:string[]}[]} */
const NOTES = [
  {
    slug: 'withdraw-basic',
    font: 'Caveat',
    size: 46,
    rotate: -1.4,
    ink: '#1e3a8a',
    lines: ['Ward 411 - S15 Medical', '', '3x Masks', '4x Syringes', '5x Saline', '', 'Withdrawn', '- A. Rahman'],
  },
  {
    slug: 'dispose-expired',
    font: 'Indie Flower',
    size: 38,
    rotate: 1.1,
    ink: '#111827',
    lines: ['12 x Gauze pads', '2 x ETCO2 sensor', '6 x Alcohol swabs', '', 'DISPOSED - expired batch', 'checked by Fang'],
  },
  {
    slug: 'messy-mixed',
    font: 'Caveat',
    size: 42,
    rotate: -2.6,
    ink: '#1f2937',
    lines: ['Gloves (M) x 2 boxes', 'Syringe 10ml  - 8', 'NS 500ml ...... 3', 'ECG electrodes x10', '', 'taken out for ward round', 'withdrawn'],
  },
  {
    slug: 'low-confidence',
    font: 'Indie Flower',
    size: 36,
    rotate: 2.2,
    ink: '#334155',
    lines: ['4 x thermmtr prb cvrs', '2 x foly cath 16', '?? x biohzd bags', '', 'withdrawn'],
  },
];

const FONT_FILES = { Caveat: 'caveat.woff2', 'Indie Flower': 'indie-flower.woff2' };

/**
 * Fonts are embedded as data URIs rather than pulled from Google Fonts at render
 * time: the generator then works offline, and a silent font-fetch failure can't
 * quietly downgrade the "handwriting" to a serif fallback (which would make the
 * fixtures a test of printed text instead of handwriting).
 */
function fontFace(family) {
  const file = path.join(process.cwd(), 'fixtures', 'fonts', FONT_FILES[family]);
  if (!existsSync(file)) throw new Error(`Missing font ${file}. See fixtures/fonts/README.md`);
  const b64 = readFileSync(file).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:block;` +
    `src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}

function html(note) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  ${fontFace(note.font)}
  html,body{margin:0;padding:0;width:900px;height:1200px;overflow:hidden}
  body{
    background:
      radial-gradient(120% 90% at 25% 8%, rgba(255,255,255,.95) 0%, rgba(238,236,228,.9) 55%, rgba(206,203,193,.95) 100%),
      #efece3;
  }
  .sheet{
    position:absolute; inset:60px 55px; background:#fbfaf5;
    box-shadow:0 18px 44px rgba(0,0,0,.22), inset 0 0 90px rgba(180,175,160,.30);
    transform:rotate(${note.rotate}deg);
    padding:78px 70px;
    background-image:repeating-linear-gradient(0deg, transparent 0 63px, rgba(120,140,180,.18) 63px 64px);
  }
  .line{
    font-family:'${note.font}', cursive;
    font-size:${note.size}px; line-height:64px; color:${note.ink};
    white-space:pre; letter-spacing:.4px;
  }
  /* uneven pen pressure and baseline drift, so this reads as written not typeset */
  .line:nth-child(3n){opacity:.9}
  .line:nth-child(4n){opacity:.97; transform:translateX(3px) rotate(-.35deg)}
  .line:nth-child(5n){transform:translateX(-2px) rotate(.28deg)}
  .line:nth-child(7n){transform:translateX(5px) rotate(.18deg)}
  .glare{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(112deg, rgba(255,255,255,.30) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,.06) 100%);}
</style></head><body>
<div class="sheet">${note.lines.map((l) => `<div class="line">${l === '' ? '&nbsp;' : l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`).join('')}</div>
<div class="glare"></div>
</body></html>`;
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const chrome = findChrome();
console.log('chromium:', chrome);

for (const note of NOTES) {
  const htmlPath = path.join(TMP, `${note.slug}.html`);
  const pngPath = path.join(OUT, `${note.slug}.png`);
  writeFileSync(htmlPath, html(note));
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--virtual-time-budget=6000',
      '--window-size=900,1200',
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: 'pipe' },
  );
  console.log('wrote', path.relative(process.cwd(), pngPath));
}
console.log('\nDone. Ground truth lives in fixtures/notes/expected.json');
