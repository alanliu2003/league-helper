import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_UNKNOWN_RANK_TIER,
  classifyParticipantRankForAggregates,
} from '@league-helper/shared';
import { expandDimensionTuplesForRankClassification } from '../champion-aggregation/rank-dimension-keys.js';

/**
 * Focused Phase 3 lifecycle assertions for rank enrichment → aggregate keys.
 * Full previous∪current convergence is covered in champion-aggregation tests;
 * this locks the enrichment-facing transitions.
 */
describe('rank enrichment aggregation lifecycle', () => {
  const base = {
    patch: '14.16',
    platformRoute: 'na1' as const,
    regionalRoute: 'americas' as const,
    queueId: 420,
    position: 'TOP' as const,
    championId: 164,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  };

  function tiers(
    status: Parameters<typeof classifyParticipantRankForAggregates>[0]['status'],
    resolvedTier?: string,
  ) {
    const classification = classifyParticipantRankForAggregates({ status, resolvedTier });
    return expandDimensionTuplesForRankClassification(base, classification).map(
      (tuple) => tuple.rankTier,
    );
  }

  it('PENDING initially contributes to ALL only (no exact, no UNKNOWN)', () => {
    expect(tiers('PENDING')).toEqual(['ALL']);
  });

  it('PENDING → DIAMOND preserves ALL and adds exact DIAMOND', () => {
    const before = tiers('PENDING');
    const after = tiers('RESOLVED_RANKED', 'DIAMOND');
    expect(before).toContain('ALL');
    expect(after).toContain('ALL');
    expect(after).toContain('DIAMOND');
    expect(after).not.toContain(AGGREGATE_UNKNOWN_RANK_TIER);
  });

  it('PENDING → UNRANKED preserves ALL and adds UNKNOWN', () => {
    const after = tiers('RESOLVED_UNRANKED');
    expect(after).toContain('ALL');
    expect(after).toContain(AGGREGATE_UNKNOWN_RANK_TIER);
    expect(after).not.toContain('DIAMOND');
  });

  it('FAILED_PERMANENT remains out of UNKNOWN', () => {
    const classification = classifyParticipantRankForAggregates({
      status: 'FAILED_PERMANENT',
    });
    expect(classification.contributesToAll).toBe(true);
    expect(classification.contributesToUnknown).toBe(false);
    expect(classification.isPermanentUnavailable).toBe(true);
    expect(tiers('FAILED_PERMANENT')).toEqual(['ALL']);
  });

  it('FAILED_RETRYABLE is not UNKNOWN; rerun to DIAMOND is idempotent for ALL', () => {
    expect(tiers('FAILED_RETRYABLE')).toEqual(['ALL']);
    const once = tiers('RESOLVED_RANKED', 'DIAMOND');
    const twice = tiers('RESOLVED_RANKED', 'DIAMOND');
    expect(once).toEqual(twice);
    expect(once).toContain('ALL');
    expect(once).toContain('DIAMOND');
  });
});
