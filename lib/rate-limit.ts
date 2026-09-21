import { log } from '@/lib/log';

/**
 * A small fixed-window rate limiter, per process.
 *
 * Honest about what it is: this lives in memory, so it limits one instance rather than a
 * deployment, and it resets on restart. It is here to stop an accidental loop or a stuck
 * retry from uploading a thousand photos — not to stop a determined attacker. A real
 * deployment puts this in Redis or at the edge, and the README says so.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowSeconds: number, now = Date.now()): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    // Opportunistic cleanup, so a long-running process does not accumulate dead keys.
    if (windows.size > 5000) {
      for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    }
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count++;
  if (existing.count > limit) {
    log.warn('rate limit hit', { key: key.slice(0, 40), limit });
    return { ok: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Test seam. */
export function resetRateLimits(): void {
  windows.clear();
}
