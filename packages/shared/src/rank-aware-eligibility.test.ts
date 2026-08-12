import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_RANKING_FLOOR,
  RankAwareProductQualityMetaSchema,
  buildRankAwareProductQualityMeta,
} from './rank-aware-eligibility';

describe('rank-aware product quality metadata', () => {
  it('keeps ranking floor at 30', () => {
    expect(CHAMPION_STATS_RANKING_FLOOR).toBe(30);
  });

  it('marks rankingEligible only at or above the floor', () => {
    const below = buildRankAwareProductQualityMeta({
      sampleSize: 29,
      rankScope: { kind: 'EXACT', tier: 'GOLD' },
      patch: '16.15',
    });
    const atFloor = buildRankAwareProductQualityMeta({
      sampleSize: 30,
      rankScope: { kind: 'SEGMENT', segment: 'MID' },
      patch: '16.15',
    });

    expect(below.rankingEligible).toBe(false);
    expect(below.lowSample).toBe(true);
    expect(below.rankingFloor).toBe(30);

    expect(atFloor.rankingEligible).toBe(true);
    expect(atFloor.lowSample).toBe(false);
    expect(RankAwareProductQualityMetaSchema.parse(atFloor).rankScope).toEqual({
      kind: 'SEGMENT',
      segment: 'MID',
    });
  });

  it('does not embed operational pipeline health fields', () => {
    const meta = buildRankAwareProductQualityMeta({
      sampleSize: 40,
      rankScope: { kind: 'ALL' },
      patch: '16.15',
    });
    expect(meta).not.toHaveProperty('exactRankCoverage');
    expect(meta).not.toHaveProperty('rankResolutionCoverage');
    expect(meta).not.toHaveProperty('PENDING');
    expect(meta).not.toHaveProperty('FAILED_RETRYABLE');
  });
});
