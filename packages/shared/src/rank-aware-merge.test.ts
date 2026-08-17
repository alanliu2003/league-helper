import { describe, expect, it } from 'vitest';
import {
  deriveSegmentWinRate,
  emptyMergeableChampionAggregateTotals,
  mergeChampionAggregateTotals,
  type MergeableChampionAggregateTotals,
} from './rank-aware-merge';

function totals(
  partial: Partial<MergeableChampionAggregateTotals> &
    Pick<MergeableChampionAggregateTotals, 'sampleSize' | 'wins'>,
): MergeableChampionAggregateTotals {
  return {
    ...emptyMergeableChampionAggregateTotals(),
    ...partial,
  };
}

describe('rank-aware aggregate merge', () => {
  it('sums sampleSize and wins across exact-tier rows', () => {
    const merged = mergeChampionAggregateTotals([
      totals({ sampleSize: 10, wins: 6 }),
      totals({ sampleSize: 20, wins: 8 }),
      totals({ sampleSize: 5, wins: 1 }),
    ]);
    expect(merged.sampleSize).toBe(35);
    expect(merged.wins).toBe(15);
  });

  it('calculates weighted winRate from summed wins/sampleSize', () => {
    const a = totals({ sampleSize: 10, wins: 9 }); // 90%
    const b = totals({ sampleSize: 90, wins: 45 }); // 50%
    const merged = mergeChampionAggregateTotals([a, b]);
    // Must NOT be (0.9 + 0.5) / 2 = 0.7
    expect(deriveSegmentWinRate(merged)).toBeCloseTo(54 / 100, 10);
    expect(deriveSegmentWinRate(merged)).not.toBeCloseTo(0.7, 5);
  });

  it('does not average precomputed percentages naively', () => {
    const leftRate = 1.0;
    const rightRate = 0.0;
    const merged = mergeChampionAggregateTotals([
      totals({ sampleSize: 1, wins: 1 }),
      totals({ sampleSize: 99, wins: 0 }),
    ]);
    const naiveAverage = (leftRate + rightRate) / 2;
    expect(deriveSegmentWinRate(merged)).toBeCloseTo(0.01, 10);
    expect(deriveSegmentWinRate(merged)).not.toBeCloseTo(naiveAverage, 5);
  });

  it('handles zero samples', () => {
    const merged = mergeChampionAggregateTotals([]);
    expect(merged.sampleSize).toBe(0);
    expect(merged.wins).toBe(0);
    expect(deriveSegmentWinRate(merged)).toBeNull();

    const zeroRows = mergeChampionAggregateTotals([
      totals({ sampleSize: 0, wins: 0 }),
      totals({ sampleSize: 0, wins: 0 }),
    ]);
    expect(zeroRows.sampleSize).toBe(0);
    expect(deriveSegmentWinRate(zeroRows)).toBeNull();
  });

  it('merges additive counters and optional timeline totals safely', () => {
    const merged = mergeChampionAggregateTotals([
      totals({
        sampleSize: 2,
        wins: 1,
        totalKills: 10,
        totalDeaths: 4,
        totalAssists: 8,
        totalCs: 300,
        totalGameSeconds: 1800,
        totalDamageToChampions: 20000,
        totalVisionScore: 40,
        totalGoldEarned: 8000,
        totalGoldDifferenceAt10: 100,
        goldDifferenceAt10Samples: 2,
        totalCsDifferenceAt15: null,
        csDifferenceAt15Samples: 0,
      }),
      totals({
        sampleSize: 3,
        wins: 2,
        totalKills: 15,
        totalDeaths: 6,
        totalAssists: 12,
        totalCs: 450,
        totalGameSeconds: 2700,
        totalDamageToChampions: 30000,
        totalVisionScore: 60,
        totalGoldEarned: 12000,
        totalGoldDifferenceAt10: 50,
        goldDifferenceAt10Samples: 1,
        totalCsDifferenceAt15: 30,
        csDifferenceAt15Samples: 3,
      }),
    ]);

    expect(merged.totalKills).toBe(25);
    expect(merged.totalDeaths).toBe(10);
    expect(merged.totalAssists).toBe(20);
    expect(merged.totalCs).toBe(750);
    expect(merged.totalGameSeconds).toBe(4500);
    expect(merged.totalDamageToChampions).toBe(50000);
    expect(merged.totalVisionScore).toBe(100);
    expect(merged.totalGoldEarned).toBe(20000);
    expect(merged.totalGoldDifferenceAt10).toBe(150);
    expect(merged.goldDifferenceAt10Samples).toBe(3);
    expect(merged.totalCsDifferenceAt15).toBe(30);
    expect(merged.csDifferenceAt15Samples).toBe(3);
  });

  it('starts empty mergeable totals with zero totalGoldEarned', () => {
    expect(emptyMergeableChampionAggregateTotals().totalGoldEarned).toBe(0);
  });

  it('uses deterministic input ordering independence for additive merge', () => {
    const a = totals({ sampleSize: 7, wins: 3, totalKills: 1 });
    const b = totals({ sampleSize: 11, wins: 5, totalKills: 2 });
    const c = totals({ sampleSize: 13, wins: 4, totalKills: 3 });
    expect(mergeChampionAggregateTotals([a, b, c])).toEqual(
      mergeChampionAggregateTotals([c, a, b]),
    );
  });
});
