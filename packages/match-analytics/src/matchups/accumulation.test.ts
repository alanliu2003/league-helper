import { describe, expect, it } from 'vitest';
import {
  accumulateMatchupContribution,
  emptyMatchupAccumulator,
} from './accumulation';

describe('matchup accumulation', () => {
  it('adds sample and wins without inventing lane diffs', () => {
    const first = accumulateMatchupContribution(emptyMatchupAccumulator(), {
      championId: 103,
      opponentChampionId: 134,
      won: true,
      goldDifferenceAt10: 200,
      goldDifferenceAt15: null,
      csDifferenceAt10: null,
      csDifferenceAt15: null,
      matchEndedAt: null,
    });
    const second = accumulateMatchupContribution(first, {
      championId: 103,
      opponentChampionId: 134,
      won: false,
      goldDifferenceAt10: null,
      goldDifferenceAt15: null,
      csDifferenceAt10: null,
      csDifferenceAt15: null,
      matchEndedAt: null,
    });
    expect(second.sampleSize).toBe(2);
    expect(second.wins).toBe(1);
    expect(second.totalGoldDifferenceAt10).toBe(200);
    expect(second.goldDifferenceAt10Samples).toBe(1);
    expect(second.goldDifferenceAt15Samples).toBe(0);
    expect(second.totalGoldDifferenceAt15).toBeNull();
  });

  it('rejects same-champion mirrors', () => {
    expect(() =>
      accumulateMatchupContribution(emptyMatchupAccumulator(), {
        championId: 103,
        opponentChampionId: 103,
        won: true,
        goldDifferenceAt10: null,
        goldDifferenceAt15: null,
        csDifferenceAt10: null,
        csDifferenceAt15: null,
        matchEndedAt: null,
      }),
    ).toThrow(/must not equal opponentChampionId/);
  });
});
