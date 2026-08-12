import { describe, expect, it } from 'vitest';
import {
  evaluateMatchEligibility,
  type MatchEligibilityRow,
  type ParticipantEligibilityRow,
} from './eligibility.js';

const VERSIONS = { sourceNormalizationVersion: '1', aggregationVersion: '1' };

function baseMatch(overrides: Partial<MatchEligibilityRow> = {}): MatchEligibilityRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ingestionStatus: 'COMPLETED',
    remake: false,
    normalizationVersion: '1',
    normalizedPatch: '14.1',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    gameCreation: new Date('2024-01-01T00:00:00.000Z'),
    gameEndTimestamp: new Date('2024-01-01T00:30:00.000Z'),
    gameDurationSeconds: 1800,
    ...overrides,
  };
}

function baseParticipant(
  overrides: Partial<ParticipantEligibilityRow> = {},
): ParticipantEligibilityRow {
  return {
    participantId: 1,
    championId: 103,
    teamId: 100,
    teamPosition: 'MIDDLE',
    individualPosition: 'MIDDLE',
    lane: 'MIDDLE',
    role: 'SOLO',
    rankTierAtIngestion: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    win: true,
    kills: 5,
    deaths: 2,
    assists: 7,
    totalCs: 200,
    timePlayedSeconds: 1800,
    totalDamageDealtToChampions: 20_000,
    visionScore: 30,
    goldDifferenceAt10: 100,
    goldDifferenceAt15: 200,
    csDifferenceAt10: 5,
    csDifferenceAt15: 10,
    ...overrides,
  };
}

