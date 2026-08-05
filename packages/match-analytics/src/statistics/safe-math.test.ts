import { describe, expect, it } from 'vitest';
import { safeDivide } from './safe-math';

describe('safeDivide', () => {
  it('returns null when dividing by zero', () => {
    expect(safeDivide(1, 0)).toBeNull();
  });

  it('returns a finite quotient for valid inputs', () => {
    expect(safeDivide(6, 3)).toBe(2);
    expect(safeDivide(1, 4)).toBe(0.25);
  });

  it('returns null for non-finite numerator or denominator', () => {
    expect(safeDivide(Number.NaN, 1)).toBeNull();
    expect(safeDivide(1, Number.NaN)).toBeNull();
    expect(safeDivide(Number.POSITIVE_INFINITY, 1)).toBeNull();
    expect(safeDivide(1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(safeDivide(Number.NEGATIVE_INFINITY, 2)).toBeNull();
  });

  it('never returns NaN or Infinity', () => {
    const cases: Array<[number, number]> = [
      [1, 0],
      [0, 0],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [Number.MAX_VALUE, Number.MIN_VALUE],
    ];

    for (const [numerator, denominator] of cases) {
      const result = safeDivide(numerator, denominator);
      if (result !== null) {
        expect(Number.isFinite(result)).toBe(true);
      }
    }
  });
});
