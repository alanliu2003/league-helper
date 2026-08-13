import type { MatchupAggregateAccumulator } from './accumulation';
import { combineMatchupAccumulators, emptyMatchupAccumulator } from './accumulation';

/**
 * Merge exact-tier matchup rows that share champion/opponent/position.
 * Sum sampleSize and wins — never average tier percentages.
 */
export function mergeMatchupAccumulatorsByOpponent(
  rows: Array<{ opponentChampionId: number; accumulator: MatchupAggregateAccumulator }>,
): Map<number, MatchupAggregateAccumulator> {
  const merged = new Map<number, MatchupAggregateAccumulator>();
  for (const row of rows) {
    const current = merged.get(row.opponentChampionId) ?? emptyMatchupAccumulator();
    merged.set(row.opponentChampionId, combineMatchupAccumulators(current, row.accumulator));
  }
  return merged;
}
