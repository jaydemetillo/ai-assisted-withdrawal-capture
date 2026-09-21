import { describe, expect, it } from 'vitest';
import { DEFAULT_DECISION_CONFIG, loadDecisionConfig } from '@/lib/decision/config';

describe('loadDecisionConfig', () => {
  it('uses the documented defaults when nothing is set', () => {
    expect(loadDecisionConfig({})).toEqual(DEFAULT_DECISION_CONFIG);
  });

  it('defaults to the safe end of every switch', () => {
    const config = loadDecisionConfig({});
    expect(config.confidenceThreshold).toBe(0.9);
    expect(config.restrictedSelfConfirm).toBe(false);
    expect(config.negativeStockPolicy).toBe('allow_with_discrepancy');
  });

  it('reads every value from the environment', () => {
    const config = loadDecisionConfig({
      CONFIDENCE_THRESHOLD: '0.75',
      MAX_LINE_QUANTITY: '10',
      NEGATIVE_STOCK_POLICY: 'block',
      RESTRICTED_SELF_CONFIRM: 'true',
      CONFIRM_MAX_RETRIES: '5',
    });
    expect(config).toEqual({
      confidenceThreshold: 0.75,
      maxLineQuantity: 10,
      negativeStockPolicy: 'block',
      restrictedSelfConfirm: true,
      confirmMaxRetries: 5,
    });
  });

  it('treats an empty variable as unset rather than as zero', () => {
    expect(loadDecisionConfig({ CONFIDENCE_THRESHOLD: '' }).confidenceThreshold).toBe(0.9);
  });

  it.each([
    ['CONFIDENCE_THRESHOLD', '1.5'],
    ['CONFIDENCE_THRESHOLD', 'high'],
    ['MAX_LINE_QUANTITY', '-1'],
    ['NEGATIVE_STOCK_POLICY', 'ignore'],
    ['RESTRICTED_SELF_CONFIRM', 'maybe'],
  ])('refuses to start on a malformed %s', (key, value) => {
    // A typo silently falling back to a default would mean a deployment running safety
    // rules nobody intended. Failing loudly is the point.
    expect(() => loadDecisionConfig({ [key]: value })).toThrow(/Invalid decision-rule configuration/);
  });
});
