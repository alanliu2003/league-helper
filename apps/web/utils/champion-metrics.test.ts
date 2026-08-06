import { describe, expect, it } from 'vitest';
import {
  deriveLosses,
  formatChampionMetric,
  formatChampionRate,
  formatWilsonInterval,
} from './champion-metrics';

describe('champion-metrics formatting', () => {
  it('does not render zeros for missing rates or metrics', () => {
    expect(formatChampionRate(null)).toBe('Unavailable');
    expect(formatChampionRate(Number.NaN)).toBe('Unavailable');
    expect(formatChampionRate(Number.POSITIVE_INFINITY)).toBe('Unavailable');
    expect(formatChampionMetric(null)).toBe('Unavailable');
    expect(formatChampionMetric(Number.NaN)).toBe('Unavailable');
    expect(formatWilsonInterval(null)).toBe('Unavailable');
  });

  it('formats finite rates and signed diffs without inventing values', () => {
    expect(formatChampionRate(0.523)).toBe('52.3%');
    expect(formatChampionMetric(0)).toBe('0.00');
    expect(formatChampionMetric(12.5, { signed: true, digits: 1 })).toBe('+12.5');
    expect(formatChampionMetric(-3.2, { signed: true, digits: 1 })).toBe('-3.2');
  });

  it('derives losses from sampleSize - wins', () => {
    expect(deriveLosses(100, 55)).toBe(45);
    expect(deriveLosses(10, 12)).toBe(0);
  });
});
