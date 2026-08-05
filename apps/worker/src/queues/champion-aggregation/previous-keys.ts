import {
  DEFAULT_CHAMPION_ROLLUP_POLICY,
  UNKNOWN_RANK_TIER_SENTINEL,
  buildChampionAggregateDimensionKey,
  expandChampionDimensionTuples,
  type ExactChampionDimensions,
  type ExactChampionRankTier,
} from '@league-helper/match-analytics';
import {
  PlatformRouteSchema,
  RankTierSchema,
  RegionalRouteSchema,
  normalizeParticipantPosition,
} from '@league-helper/shared';

/**
 * Aggregate-defining snapshot captured BEFORE participant overwrite.
 * Expanded to materialized keys at durable-scope write / enqueue time with
 * the configured sourceNormalizationVersion + aggregationVersion.
 */
export type PreviousParticipantDimensionSnapshot = {
  patch: string;
  platformRoute: string;
  regionalRoute: string;
  queueId: number;
  mapId: number | null;
  gameMode: string | null;
  remake: boolean;
  championId: number;
  teamPosition: string;
  individualPosition: string;
  lane: string | null;
  role: string | null;
  rankTierAtIngestion: string | null;
};

function resolveRankTier(raw: string | null): ExactChampionRankTier {
  if (raw == null || raw.trim() === '') {
    return UNKNOWN_RANK_TIER_SENTINEL;
  }
  if (raw === UNKNOWN_RANK_TIER_SENTINEL) {
    return UNKNOWN_RANK_TIER_SENTINEL;
  }
  const parsed = RankTierSchema.safeParse(raw.trim().toUpperCase());
  return parsed.success ? parsed.data : UNKNOWN_RANK_TIER_SENTINEL;
}

/**
 * Expand previous participant snapshots into materialized dimension key strings
 * using the default rollup policy (exact + ALL tier + ALL position).
 */
export function expandPreviousDimensionKeys(
  snapshots: PreviousParticipantDimensionSnapshot[],
  versions: { sourceNormalizationVersion: string; aggregationVersion: string },
): string[] {
  const keys = new Set<string>();

  for (const snapshot of snapshots) {
    if (!snapshot.patch || snapshot.patch.trim() === '') {
      continue;
    }
    if (!(snapshot.championId > 0) || !Number.isInteger(snapshot.championId)) {
      continue;
    }
    if (!Number.isInteger(snapshot.queueId) || snapshot.queueId < 0) {
      continue;
    }
    const platform = PlatformRouteSchema.safeParse(snapshot.platformRoute);
    const regional = RegionalRouteSchema.safeParse(snapshot.regionalRoute);
    if (!platform.success || !regional.success) {
      continue;
    }

    const exact: ExactChampionDimensions = {
      patch: snapshot.patch,
      platformRoute: platform.data,
      regionalRoute: regional.data,
      queueId: snapshot.queueId,
      rankTier: resolveRankTier(snapshot.rankTierAtIngestion),
      position: normalizeParticipantPosition({
        queueId: snapshot.queueId,
        mapId: snapshot.mapId,
        gameMode: snapshot.gameMode,
        remake: snapshot.remake,
        teamPosition: snapshot.teamPosition,
        individualPosition: snapshot.individualPosition,
        lane: snapshot.lane,
        role: snapshot.role,
      }),
      championId: snapshot.championId,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
    };

    for (const materialized of expandChampionDimensionTuples(
      exact,
      DEFAULT_CHAMPION_ROLLUP_POLICY,
    )) {
      keys.add(buildChampionAggregateDimensionKey(materialized));
    }
  }

  return [...keys].sort();
}

export function expandCurrentDimensionKeys(
  exactDims: ExactChampionDimensions[],
): string[] {
  const keys = new Set<string>();
  for (const exact of exactDims) {
    for (const materialized of expandChampionDimensionTuples(
      exact,
      DEFAULT_CHAMPION_ROLLUP_POLICY,
    )) {
      keys.add(buildChampionAggregateDimensionKey(materialized));
    }
  }
  return [...keys].sort();
}

export function unionDimensionKeys(previous: string[], current: string[]): string[] {
  return [...new Set([...previous, ...current])].sort();
}

/** Deterministic sorted unique merge for durable recalc-scope upserts. */
export function mergeRecalcScopeKeys(
  existingKeys: readonly string[],
  incomingKeys: readonly string[],
): string[] {
  return unionDimensionKeys([...existingKeys], [...incomingKeys]);
}

export function dimensionKeysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}
