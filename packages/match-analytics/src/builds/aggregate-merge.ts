export type MergeableBuildTotals = {
  sampleSize: number;
  wins: number;
  eligibleGames: number;
};

export function emptyBuildTotals(): MergeableBuildTotals {
  return { sampleSize: 0, wins: 0, eligibleGames: 0 };
}

export function mergeBuildAggregateTotals(
  rows: readonly MergeableBuildTotals[],
): MergeableBuildTotals {
  return rows.reduce(
    (acc, row) => ({
      sampleSize: acc.sampleSize + row.sampleSize,
      wins: acc.wins + row.wins,
      eligibleGames: acc.eligibleGames + row.eligibleGames,
    }),
    emptyBuildTotals(),
  );
}

export function winRate(totals: Pick<MergeableBuildTotals, 'sampleSize' | 'wins'>): number | null {
  if (totals.sampleSize <= 0) {
    return null;
  }
  return totals.wins / totals.sampleSize;
}

export function pickRate(
  totals: Pick<MergeableBuildTotals, 'sampleSize' | 'eligibleGames'>,
): number | null {
  if (totals.eligibleGames <= 0) {
    return null;
  }
  return totals.sampleSize / totals.eligibleGames;
}