describe('evaluateMatchEligibility', () => {
  it('accepts a completed ranked match with valid participants', () => {
    const result = evaluateMatchEligibility(baseMatch(), [baseParticipant()], VERSIONS);
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors).toHaveLength(1);
      expect(result.contributors[0]?.exact.position).toBe('MIDDLE');
      expect(result.contributors[0]?.rankClassification.exactRankTier).toBe('GOLD');
      expect(result.contributors[0]?.rankClassification.contributesToAll).toBe(true);
    }
  });

  it('excludes remakes', () => {
    const result = evaluateMatchEligibility(baseMatch({ remake: true }), [baseParticipant()], VERSIONS);
    expect(result).toEqual({ eligible: false, reason: 'MATCH_REMAKE' });
  });

  it('excludes incomplete matches', () => {
    const result = evaluateMatchEligibility(
      baseMatch({ ingestionStatus: 'IN_PROGRESS' }),
      [baseParticipant()],
      VERSIONS,
    );
    expect(result).toEqual({ eligible: false, reason: 'MATCH_NOT_COMPLETED' });
  });

  it('excludes source normalization version mismatches', () => {
    const result = evaluateMatchEligibility(
      baseMatch({ normalizationVersion: '2' }),
      [baseParticipant()],
      VERSIONS,
    );
    expect(result).toEqual({
      eligible: false,
      reason: 'SOURCE_NORMALIZATION_VERSION_MISMATCH',
    });
  });

  it('PENDING null rank stays in ALL and does not become UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [
        baseParticipant({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'PENDING',
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      const c = result.contributors[0]!;
      expect(c.rankClassification.contributesToAll).toBe(true);
      expect(c.rankClassification.contributesToUnknown).toBe(false);
      expect(c.rankClassification.exactRankTier).toBeUndefined();
      expect(c.rankClassification.isRankResolved).toBe(false);
    }
  });

  it('FAILED_RETRYABLE stays in ALL and does not become UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [
        baseParticipant({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'FAILED_RETRYABLE',
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.rankClassification).toMatchObject({
        contributesToAll: true,
        contributesToUnknown: false,
        isPermanentUnavailable: false,
        isRankResolved: false,
      });
    }
  });

  it('RESOLVED_UNRANKED contributes to ALL and UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [
        baseParticipant({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'RESOLVED_UNRANKED',
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.rankClassification).toMatchObject({
        contributesToAll: true,
        contributesToUnknown: true,
        isPermanentUnavailable: false,
        isRankResolved: true,
      });
    }
  });

  it('FAILED_PERMANENT contributes to ALL only — not exact, not UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [
        baseParticipant({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'FAILED_PERMANENT',
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      const c = result.contributors[0]!;
      expect(c.rankClassification.contributesToAll).toBe(true);
      expect(c.rankClassification.exactRankTier).toBeUndefined();
      expect(c.rankClassification.contributesToUnknown).toBe(false);
      expect(c.rankClassification.isPermanentUnavailable).toBe(true);
    }
  });

  it('RESOLVED_RANKED with invalid tier does not silently become UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [
        baseParticipant({
          rankTierAtIngestion: 'NOT_A_TIER',
          rankResolutionStatus: 'RESOLVED_RANKED',
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.rankClassification.contributesToUnknown).toBe(false);
      expect(result.contributors[0]?.rankClassification.exactRankTier).toBeUndefined();
      expect(result.invalidRankTierCount).toBe(1);
    }
  });

  it('Camille SUPPORT canonical: ALL=27, exact=2, UNKNOWN=0, unresolved=25', () => {
    const participants: ParticipantEligibilityRow[] = [
      baseParticipant({
        participantId: 1,
        championId: 164,
        teamPosition: 'UTILITY',
        individualPosition: 'UTILITY',
        lane: 'BOTTOM',
        role: 'DUO_SUPPORT',
        rankTierAtIngestion: 'CHALLENGER',
        rankResolutionStatus: 'RESOLVED_RANKED',
      }),
      baseParticipant({
        participantId: 2,
        championId: 164,
        teamPosition: 'UTILITY',
        individualPosition: 'UTILITY',
        lane: 'BOTTOM',
        role: 'DUO_SUPPORT',
        rankTierAtIngestion: 'GRANDMASTER',
        rankResolutionStatus: 'RESOLVED_RANKED',
      }),
      ...Array.from({ length: 25 }, (_, i) =>
        baseParticipant({
          participantId: i + 3,
          championId: 164,
          teamPosition: 'UTILITY',
          individualPosition: 'UTILITY',
          lane: 'BOTTOM',
          role: 'DUO_SUPPORT',
          rankTierAtIngestion: null,
          rankResolutionStatus: 'PENDING',
        }),
      ),
    ];

    const result = evaluateMatchEligibility(baseMatch(), participants, VERSIONS);
    expect(result.eligible).toBe(true);
    if (!result.eligible) {
      return;
    }

    expect(result.contributors).toHaveLength(27);
    expect(result.contributors.every((c) => c.base.position === 'SUPPORT')).toBe(true);
    expect(result.contributors.every((c) => c.rankClassification.contributesToAll)).toBe(true);
    expect(
      result.contributors.filter((c) => c.rankClassification.exactRankTier === 'CHALLENGER'),
    ).toHaveLength(1);
    expect(
      result.contributors.filter((c) => c.rankClassification.exactRankTier === 'GRANDMASTER'),
    ).toHaveLength(1);
    expect(result.contributors.filter((c) => c.rankClassification.contributesToUnknown)).toHaveLength(
      0,
    );
    expect(result.contributors.filter((c) => !c.rankClassification.isRankResolved)).toHaveLength(25);
  });

  it('normalizes UTILITY to SUPPORT and never keeps raw riot position', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [
        baseParticipant({
          teamPosition: 'UTILITY',
          individualPosition: 'UTILITY',
          lane: 'BOTTOM',
          role: 'DUO_SUPPORT',
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.exact.position).toBe('SUPPORT');
    }
  });

  it('keeps UNKNOWN position as UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch({ queueId: 450, gameMode: 'ARAM', mapId: 12 }),
      [
        baseParticipant({
          teamPosition: '',
          individualPosition: '',
          lane: null,
          role: null,
          rankResolutionStatus: 'NOT_APPLICABLE',
          rankTierAtIngestion: null,
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.exact.position).toBe('UNKNOWN');
      expect(result.contributors[0]?.rankClassification.contributesToUnknown).toBe(false);
    }
  });

  it('rejects participants with non-positive championId', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [baseParticipant({ championId: 0 })],
      VERSIONS,
    );
    expect(result).toEqual({ eligible: false, reason: 'NO_ELIGIBLE_PARTICIPANTS' });
  });

  it('still applies queue/patch eligibility independently of rank resolution', () => {
    const result = evaluateMatchEligibility(
      baseMatch({ normalizedPatch: null }),
      [
        baseParticipant({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'PENDING',
        }),
      ],
      VERSIONS,
    );
    expect(result).toEqual({ eligible: false, reason: 'MISSING_NORMALIZED_PATCH' });
  });
});
