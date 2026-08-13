import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionMatchupsQuerySchema,
  ChampionMatchupsResponseSchema,
  RANK_TIER_SEMANTICS,
} from './index';

describe('ChampionMatchupsQuerySchema', () => {
  it('requires a reliable position', () => {
    expect(() => ChampionMatchupsQuerySchema.parse({})).toThrow();
    expect(ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE' }).position).toBe('MIDDLE');
  });

  it('rejects invalid position', () => {
    expect(() => ChampionMatchupsQuerySchema.parse({ position: 'UNKNOWN' })).toThrow();
    expect(() => ChampionMatchupsQuerySchema.parse({ position: 'UTILITY' })).toThrow();
    expect(() => ChampionMatchupsQuerySchema.parse({ position: 'MID' })).toThrow();
  });

  it('rejects invalid rankScope tokens', () => {
    expect(() =>
      ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE', rankScope: 'FOO' }),
    ).toThrow();
    expect(() =>
      ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE', rankScope: 'HIGH' }),
    ).toThrow();
    expect(() =>
      ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE', rankScope: 'EXACT:PLAT' }),
    ).toThrow();
  });

  it('accepts ALL, EXACT, and SEGMENT cache tokens', () => {
    expect(
      ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE', rankScope: 'ALL' }).rankScope,
    ).toBe('ALL');
    expect(
      ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE', rankScope: 'EXACT:GOLD' }).rankScope,
    ).toBe('EXACT:GOLD');
    expect(
      ChampionMatchupsQuerySchema.parse({ position: 'MIDDLE', rankScope: 'SEGMENT:HIGH' })
        .rankScope,
    ).toBe('SEGMENT:HIGH');
  });
});

describe('ChampionMatchupsResponseSchema', () => {
  it('parses an empty collected-sample envelope without player identity', () => {
    const parsed = ChampionMatchupsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: { kind: 'COLLECTED_SAMPLE', platform: 'na1', patch: '16.15', queueId: 420 },
      resolvedFilters: {
        platform: 'na1',
        patch: '16.15',
        queueId: 420,
        tier: 'ALL',
        position: 'MIDDLE',
      },
      emptyReason: 'NO_ELIGIBLE_MATCHUPS',
      displayFloor: 10,
      rankingPolicy: 'WILSON_LOWER_BOUND',
      totalEligiblePairs: 0,
      totalSourcePairs: 0,
      strongAgainst: [],
      weakAgainst: [],
    });
    expect(parsed.emptyReason).toBe('NO_ELIGIBLE_MATCHUPS');
    expect(JSON.stringify(parsed)).not.toMatch(/puuid/i);
  });
});
