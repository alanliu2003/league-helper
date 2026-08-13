import { describe, expect, it } from 'vitest';
import { mergeBuildAggregateTotals, pickRate, winRate } from './aggregate-merge';

describe('mergeBuildAggregateTotals', () => {
  it('adds sampleSize and wins without averaging percentages', () => {
    const merged = mergeBuildAggregateTotals([
      { sampleSize: 10, wins: 8, eligibleGames: 20 },
      { sampleSize: 10, wins: 2, eligibleGames: 20 },
    ]);
    expect(merged).toEqual({ sampleSize: 20, wins: 10, eligibleGames: 40 });
    expect(winRate(merged)).toBe(0.5);
    expect(pickRate(merged)).toBe(0.5);
    expect((0.8 + 0.2) / 2).toBe(0.5);
    expect(winRate({ sampleSize: 10, wins: 8 })).toBe(0.8);
  });
});
