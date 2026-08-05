import { describe, expect, it } from 'vitest';
import { MatchAnalyticsValidationError } from '../errors';
import { wilsonScoreInterval } from './wilson-interval';

describe('wilsonScoreInterval', () => {
  it('returns null for zero samples', () => {
    expect(wilsonScoreInterval(0, 0, 0.95)).toBeNull();
  });

  it('bounds all wins within [0,1]', () => {
    const r = wilsonScoreInterval(100, 100, 0.95)!;
    expect(r.lowerBound).toBeGreaterThanOrEqual(0);
    expect(r.upperBound).toBeLessThanOrEqual(1);
    expect(r.lowerBound).toBeLessThanOrEqual(r.upperBound);
  });

  it('bounds all losses within [0,1]', () => {
    const r = wilsonScoreInterval(0, 100, 0.95)!;
    expect(r.lowerBound).toBeGreaterThanOrEqual(0);
    expect(r.upperBound).toBeLessThanOrEqual(1);
    expect(r.lowerBound).toBeLessThanOrEqual(r.upperBound);
  });

  it('supports 0.90 / 0.95 / 0.99', () => {
    for (const level of [0.9, 0.95, 0.99]) {
      const r = wilsonScoreInterval(50, 100, level)!;
      expect(r.confidenceLevel).toBe(level);
      expect(r.lowerBound).toBeGreaterThanOrEqual(0);
      expect(r.upperBound).toBeLessThanOrEqual(1);
    }
  });

  it('rejects invalid confidence', () => {
    expect(() => wilsonScoreInterval(1, 2, 0)).toThrow(MatchAnalyticsValidationError);
    expect(() => wilsonScoreInterval(1, 2, 1)).toThrow(MatchAnalyticsValidationError);
    expect(() => wilsonScoreInterval(1, 2, Number.NaN)).toThrow(MatchAnalyticsValidationError);
  });

  it('rejects wins greater than sampleSize', () => {
    expect(() => wilsonScoreInterval(3, 2, 0.95)).toThrow(MatchAnalyticsValidationError);
    try {
      wilsonScoreInterval(3, 2, 0.95);
    } catch (error) {
      expect(error).toBeInstanceOf(MatchAnalyticsValidationError);
      expect((error as MatchAnalyticsValidationError).code).toBe('INVALID_WINS');
    }
  });

  it('rejects negative wins', () => {
    expect(() => wilsonScoreInterval(-1, 10, 0.95)).toThrow(MatchAnalyticsValidationError);
    try {
      wilsonScoreInterval(-1, 10, 0.95);
    } catch (error) {
      expect(error).toBeInstanceOf(MatchAnalyticsValidationError);
      expect((error as MatchAnalyticsValidationError).code).toBe('INVALID_WINS');
    }
  });
});
