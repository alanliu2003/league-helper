import { describe, expect, it } from 'vitest';
import { computeAggregateKdaRatio } from '../champion/aggregate-derivations';
import {
  extractPlayerPlaystyleMatchMetrics,
  toPlayerPlaystyleBaselineMetrics,
  type PlayerPlaystyleMatchInput,
} from './metrics';

function match(overrides: Partial<PlayerPlaystyleMatchInput> = {}): PlayerPlaystyleMatchInput {
  return {
    matchId: 'm1',
    participantId: 1,
    championId: 103,
    championKey: 'Ahri',
    championName: 'Ahri',
    position: 'MIDDLE',
    patch: '16.14',
    platformRoute: 'NA1',
    queueId: 420,
    win: true,
    kills: 10,
    deaths: 0,
    assists: 2,
    totalCs: 180,
    goldEarned: 12_000,
    damageToChampions: 18_000,
    visionScore: 30,
    timePlayedSeconds: 1800,
    gameDurationSeconds: 2000,
    goldDifferenceAt10: 150,
    goldDifferenceAt15: 300,
    csDifferenceAt10: 4,
    csDifferenceAt15: 8,
    rankTier: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    gameCreation: Date.parse('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('extractPlayerPlaystyleMatchMetrics', () => {
  it('prefers timePlayedSeconds when it is greater than 0', () => {
    const extracted = extractPlayerPlaystyleMatchMetrics(match());
    expect(extracted.seconds).toBe(1800);
    expect(extracted.values.CS_PER_MIN).toBe(6);
    expect(extracted.values.GOLD_PER_MIN).toBe(400);
    expect(extracted.values.DAMAGE_PER_MIN).toBe(600);
    expect(extracted.values.VISION_PER_MIN).toBe(1);
  });

  it('falls back to gameDurationSeconds when timePlayedSeconds is 0', () => {
    const extracted = extractPlayerPlaystyleMatchMetrics(
      match({ timePlayedSeconds: 0, gameDurationSeconds: 1800, totalCs: 180 }),
    );
    expect(extracted.seconds).toBe(1800);
    expect(extracted.values.CS_PER_MIN).toBe(6);
  });

  it('returns null per-minute metrics when duration seconds are not positive', () => {
    const extracted = extractPlayerPlaystyleMatchMetrics(
      match({ timePlayedSeconds: 0, gameDurationSeconds: 0 }),
    );
    expect(extracted.seconds).toBe(0);
    expect(extracted.values.CS_PER_MIN).toBeNull();
    expect(extracted.values.GOLD_PER_MIN).toBeNull();
    expect(extracted.values.DAMAGE_PER_MIN).toBeNull();
    expect(extracted.values.VISION_PER_MIN).toBeNull();
    expect(extracted.values.KILLS_PER_GAME).toBe(10);
    expect(extracted.values.GOLD_DIFF_AT_10).toBe(150);
  });

  it('uses computeAggregateKdaRatio perfect-game convention for a single match', () => {
    const extracted = extractPlayerPlaystyleMatchMetrics(match({ kills: 10, deaths: 0, assists: 2 }));
    expect(extracted.values.KDA).toBe(computeAggregateKdaRatio(1, 10, 0, 2));
    expect(extracted.values.KDA).toBe(12);
  });

  it('computes finite KDA when deaths are positive', () => {
    const extracted = extractPlayerPlaystyleMatchMetrics(match({ kills: 4, deaths: 2, assists: 2 }));
    expect(extracted.values.KDA).toBe(computeAggregateKdaRatio(1, 4, 2, 2));
    expect(extracted.values.KDA).toBe(3);
  });

  it('keeps null timeline diffs null and preserves real zeros', () => {
    const withNulls = extractPlayerPlaystyleMatchMetrics(
      match({
        goldDifferenceAt10: null,
        goldDifferenceAt15: null,
        csDifferenceAt10: null,
        csDifferenceAt15: null,
      }),
    );
    expect(withNulls.values.GOLD_DIFF_AT_10).toBeNull();
    expect(withNulls.values.GOLD_DIFF_AT_15).toBeNull();
    expect(withNulls.values.CS_DIFF_AT_10).toBeNull();
    expect(withNulls.values.CS_DIFF_AT_15).toBeNull();

    const withZeros = extractPlayerPlaystyleMatchMetrics(
      match({
        goldDifferenceAt10: 0,
        goldDifferenceAt15: 0,
        csDifferenceAt10: 0,
        csDifferenceAt15: 0,
      }),
    );
    expect(withZeros.values.GOLD_DIFF_AT_10).toBe(0);
    expect(withZeros.values.GOLD_DIFF_AT_15).toBe(0);
    expect(withZeros.values.CS_DIFF_AT_10).toBe(0);
    expect(withZeros.values.CS_DIFF_AT_15).toBe(0);
  });

  it('still extracts metrics when position is UNKNOWN', () => {
    const extracted = extractPlayerPlaystyleMatchMetrics(match({ position: 'UNKNOWN' }));
    expect(extracted.values.CS_PER_MIN).toBe(6);
    expect(extracted.values.KILLS_PER_GAME).toBe(10);
    expect(extracted.values.DEATHS_PER_GAME).toBe(0);
    expect(extracted.values.ASSISTS_PER_GAME).toBe(2);
  });
});

describe('toPlayerPlaystyleBaselineMetrics', () => {
  it('copies derived champion metrics including K/D/A per game', () => {
    const derived = {
      sampleSize: 40,
      wins: 20,
      winRate: 0.5,
      wilsonInterval: null,
      sampleConfidence: 'LOW' as const,
      aggregateKdaRatio: 3.2,
      averageKillsPerGame: 6,
      averageDeathsPerGame: 4,
      averageAssistsPerGame: 7,
      averageCsPerMinute: 7.1,
      averageDamagePerMinute: 500,
      averageVisionScorePerMinute: 0.9,
      averageGoldPerMinute: 380,
      averageGoldDifferenceAt10: 10,
      averageGoldDifferenceAt15: 20,
      averageCsDifferenceAt10: 1,
      averageCsDifferenceAt15: 2,
      latestEligibleMatchAt: null,
    };

    expect(toPlayerPlaystyleBaselineMetrics(derived)).toEqual({
      sampleSize: 40,
      sampleConfidence: 'LOW',
      aggregateKdaRatio: 3.2,
      averageKillsPerGame: 6,
      averageDeathsPerGame: 4,
      averageAssistsPerGame: 7,
      averageCsPerMinute: 7.1,
      averageGoldPerMinute: 380,
      averageDamagePerMinute: 500,
      averageVisionScorePerMinute: 0.9,
      averageGoldDifferenceAt10: 10,
      averageGoldDifferenceAt15: 20,
      averageCsDifferenceAt10: 1,
      averageCsDifferenceAt15: 2,
    });
  });
});
