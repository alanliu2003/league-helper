import type { ParticipantRankAggregateClassification } from '@league-helper/shared';
import { ALL_RANK_TIER_SENTINEL, UNKNOWN_RANK_TIER_SENTINEL } from '../sentinels/aggregate-sentinels';

/**
 * Rank buckets for a directional matchup observation.
 * Subject participant rank only — never opponent rank, root TrackedPlayer rank,
 * or acquisition segment. ALL-position is not materialized (lane is identity).
 */
export function expandMatchupRankTiers(
  classification: ParticipantRankAggregateClassification,
): string[] {
  const tiers: string[] = [];
  if (classification.contributesToAll) {
    tiers.push(ALL_RANK_TIER_SENTINEL);
  }
  if (classification.exactRankTier) {
    tiers.push(classification.exactRankTier);
  }
  if (classification.contributesToUnknown) {
    tiers.push(UNKNOWN_RANK_TIER_SENTINEL);
  }
  return [...new Set(tiers)];
}

export function subjectFeedsMatchupRankTier(
  classification: ParticipantRankAggregateClassification,
  rankTier: string,
): boolean {
  if (rankTier === ALL_RANK_TIER_SENTINEL) {
    return classification.contributesToAll;
  }
  if (rankTier === UNKNOWN_RANK_TIER_SENTINEL) {
    return classification.contributesToUnknown;
  }
  return classification.exactRankTier === rankTier;
}
