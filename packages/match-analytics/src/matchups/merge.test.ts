import { describe, expect, it } from 'vitest';
import { accumulateMatchupContribution, emptyMatchupAccumulator } from './accumulation';
import { mergeMatchupAccumulatorsByOpponent } from './merge';

describe('mergeMatchupAccumulatorsByOpponent', () => {
  it('sums sampleSize and wins across exact tiers instead of averaging rates', () => {
    const diamond = accumulateMatchupContribution(emptyMatchupAccumulator(), {
      championId: 103,
      opponentChampionId: 134,
      won: true,
      goldDifferenceAt10: null,
      goldDifferenceAt15: null,
      csDifferenceAt10: null,
      csDifferenceAt15: null,
      matchEndedAt: null,
    });
    const platinum = accumulateMatchupContribution(
      accumulateMatchupContribution(emptyMatchupAccumulator(), {
        championId: 103,
        opponentChampionId: 134,
        won: false,
        goldDifferenceAt10: null,
        goldDifferenceAt15: null,
        csDifferenceAt10: null,
        csDifferenceAt15: null,
        matchEndedAt: null,
      }),
      {
        championId: 103,
        opponentChampionId: 134,
        won: false,
        goldDifferenceAt10: null,
        goldDifferenceAt15: null,
        csDifferenceAt10: null,
        csDifferenceAt15: null,
        matchEndedAt: null,
      },
    );
    const merged = mergeMatchupAccumulatorsByOpponent([
      { opponentChampionId: 134, accumulator: diamond },
      { opponentChampionId: 134, accumulator: platinum },
    ]);
    const row = merged.get(134);
    expect(row?.sampleSize).toBe(3);
    expect(row?.wins).toBe(1);
  });
});
