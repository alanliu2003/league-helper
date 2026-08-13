import {
  buildChampionAggregateDimensionKey,
  type ChampionBuildCategory,
  type MaterializedChampionDimensions,
} from '@league-helper/match-analytics';

export type BuildAggregateScratchRow = {
  dims: MaterializedChampionDimensions;
  category: ChampionBuildCategory;
  signature: string;
  entityIds: number[];
  auxIds: number[];
  primaryStyleId: number | null;
  secondaryStyleId: number | null;
  sampleSize: number;
  wins: number;
  latestEligibleMatchAt: Date | null;
};

export type BuildAggregateScratch = {
  rows: Map<string, BuildAggregateScratchRow>;
  pools: Map<string, number>;
};

function poolKey(dims: MaterializedChampionDimensions, category: ChampionBuildCategory): string {
  return `${buildChampionAggregateDimensionKey(dims)}:${category}`;
}

function rowKey(
  dims: MaterializedChampionDimensions,
  category: ChampionBuildCategory,
  signature: string,
): string {
  return `${poolKey(dims, category)}:${signature}`;
}

export function recordBuildContribution(
  scratch: BuildAggregateScratch,
  input: {
    dims: MaterializedChampionDimensions;
    category: ChampionBuildCategory;
    signature: string;
    entityIds: number[];
    auxIds: number[];
    primaryStyleId: number | null;
    secondaryStyleId: number | null;
    won: boolean;
    matchEndedAt: Date | null;
  },
): void {
  const pKey = poolKey(input.dims, input.category);
  scratch.pools.set(pKey, (scratch.pools.get(pKey) ?? 0) + 1);

  const rKey = rowKey(input.dims, input.category, input.signature);
  const existing = scratch.rows.get(rKey);
  if (!existing) {
    scratch.rows.set(rKey, {
      dims: input.dims,
      category: input.category,
      signature: input.signature,
      entityIds: input.entityIds,
      auxIds: input.auxIds,
      primaryStyleId: input.primaryStyleId,
      secondaryStyleId: input.secondaryStyleId,
      sampleSize: 1,
      wins: input.won ? 1 : 0,
      latestEligibleMatchAt: input.matchEndedAt,
    });
    return;
  }
  existing.sampleSize += 1;
  existing.wins += input.won ? 1 : 0;
  if (
    input.matchEndedAt &&
    (!existing.latestEligibleMatchAt || input.matchEndedAt > existing.latestEligibleMatchAt)
  ) {
    existing.latestEligibleMatchAt = input.matchEndedAt;
  }
}

export type MaterializedBuildRow = BuildAggregateScratchRow & { eligibleGames: number };

export function attachEligibleGames(scratch: BuildAggregateScratch): MaterializedBuildRow[] {
  const rows: MaterializedBuildRow[] = [];
  for (const row of scratch.rows.values()) {
    rows.push({
      ...row,
      eligibleGames: scratch.pools.get(poolKey(row.dims, row.category)) ?? 0,
    });
  }
  return rows;
}
