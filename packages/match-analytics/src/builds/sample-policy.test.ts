import { describe, expect, it } from 'vitest';
import {
  BUILD_DISPLAY_CREDIBLE_MIN,
  BUILD_DISPLAY_EXPLORATORY_MIN,
  BUILD_DISPLAY_STRONG_MIN,
  classifyBuildSampleDisplay,
} from './sample-policy';
import { mergeBuildAggregateTotals, pickRate, winRate } from './aggregate-merge';

describe('classifyBuildSampleDisplay', () => {
  it('uses a lower floor than champion ranking (30)', () => {
    expect(BUILD_DISPLAY_EXPLORATORY_MIN).toBe(5);
    expect(BUILD_DISPLAY_CREDIBLE_MIN).toBe(10);
    expect(BUILD_DISPLAY_STRONG_MIN).toBe(20);
    expect(classifyBuildSampleDisplay(1)).toEqual({
      band: 'BELOW_DISPLAY',
      lowSample: true,
      exposeWinRate: false,
    });
    expect(classifyBuildSampleDisplay(5).band).toBe('EXPLORATORY');
    expect(classifyBuildSampleDisplay(10).band).toBe('CREDIBLE');
    expect(classifyBuildSampleDisplay(20).band).toBe('STRONG');
    expect(classifyBuildSampleDisplay(4).exposeWinRate).toBe(false);
    expect(classifyBuildSampleDisplay(5).exposeWinRate).toBe(true);
  });
});

describe('mergeBuildAggregateTotals', () => {
  it('adds sampleSize, wins, and eligibleGames and does not average percentages', () => {
    const merged = mergeBuildAggregateTotals([
      { sampleSize: 10, wins: 6, eligibleGames: 40 },
      { sampleSize: 30, wins: 3, eligibleGames: 60 },
    ]);
    expect(merged).toEqual({ sampleSize: 40, wins: 9, eligibleGames: 100 });
    expect(winRate(merged)).toBe(0.225);
    expect(pickRate(merged)).toBe(0.4);
    expect((0.6 + 0.1) / 2).not.toBe(winRate(merged));
  });

  it('returns null rates when the denominator is zero', () => {
    expect(winRate({ sampleSize: 0, wins: 0, eligibleGames: 0 })).toBeNull();
    expect(pickRate({ sampleSize: 0, wins: 0, eligibleGames: 0 })).toBeNull();
  });
});
