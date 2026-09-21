import { describe, expect, it } from 'vitest';
import { normalize } from '@/lib/catalogue/normalize';
import { DEMO_USERS, ITEMS, LOCATIONS } from '@/prisma/seed-data';

describe('the seeded catalogue', () => {
  it('has the 25 items and the two locations the demo expects', () => {
    expect(ITEMS).toHaveLength(25);
    expect(LOCATIONS.map((l) => l.code)).toEqual(['ED_RESUS_02', 'ED_STORE_01']);
  });

  it('has a unique SKU per item', () => {
    const skus = ITEMS.map((i) => i.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it('never maps one alias to two items', () => {
    // The database enforces this with a global unique index. Asserting it here means a
    // bad alias fails the build, rather than at 3 a.m. in a resus bay.
    const owners = new Map<string, string[]>();
    for (const item of ITEMS) {
      for (const alias of item.aliases) {
        const key = normalize(alias);
        owners.set(key, [...(owners.get(key) ?? []), item.sku]);
      }
    }
    const collisions = [...owners.entries()].filter(([, skus]) => skus.length > 1);
    expect(collisions).toEqual([]);
  });

  it('has no blank or numeric-only alias', () => {
    for (const item of ITEMS) {
      for (const alias of item.aliases) {
        expect(normalize(alias)).not.toBe('');
        expect(normalize(alias)).not.toMatch(/^\d+$/);
      }
    }
  });

  it('carries the aliases the brief calls for', () => {
    const cannula = ITEMS.find((i) => i.sku === 'IVC-18G-BLUE');
    expect(cannula?.aliases).toContain('18g blue cannula');
    expect(cannula?.aliases).toContain('blue cannula');
    expect(ITEMS.find((i) => i.sku === 'NS-FLUSH-10ML')?.aliases).toContain('saline flush');
  });

  it('stocks more than one blue cannula, so "blue cannula" is genuinely ambiguous', () => {
    const blueCannulas = ITEMS.filter((i) => /cannula/i.test(i.displayName) && /blue/i.test(i.displayName));
    expect(blueCannulas.length).toBeGreaterThan(1);
  });

  it('includes controlled and high-risk items for the restricted path', () => {
    expect(ITEMS.filter((i) => i.isControlled)).not.toHaveLength(0);
    expect(ITEMS.filter((i) => i.isHighRisk)).not.toHaveLength(0);
  });

  it('includes an item not stocked at the second location', () => {
    expect(ITEMS.filter((i) => i.storeQuantity === null)).not.toHaveLength(0);
  });

  it('puts one item one unit above its reorder threshold, so the demo raises a task', () => {
    const flush = ITEMS.find((i) => i.sku === 'NS-FLUSH-10ML');
    // "saline flush x2" takes it from 21 to 19, crossing the threshold of 20.
    expect(flush?.resusQuantity).toBe(21);
    expect(flush?.reorderThreshold).toBe(20);
  });

  it('puts one item below what the demo withdraws, so the discrepancy path is reachable', () => {
    const pads = ITEMS.find((i) => i.sku === 'DEFIB-PADS-ADULT');
    expect(pads?.resusQuantity).toBe(1);
    expect(pads?.isHighRisk).toBe(true);
  });

  it('has a positive reorder threshold and quantity on every item', () => {
    for (const item of ITEMS) {
      expect(item.reorderThreshold).toBeGreaterThan(0);
      expect(item.reorderQuantity).toBeGreaterThan(0);
      expect(item.resusQuantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('seeds one account per role', () => {
    expect(DEMO_USERS.map((u) => u.role).sort()).toEqual(['admin', 'nurse', 'supply_reviewer']);
  });
});
