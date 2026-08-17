/**
 * Pure merge helpers for deriving segment analytics from exact-tier ChampionAggregate rows.
 *
 * Additive persisted totals may be summed. Ratios/rates must be recomputed from numerators
 * and denominators — never averaged across tiers.
 */

export type MergeableChampionAggregateTotals = {
  sampleSize: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCs: number;
  totalGameSeconds: number;
  totalDamageToChampions: number;
  totalVisionScore: number;
  totalGoldEarned: number;
  totalGoldDifferenceAt10: number | null;
  goldDifferenceAt10Samples: number;
  totalGoldDifferenceAt15: number | null;
  goldDifferenceAt15Samples: number;
  totalCsDifferenceAt10: number | null;
  csDifferenceAt10Samples: number;
  totalCsDifferenceAt15: number | null;
  csDifferenceAt15Samples: number;
};

export function emptyMergeableChampionAggregateTotals(): MergeableChampionAggregateTotals {
  return {
    sampleSize: 0,
    wins: 0,
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalCs: 0,
    totalGameSeconds: 0,
    totalDamageToChampions: 0,
    totalVisionScore: 0,
    totalGoldEarned: 0,
    totalGoldDifferenceAt10: null,
    goldDifferenceAt10Samples: 0,
    totalGoldDifferenceAt15: null,
    goldDifferenceAt15Samples: 0,
    totalCsDifferenceAt10: null,
    csDifferenceAt10Samples: 0,
    totalCsDifferenceAt15: null,
    csDifferenceAt15Samples: 0,
  };
}

function combineOptionalTotals(
  leftTotal: number | null,
  leftSamples: number,
  rightTotal: number | null,
  rightSamples: number,
): { total: number | null; samples: number } {
  if (leftTotal === null && rightTotal === null) {
    return { total: null, samples: 0 };
  }
  if (leftTotal === null) {
    return { total: rightTotal, samples: rightSamples };
  }
  if (rightTotal === null) {
    return { total: leftTotal, samples: leftSamples };
  }
  return { total: leftTotal + rightTotal, samples: leftSamples + rightSamples };
}

function mergeTwo(
  left: MergeableChampionAggregateTotals,
  right: MergeableChampionAggregateTotals,
): MergeableChampionAggregateTotals {
  const gold10 = combineOptionalTotals(
    left.totalGoldDifferenceAt10,
    left.goldDifferenceAt10Samples,
    right.totalGoldDifferenceAt10,
    right.goldDifferenceAt10Samples,
  );
  const gold15 = combineOptionalTotals(
    left.totalGoldDifferenceAt15,
    left.goldDifferenceAt15Samples,
    right.totalGoldDifferenceAt15,
    right.goldDifferenceAt15Samples,
  );
  const cs10 = combineOptionalTotals(
    left.totalCsDifferenceAt10,
    left.csDifferenceAt10Samples,
    right.totalCsDifferenceAt10,
    right.csDifferenceAt10Samples,
  );
  const cs15 = combineOptionalTotals(
    left.totalCsDifferenceAt15,
    left.csDifferenceAt15Samples,
    right.totalCsDifferenceAt15,
    right.csDifferenceAt15Samples,
  );

  return {
    sampleSize: left.sampleSize + right.sampleSize,
    wins: left.wins + right.wins,
    totalKills: left.totalKills + right.totalKills,
    totalDeaths: left.totalDeaths + right.totalDeaths,
    totalAssists: left.totalAssists + right.totalAssists,
    totalCs: left.totalCs + right.totalCs,
    totalGameSeconds: left.totalGameSeconds + right.totalGameSeconds,
    totalDamageToChampions: left.totalDamageToChampions + right.totalDamageToChampions,
    totalVisionScore: left.totalVisionScore + right.totalVisionScore,
    totalGoldEarned: left.totalGoldEarned + right.totalGoldEarned,
    totalGoldDifferenceAt10: gold10.total,
    goldDifferenceAt10Samples: gold10.samples,
    totalGoldDifferenceAt15: gold15.total,
    goldDifferenceAt15Samples: gold15.samples,
    totalCsDifferenceAt10: cs10.total,
    csDifferenceAt10Samples: cs10.samples,
    totalCsDifferenceAt15: cs15.total,
    csDifferenceAt15Samples: cs15.samples,
  };
}

export function mergeChampionAggregateTotals(
  rows: readonly MergeableChampionAggregateTotals[],
): MergeableChampionAggregateTotals {
  if (rows.length === 0) {
    return emptyMergeableChampionAggregateTotals();
  }
  return rows.reduce((acc, row) => mergeTwo(acc, row));
}

/** Weighted win rate from additive totals. Null when sampleSize is 0. */
export function deriveSegmentWinRate(
  totals: Pick<MergeableChampionAggregateTotals, 'sampleSize' | 'wins'>,
): number | null {
  if (totals.sampleSize <= 0) {
    return null;
  }
  return totals.wins / totals.sampleSize;
}
