import {
  ALL_POSITION_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
  buildChampionAggregateDimensionKey,
  type ExactChampionDimensions,
  type MaterializedChampionDimensions,
} from '@league-helper/match-analytics';
import {
  type ParticipantRankAggregateClassification,
} from '@league-helper/shared';

/**
 * Non-rank exact dimensions shared by a contributor.
 * Rank bucket membership is driven solely by ParticipantRankAggregateClassification.
 */
export type ContributorBaseDimensions = Omit<ExactChampionDimensions, 'rankTier'>;

/**
 * Generic affected-key expansion from base dims + rank classification.
 *
 * - ALL-tier keys when contributesToAll
 * - exact tier (+ ALL-position) when exactRankTier set
 * - UNKNOWN (+ ALL-position) when contributesToUnknown
 *
 * Unresolved (PENDING / FAILED_RETRYABLE) and FAILED_PERMANENT emit ALL only — never UNKNOWN.
 * UNKNOWN is reserved for RESOLVED_UNRANKED (successful no-applicable-rank).
 */
export function expandDimensionTuplesForRankClassification(
  base: ContributorBaseDimensions,
  classification: ParticipantRankAggregateClassification,
): MaterializedChampionDimensions[] {
  const tuples: MaterializedChampionDimensions[] = [];

  if (classification.contributesToAll) {
    tuples.push({
      ...base,
      rankTier: ALL_RANK_TIER_SENTINEL,
    });
  }

  if (classification.exactRankTier) {
    tuples.push({
      ...base,
      rankTier: classification.exactRankTier,
    });
    tuples.push({
      ...base,
      rankTier: classification.exactRankTier,
      position: ALL_POSITION_SENTINEL,
    });
  }

  if (classification.contributesToUnknown) {
    tuples.push({
      ...base,
      rankTier: UNKNOWN_RANK_TIER_SENTINEL,
    });
    tuples.push({
      ...base,
      rankTier: UNKNOWN_RANK_TIER_SENTINEL,
      position: ALL_POSITION_SENTINEL,
    });
  }

  const unique = new Map<string, MaterializedChampionDimensions>();
  for (const tuple of tuples) {
    unique.set(buildChampionAggregateDimensionKey(tuple), tuple);
  }
  return [...unique.values()];
}

export function expandDimensionKeysForRankClassification(
  base: ContributorBaseDimensions,
  classification: ParticipantRankAggregateClassification,
): string[] {
  return expandDimensionTuplesForRankClassification(base, classification)
    .map(buildChampionAggregateDimensionKey)
    .sort();
}

/**
 * Whether a contributor feeds a materialized key under locked ALL/exact/UNKNOWN semantics.
 */
export function contributorFeedsKeyForRankClassification(
  base: ContributorBaseDimensions,
  classification: ParticipantRankAggregateClassification,
  key: MaterializedChampionDimensions,
): boolean {
  if (
    base.patch !== key.patch ||
    base.platformRoute !== key.platformRoute ||
    base.regionalRoute !== key.regionalRoute ||
    base.queueId !== key.queueId ||
    base.championId !== key.championId ||
    base.sourceNormalizationVersion !== key.sourceNormalizationVersion ||
    base.aggregationVersion !== key.aggregationVersion
  ) {
    return false;
  }

  const positionOk =
    key.position === ALL_POSITION_SENTINEL || key.position === base.position;
  if (!positionOk) {
    return false;
  }

  if (key.rankTier === ALL_RANK_TIER_SENTINEL) {
    return classification.contributesToAll;
  }
  if (key.rankTier === UNKNOWN_RANK_TIER_SENTINEL) {
    return classification.contributesToUnknown;
  }
  return classification.exactRankTier === key.rankTier;
}
