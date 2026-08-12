import {
  PlatformRouteSchema,
  RegionalRouteSchema,
  classifyParticipantRankForAggregates,
  normalizeParticipantPosition,
  type ParticipantRankResolutionStatus,
} from '@league-helper/shared';
import {
  expandDimensionKeysForRankClassification,
  type ContributorBaseDimensions,
} from './rank-dimension-keys.js';

/**
 * Aggregate-defining snapshot captured BEFORE participant overwrite.
 * Expanded to materialized keys at durable-scope write / enqueue time with
 * the configured sourceNormalizationVersion + aggregationVersion.
 *
 * Generic affected-key closure = expand(previous snapshots) ∪ expand(current).
 * Rank + position transitions are covered without one-off UNKNOWN sibling patches.
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
  rankResolutionStatus: ParticipantRankResolutionStatus;
};

/**
 * Expand previous participant snapshots into materialized dimension key strings
 * using rank-classification-aware rollup (ALL / exact / UNKNOWN).
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

    const classification = classifyParticipantRankForAggregates({
      status: snapshot.rankResolutionStatus,
      resolvedTier:
        snapshot.rankResolutionStatus === 'RESOLVED_RANKED'
          ? snapshot.rankTierAtIngestion
          : null,
    });

    const base: ContributorBaseDimensions = {
      patch: snapshot.patch,
      platformRoute: platform.data,
      regionalRoute: regional.data,
      queueId: snapshot.queueId,
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

    for (const key of expandDimensionKeysForRankClassification(base, classification)) {
      keys.add(key);
    }
  }

  return [...keys].sort();
}

export function expandCurrentDimensionKeys(
  contributors: Array<{
    base: ContributorBaseDimensions;
    rankClassification: import('@league-helper/shared').ParticipantRankAggregateClassification;
  }>,
): string[] {
  const keys = new Set<string>();
  for (const contributor of contributors) {
    for (const key of expandDimensionKeysForRankClassification(
      contributor.base,
      contributor.rankClassification,
    )) {
      keys.add(key);
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
