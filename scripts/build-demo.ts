/**
 * Generates public/demo.html from scripts/demo.template.html, injecting the catalogue
 * from lib/catalogue.ts so the standalone demo and the real app can never disagree
 * about item names, aliases or opening counts.
 *
 * Runs as part of `npm run build`; run it directly with `npm run demo:build`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOGUE } from '../lib/catalogue';

const compact = CATALOGUE.map((i) => ({
  sku: i.sku, name: i.name, unit: i.unit, opening: i.opening, aliases: i.aliases,
}));

const template = readFileSync('scripts/demo.template.html', 'utf8');
if (!template.includes('__CATALOGUE__')) {
  throw new Error('scripts/demo.template.html no longer contains the __CATALOGUE__ placeholder');
}

const html = template.replace('__CATALOGUE__', JSON.stringify(compact));
writeFileSync('public/demo.html', html);
console.log(`[demo] public/demo.html written with ${compact.length} items`);
