import { describe, expect, it } from 'vitest';
import { redactKey } from '@/lib/log';

/**
 * Log hygiene, enforced by a test rather than by review.
 *
 * The rule the application relies on: a log line may say how LONG something was, never
 * what it said. An image's key is fine; its bytes are not. A candidate's count is fine;
 * its text is not.
 */
describe('log redaction', () => {
  it.each([
    'rawText',
    'text',
    'imageData',
    'photo',
    'body',
    'prompt',
    'note',
    'comment',
    'transcript',
    'decisionMessage',
    'providerReason',
    'password',
    'apiKey',
    'ANTHROPIC_API_KEY',
    'sessionToken',
    'clientSecret',
    'authorization',
  ])('redacts %s', (key) => {
    expect(redactKey(key)).toBe(true);
  });

  it.each([
    'rawTextLength',
    'imageKey',
    'imageBytes',
    'photoBytes',
    'candidateCount',
    'submissionId',
    'locationCode',
    'provider',
    'model',
    'decision',
    'reasonCode',
    'status',
  ])('allows %s', (key) => {
    expect(redactKey(key)).toBe(false);
  });
});
