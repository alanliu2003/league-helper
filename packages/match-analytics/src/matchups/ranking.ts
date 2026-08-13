import { wilsonScoreInterval } from '../statistics/wilson-interval';
import {
  MATCHUP_DISPLAY_FLOOR,
  MATCHUP_RANKING_POLICY,
  MATCHUP_RANKING_TOP_N,
  type MatchupRankingPolicy,
} from './policy';

export type RankableMatchupRow = {
  opponentChampionId: number;
  position: string;
  sampleSize: number;
  wins: number;
  winRate: number | null;
};

export type RankedMatchupLists<T extends RankableMatchupRow> = {
  strongAgainst: T[];
  weakAgainst: T[];
  eligibleCount: number;
  rankingPolicy: MatchupRankingPolicy;
  displayFloor: number;
};

function wilsonLower(wins: number, sampleSize: number, confidenceLevel: number): number {
  return wilsonScoreInterval(wins, sampleSize, confidenceLevel)?.lowerBound ?? 0;
}

function compareStrong<T extends RankableMatchupRow>(
  left: T,
  right: T,
  confidenceLevel: number,
): number {
  const lowerDelta =
    wilsonLower(right.wins, right.sampleSize, confidenceLevel) -
    wilsonLower(left.wins, left.sampleSize, confidenceLevel);
  if (lowerDelta !== 0) {
    return lowerDelta;
  }
  const winRateDelta = (right.winRate ?? 0) - (left.winRate ?? 0);
  if (winRateDelta !== 0) {
    return winRateDelta;
  }
  if (right.sampleSize !== left.sampleSize) {
    return right.sampleSize - left.sampleSize;
  }
  return left.opponentChampionId - right.opponentChampionId;
}

function compareWeak<T extends RankableMatchupRow>(
  left: T,
  right: T,
  confidenceLevel: number,
): number {
  const lowerDelta =
    wilsonLower(left.wins, left.sampleSize, confidenceLevel) -
    wilsonLower(right.wins, right.sampleSize, confidenceLevel);
  if (lowerDelta !== 0) {
    return lowerDelta;
  }
  const winRateDelta = (left.winRate ?? 0) - (right.winRate ?? 0);
  if (winRateDelta !== 0) {
    return winRateDelta;
  }
  if (right.sampleSize !== left.sampleSize) {
    return right.sampleSize - left.sampleSize;
  }
  return left.opponentChampionId - right.opponentChampionId;
}

/**
 * Split eligible matchups into Strong Against (subject winRate > 0.5) and
 * Weak Against (subject winRate < 0.5). Neutral 50% rows are neither.
 * Ranking uses Wilson lower bound so 1–0 cannot outrank a large losing sample
 * that still clears the display floor.
 */
export function rankStrongAndWeakMatchups<T extends RankableMatchupRow>(
  rows: readonly T[],
  options: { displayFloor?: number; confidenceLevel: number; topN?: number } = {
    confidenceLevel: 0.95,
  },
): RankedMatchupLists<T> {
  const displayFloor = options.displayFloor ?? MATCHUP_DISPLAY_FLOOR;
  const topN = options.topN ?? MATCHUP_RANKING_TOP_N;
  const eligible = rows.filter((row) => row.sampleSize >= displayFloor && row.winRate !== null);

  const strongAgainst = eligible
    .filter((row) => (row.winRate ?? 0) > 0.5)
    .sort((left, right) => compareStrong(left, right, options.confidenceLevel))
    .slice(0, topN);
  const weakAgainst = eligible
    .filter((row) => (row.winRate ?? 0) < 0.5)
    .sort((left, right) => compareWeak(left, right, options.confidenceLevel))
    .slice(0, topN);

  return {
    strongAgainst,
    weakAgainst,
    eligibleCount: eligible.length,
    rankingPolicy: MATCHUP_RANKING_POLICY,
    displayFloor,
  };
}
