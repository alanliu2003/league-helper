import { z } from 'zod';
import { RankTierSchema, type RankTier } from './ranks';
import {
  RANK_SEGMENT_IDS,
  RANK_SEGMENTS,
  type RankSegmentId,
} from './rank-segments';
import type { ParticipantRankResolutionStatus } from './participant-rank-resolution';

/** Legacy public `tier` query values (ALL | exact | UNKNOWN). */
export type LegacyChampionStatsTierFilter = RankTier | 'ALL' | 'UNKNOWN';

/**
 * Future-facing rank filter contract for rank-aware analytics reads.
 *
 * Distinct from legacy query `tier: ChampionStatsTierFilter` (ALL | exact | UNKNOWN).
 * Segment scopes are product/read constructs — they are NOT persisted aggregate rows.
 */
export const RankScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }),
  z.object({ kind: z.literal('UNKNOWN') }),
  z.object({ kind: z.literal('EXACT'), tier: RankTierSchema }),
  z.object({
    kind: z.literal('SEGMENT'),
    segment: z.enum(RANK_SEGMENT_IDS),
  }),
]);
export type RankScope = z.infer<typeof RankScopeSchema>;

export type RankScopeReadStrategy =
  | { mode: 'MATERIALIZED_SENTINEL'; rankTier: 'ALL' | 'UNKNOWN' }
  | { mode: 'EXACT_TIER'; tier: RankTier }
  | {
      mode: 'SEGMENT_MERGE';
      segment: RankSegmentId;
      tiers: readonly RankTier[];
    };

export function parseRankScope(input: unknown): RankScope {
  return RankScopeSchema.parse(input);
}

export function rankScopeEquals(left: RankScope, right: RankScope): boolean {
  return serializeRankScopeCacheToken(left) === serializeRankScopeCacheToken(right);
}

/**
 * Deterministic cache-token for rank scope.
 *
 * Uses kind identity (SEGMENT:HIGH), not expanded exact-tier lists, so:
 * - ALL ≠ UNKNOWN
 * - SEGMENT:HIGH ≠ EXACT:DIAMOND
 * - EXACT:GOLD ≠ SEGMENT:MID (even though MID currently expands to GOLD only)
 */
export function serializeRankScopeCacheToken(scope: RankScope): string {
  const valid = RankScopeSchema.parse(scope);
  switch (valid.kind) {
    case 'ALL':
      return 'ALL';
    case 'UNKNOWN':
      return 'UNKNOWN';
    case 'EXACT':
      return `EXACT:${valid.tier}`;
    case 'SEGMENT':
      return `SEGMENT:${valid.segment}`;
  }
}

export function parseRankScopeCacheToken(token: string): RankScope {
  const value = token.trim();
  if (value === 'ALL') {
    return { kind: 'ALL' };
  }
  if (value === 'UNKNOWN') {
    return { kind: 'UNKNOWN' };
  }
  if (value.startsWith('EXACT:')) {
    const tier = RankTierSchema.parse(value.slice('EXACT:'.length));
    return { kind: 'EXACT', tier };
  }
  if (value.startsWith('SEGMENT:')) {
    const segment = z.enum(RANK_SEGMENT_IDS).parse(value.slice('SEGMENT:'.length));
    return { kind: 'SEGMENT', segment };
  }
  throw new Error(`Invalid rank scope token: ${token}`);
}

/**
 * Exact Riot tiers contributing to a scope.
 * ALL / UNKNOWN return [] because they are materialized sentinels, not tier merges.
 */
export function exactTiersForRankScope(scope: RankScope): readonly RankTier[] {
  const valid = RankScopeSchema.parse(scope);
  switch (valid.kind) {
    case 'ALL':
    case 'UNKNOWN':
      return [];
    case 'EXACT':
      return [valid.tier];
    case 'SEGMENT':
      return RANK_SEGMENTS[valid.segment];
  }
}

export function resolveRankScopeReadStrategy(scope: RankScope): RankScopeReadStrategy {
  const valid = RankScopeSchema.parse(scope);
  switch (valid.kind) {
    case 'ALL':
      return { mode: 'MATERIALIZED_SENTINEL', rankTier: 'ALL' };
    case 'UNKNOWN':
      return { mode: 'MATERIALIZED_SENTINEL', rankTier: 'UNKNOWN' };
    case 'EXACT':
      return { mode: 'EXACT_TIER', tier: valid.tier };
    case 'SEGMENT':
      return {
        mode: 'SEGMENT_MERGE',
        segment: valid.segment,
        tiers: RANK_SEGMENTS[valid.segment],
      };
  }
}

/** Map existing public `tier` query values onto RankScope without semantic drift. */
export function legacyTierFilterToRankScope(tier: LegacyChampionStatsTierFilter): RankScope {
  if (tier === 'ALL') {
    return { kind: 'ALL' };
  }
  if (tier === 'UNKNOWN') {
    return { kind: 'UNKNOWN' };
  }
  return { kind: 'EXACT', tier: RankTierSchema.parse(tier) };
}

const UNRESOLVED_OR_NON_EXACT_STATUSES: ReadonlySet<ParticipantRankResolutionStatus> = new Set([
  'PENDING',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'RESOLVED_UNRANKED',
  'NOT_APPLICABLE',
]);

/**
 * Guard: unresolved / failed / unranked statuses never define product EXACT or SEGMENT scope.
 * Valid RankScope objects without status metadata pass through.
 */
export function assertProductRankScope(input: unknown): RankScope {
  const scope = RankScopeSchema.parse(input);

  if (input !== null && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const statusRaw = record.resolutionStatus ?? record.fromResolutionStatus;
    if (typeof statusRaw === 'string') {
      const status = statusRaw as ParticipantRankResolutionStatus;
      if (
        (scope.kind === 'EXACT' || scope.kind === 'SEGMENT') &&
        UNRESOLVED_OR_NON_EXACT_STATUSES.has(status)
      ) {
        throw new Error(
          `Unresolved/FAILED status ${status} cannot map to product rank scope ${serializeRankScopeCacheToken(scope)}.`,
        );
      }
      if (scope.kind === 'EXACT' && status !== 'RESOLVED_RANKED') {
        throw new Error(
          `Product exact rank scope requires RESOLVED_RANKED; received ${status}.`,
        );
      }
    }
  }

  return scope;
}

/**
 * True when a resolution status may contribute to exact-tier (and therefore segment) product reads.
 */
export function resolutionStatusAllowsExactOrSegmentProductScope(
  status: ParticipantRankResolutionStatus,
): boolean {
  return status === 'RESOLVED_RANKED';
}
