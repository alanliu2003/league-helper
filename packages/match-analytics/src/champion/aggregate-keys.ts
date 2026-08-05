import type { MaterializedChampionDimensions } from './aggregate-dimensions';

/**
 * Stable fixed-order JSON array tuple key for champion aggregate dimensions.
 * Field name in this package is `position` (DB column is `teamPosition` later).
 */
export function buildChampionAggregateDimensionKey(dims: MaterializedChampionDimensions): string {
  return JSON.stringify([
    dims.patch,
    dims.platformRoute,
    dims.regionalRoute,
    dims.queueId,
    dims.rankTier,
    dims.position,
    dims.championId,
    dims.sourceNormalizationVersion,
    dims.aggregationVersion,
  ]);
}
