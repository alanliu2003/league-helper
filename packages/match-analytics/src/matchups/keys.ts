export type MatchupAggregateDimensions = {
  readonly patch: string;
  readonly platformRoute: string;
  readonly regionalRoute: string;
  readonly queueId: number;
  readonly rankTier: string;
  readonly position: string;
  readonly championId: number;
  readonly opponentChampionId: number;
  readonly sourceNormalizationVersion: string;
  readonly aggregationVersion: string;
};

export function buildMatchupAggregateDimensionKey(dims: MatchupAggregateDimensions): string {
  return JSON.stringify([
    dims.patch,
    dims.platformRoute,
    dims.regionalRoute,
    dims.queueId,
    dims.rankTier,
    dims.position,
    dims.championId,
    dims.opponentChampionId,
    dims.sourceNormalizationVersion,
    dims.aggregationVersion,
  ]);
}
