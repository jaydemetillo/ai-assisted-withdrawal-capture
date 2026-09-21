import { beforeEach, describe, expect, it } from 'vitest';
import { rateLimit, resetRateLimits } from '@/lib/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('allows up to the limit and then refuses', () => {
    for (let i = 0; i < 3; i++) expect(rateLimit('k', 3, 60).ok).toBe(true);
    expect(rateLimit('k', 3, 60).ok).toBe(false);
  });

  it('tells the caller how long to wait', () => {
    for (let i = 0; i < 3; i++) rateLimit('k', 3, 60);
    expect(rateLimit('k', 3, 60).retryAfterSeconds).toBeGreaterThan(0);
  });

  it('opens a fresh window once the old one has passed', () => {
    const start = Date.now();
    for (let i = 0; i < 3; i++) rateLimit('k', 3, 60, start);
    expect(rateLimit('k', 3, 60, start).ok).toBe(false);
    expect(rateLimit('k', 3, 60, start + 61_000).ok).toBe(true);
  });

  it('keeps separate counts per key, so one user cannot lock out another', () => {
    for (let i = 0; i < 3; i++) rateLimit('nurse-a', 3, 60);
    expect(rateLimit('nurse-a', 3, 60).ok).toBe(false);
    expect(rateLimit('nurse-b', 3, 60).ok).toBe(true);
  });
});
