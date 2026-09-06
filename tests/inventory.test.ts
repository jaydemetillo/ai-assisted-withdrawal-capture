import { describe, expect, it } from 'vitest';
import { deltaFor } from '@/lib/inventory';

/**
 * The arithmetic that the ledger depends on. The database-level behaviour
 * (recompute after commit / edit / void) is covered end-to-end by
 * `npm run verify`, which runs against a live server and a real database.
 */
describe('deltaFor', () => {
  it('subtracts for a withdrawal', () => {
    expect(deltaFor('WITHDRAW', 3)).toBe(-3);
  });

  it('subtracts for a disposal too - same arithmetic, different meaning', () => {
    expect(deltaFor('DISPOSE', 3)).toBe(-3);
  });

  it('never lets a stray negative quantity add stock back', () => {
    expect(deltaFor('WITHDRAW', -3)).toBe(-3);
  });

  it('handles zero', () => {
    expect(deltaFor('WITHDRAW', 0)).toBe(-0);
  });
});

describe('stock derivation', () => {
  // Mirrors recomputeStock: opening + sum of deltas, never an in-place patch.
  const derive = (opening: number, deltas: number[]) => opening + deltas.reduce((a, b) => a + b, 0);

  it('reproduces the headline example', () => {
    expect(derive(130, [deltaFor('WITHDRAW', 3)])).toBe(127);
  });

  it('a correction replaces rather than compounds', () => {
    // Admin changes 3 -> 5. Replaying gives 125, not 130-3-5=122.
    expect(derive(130, [deltaFor('WITHDRAW', 5)])).toBe(125);
  });

  it('voiding restores the opening balance', () => {
    expect(derive(130, [])).toBe(130);
  });

  it('accumulates across several transactions', () => {
    expect(derive(130, [-3, -4, -10])).toBe(113);
  });
});
