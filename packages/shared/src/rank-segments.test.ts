import { describe, expect, it } from 'vitest';
import { RankTierSchema } from './ranks';
import {
  APEX_RANK_TIERS,
  HIGH_RANK_TIERS,
  LOW_RANK_TIERS,
  MID_RANK_TIERS,
  RANK_SEGMENTS,
  hasCompleteApexRepresentation,
  parseRankSegmentId,
  rankSegmentForTier,
} from './rank-segments';

describe('rank segments vocabulary', () => {
  it('defines Apex as Challenger + Grandmaster + Master (not Challenger-only)', () => {
    expect(RANK_SEGMENTS.APEX).toEqual(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
    expect(APEX_RANK_TIERS).toContain('MASTER');
    expect(APEX_RANK_TIERS).not.toEqual(['CHALLENGER']);
  });

  it('defines High / Mid / Low representation buckets', () => {
    expect(HIGH_RANK_TIERS).toEqual(['DIAMOND', 'EMERALD', 'PLATINUM']);
    expect(MID_RANK_TIERS).toEqual(['GOLD']);
    expect(LOW_RANK_TIERS).toEqual(['SILVER', 'BRONZE', 'IRON']);
  });

  it('maps every RankTier into exactly one segment', () => {
    const covered = new Set<string>();
    for (const tier of RankTierSchema.options) {
      const segment = rankSegmentForTier(tier);
      covered.add(tier);
      expect(RANK_SEGMENTS[segment]).toContain(tier);
    }
    expect(covered.size).toBe(RankTierSchema.options.length);
  });

  it('requires all three Apex tiers for complete Apex representation', () => {
    expect(
      hasCompleteApexRepresentation({
        CHALLENGER: 302,
        GRANDMASTER: 717,
        MASTER: 10000,
      }),
    ).toBe(true);
    expect(
      hasCompleteApexRepresentation({
        CHALLENGER: 10,
        GRANDMASTER: 0,
        MASTER: 5,
      }),
    ).toBe(false);
    expect(hasCompleteApexRepresentation({ CHALLENGER: 100 })).toBe(false);
  });

  it('parses segment ids', () => {
    expect(parseRankSegmentId('apex')).toBe('APEX');
    expect(() => parseRankSegmentId('ELITE')).toThrow(/Unsupported rank segment/);
  });
});
