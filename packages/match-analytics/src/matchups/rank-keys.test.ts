import { describe, expect, it } from 'vitest';
import { classifyParticipantRankForAggregates } from '@league-helper/shared';
import { expandMatchupRankTiers, subjectFeedsMatchupRankTier } from './rank-keys';

describe('matchup rank keys', () => {
  it('GOLD subject contributes to ALL and EXACT GOLD, never opponent or segment rows', () => {
    const gold = classifyParticipantRankForAggregates({
      status: 'RESOLVED_RANKED',
      resolvedTier: 'GOLD',
    });
    expect(expandMatchupRankTiers(gold)).toEqual(['ALL', 'GOLD']);
    expect(subjectFeedsMatchupRankTier(gold, 'ALL')).toBe(true);
    expect(subjectFeedsMatchupRankTier(gold, 'GOLD')).toBe(true);
    expect(subjectFeedsMatchupRankTier(gold, 'PLATINUM')).toBe(false);
    expect(subjectFeedsMatchupRankTier(gold, 'UNKNOWN')).toBe(false);
  });

  it('unresolved subjects contribute to ALL only — never exact, never UNKNOWN', () => {
    const pending = classifyParticipantRankForAggregates({ status: 'PENDING' });
    expect(expandMatchupRankTiers(pending)).toEqual(['ALL']);
    expect(subjectFeedsMatchupRankTier(pending, 'GOLD')).toBe(false);
    expect(subjectFeedsMatchupRankTier(pending, 'UNKNOWN')).toBe(false);
  });

  it('RESOLVED_UNRANKED contributes to ALL and UNKNOWN', () => {
    const unranked = classifyParticipantRankForAggregates({ status: 'RESOLVED_UNRANKED' });
    expect(expandMatchupRankTiers(unranked)).toEqual(['ALL', 'UNKNOWN']);
  });
});
