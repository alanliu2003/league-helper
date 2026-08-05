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
      expect(result.contributors[0]?.exact.rankTier).toBe('GOLD');
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

  it('maps null rankTierAtIngestion to UNKNOWN', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [baseParticipant({ rankTierAtIngestion: null })],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.exact.rankTier).toBe('UNKNOWN');
      expect(result.invalidRankTierCount).toBe(0);
    }
  });

  it('coerces invalid rank tier to UNKNOWN and counts it', () => {
    const result = evaluateMatchEligibility(
      baseMatch(),
      [baseParticipant({ rankTierAtIngestion: 'NOT_A_TIER' })],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.exact.rankTier).toBe('UNKNOWN');
      expect(result.invalidRankTierCount).toBe(1);
    }
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
        }),
      ],
      VERSIONS,
    );
    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.contributors[0]?.exact.position).toBe('UNKNOWN');
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
});
