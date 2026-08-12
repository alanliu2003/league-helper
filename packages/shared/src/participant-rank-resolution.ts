import { z } from 'zod';
import { RANKED_FLEX_QUEUE_ID, RANKED_SOLO_QUEUE_ID } from './match-queues';
import { RankTierSchema, type RankTier } from './ranks';

/**
 * Explicit participant-rank resolution lifecycle for MatchParticipant / observations.
 * Do not overload null to mean multiple semantic states.
 */
export const ParticipantRankResolutionStatusSchema = z.enum([
  'PENDING',
  'FAILED_RETRYABLE',
  'RESOLVED_RANKED',
  'RESOLVED_UNRANKED',
  /** Unrecoverable gap (e.g. missing PUUID). Documented permanent-unavailable. */
  'FAILED_PERMANENT',
  /** Queue has no applicable ranked Solo/Flex rank (non-420/440). */
  'NOT_APPLICABLE',
]);

export type ParticipantRankResolutionStatus = z.infer<
  typeof ParticipantRankResolutionStatusSchema
>;

/** Aggregate product sentinel for finalized no-applicable-rank buckets. */
export const AGGREGATE_UNKNOWN_RANK_TIER = 'UNKNOWN' as const;

export type ParticipantRankAggregateClassification = {
  /** Otherwise-eligible samples always contribute to ALL when true. */
  contributesToAll: boolean;
  /** Exact tier bucket only for RESOLVED_RANKED with a valid RankTier. */
  exactRankTier?: RankTier;
  /**
   * Product UNKNOWN bucket — only when Riot lookup completed and returned
   * no applicable ranked entry (`RESOLVED_UNRANKED`).
   * Never includes technical permanent-unavailable failures.
   */
  contributesToUnknown: boolean;
  /**
   * Documented permanent technical/data gap (e.g. missing PUUID).
   * Remains in ALL; never exact; never UNKNOWN.
   */
  isPermanentUnavailable: boolean;
  /**
   * True when resolution reached a terminal outcome
   * (ranked / unranked / permanent-unavailable / N/A).
   */
  isRankResolved: boolean;
};

export type ClassifyParticipantRankInput = {
  status: ParticipantRankResolutionStatus;
  /** Required when status is RESOLVED_RANKED. */
  resolvedTier?: string | null;
};

/**
 * Central mapping from resolution status → aggregate rank behavior.
 * Aggregation code must not reimplement these semantics independently.
 */
export function classifyParticipantRankForAggregates(
  input: ClassifyParticipantRankInput,
): ParticipantRankAggregateClassification {
  switch (input.status) {
    case 'PENDING':
    case 'FAILED_RETRYABLE':
      return {
        contributesToAll: true,
        contributesToUnknown: false,
        isPermanentUnavailable: false,
        isRankResolved: false,
      };
    case 'RESOLVED_RANKED': {
      const parsed = RankTierSchema.safeParse(
        typeof input.resolvedTier === 'string'
          ? input.resolvedTier.trim().toUpperCase()
          : input.resolvedTier,
      );
      if (!parsed.success) {
        // Invalid ranked resolution is treated as retryable-incomplete for aggregates:
        // stay in ALL, never silent UNKNOWN.
        return {
          contributesToAll: true,
          contributesToUnknown: false,
          isPermanentUnavailable: false,
          isRankResolved: false,
        };
      }
      return {
        contributesToAll: true,
        exactRankTier: parsed.data,
        contributesToUnknown: false,
        isPermanentUnavailable: false,
        isRankResolved: true,
      };
    }
    case 'RESOLVED_UNRANKED':
      // UNKNOWN = Riot lookup completed successfully with no applicable ranked entry.
      return {
        contributesToAll: true,
        contributesToUnknown: true,
        isPermanentUnavailable: false,
        isRankResolved: true,
      };
    case 'FAILED_PERMANENT':
      // Permanent technical/data gap — not proof of unranked. ALL only; diagnostic flag.
      return {
        contributesToAll: true,
        contributesToUnknown: false,
        isPermanentUnavailable: true,
        isRankResolved: true,
      };
    case 'NOT_APPLICABLE':
      // Non-ranked queues: contribute to ALL only; rank filters are N/A.
      return {
        contributesToAll: true,
        contributesToUnknown: false,
        isPermanentUnavailable: false,
        isRankResolved: true,
      };
    default: {
      const _exhaustive: never = input.status;
      void _exhaustive;
      return {
        contributesToAll: true,
        contributesToUnknown: false,
        isPermanentUnavailable: false,
        isRankResolved: false,
      };
    }
  }
}

export function isRankedSoloOrFlexQueue(queueId: number): boolean {
  return queueId === RANKED_SOLO_QUEUE_ID || queueId === RANKED_FLEX_QUEUE_ID;
}

/**
 * Initial MatchParticipant.rankResolutionStatus at ingestion / migration.
 *
 * - non-420/440 → NOT_APPLICABLE
 * - ranked + missing PUUID → FAILED_PERMANENT (cannot League-v4 lookup)
 * - ranked + valid observed tier → RESOLVED_RANKED
 * - ranked + null tier → PENDING (never silent UNKNOWN)
 */
export function initialParticipantRankResolutionStatus(input: {
  queueId: number;
  rankTierAtIngestion: string | null | undefined;
  externalAccountId: string | null | undefined;
}): ParticipantRankResolutionStatus {
  if (!isRankedSoloOrFlexQueue(input.queueId)) {
    return 'NOT_APPLICABLE';
  }
  const puuid =
    typeof input.externalAccountId === 'string' ? input.externalAccountId.trim() : '';
  if (puuid.length === 0) {
    return 'FAILED_PERMANENT';
  }
  if (input.rankTierAtIngestion == null || input.rankTierAtIngestion.trim() === '') {
    return 'PENDING';
  }
  const parsed = RankTierSchema.safeParse(input.rankTierAtIngestion.trim().toUpperCase());
  if (parsed.success) {
    return 'RESOLVED_RANKED';
  }
  // Malformed local snapshot tier: do not finalize as UNKNOWN.
  return 'PENDING';
}

/** Preferred observation freshness window before re-lookup (Phase 3). */
export const PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS = 6 * 60 * 60 * 1000;
