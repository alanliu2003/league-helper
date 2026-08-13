import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionBuildsQuerySchema,
  ChampionBuildsResponseSchema,
  ChampionCoreBuildSchema,
  RANK_TIER_SEMANTICS,
} from './index';

describe('ChampionBuildsQuerySchema', () => {
  it('requires position', () => {
    expect(() => ChampionBuildsQuerySchema.parse({})).toThrow();
    expect(ChampionBuildsQuerySchema.parse({ position: 'MIDDLE' }).position).toBe('MIDDLE');
  });

  it('rejects UNKNOWN position and accepts UNKNOWN rank for the service to hide', () => {
    expect(() => ChampionBuildsQuerySchema.parse({ position: 'UNKNOWN' })).toThrow();
    expect(ChampionBuildsQuerySchema.parse({ position: 'SUPPORT', tier: 'UNKNOWN' }).tier).toBe(
      'UNKNOWN',
    );
  });
});

describe('ChampionBuildsResponseSchema', () => {
  it('parses an empty collected-sample envelope', () => {
    const parsed = ChampionBuildsResponseSchema.parse({
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
      emptyReason: 'CHAMPION_HAS_NO_BUILDS',
      eligibility: {
        startingItemsEligibleGames: 0,
        coreBuildsEligibleGames: 0,
        bootsEligibleGames: 0,
        runesEligibleGames: 0,
        summonerSpellsEligibleGames: 0,
        skillOrderEligibleGames: 0,
      },
      startingItems: [],
      coreBuilds: [],
      boots: [],
      runes: [],
      summonerSpells: [],
      skillOrder: [],
    });
    expect(parsed.emptyReason).toBe('CHAMPION_HAS_NO_BUILDS');
  });

  it('rejects core builds that are not exactly three items', () => {
    const metrics = {
      sampleSize: 10,
      pickRate: 0.5,
      wins: 5,
      winRate: 0.5,
      lowSample: false,
      sampleBand: 'STRONG' as const,
    };
    const item = { id: 3116, name: "Rylai's Crystal Scepter", iconUrl: null };
    expect(() => ChampionCoreBuildSchema.parse({ ...metrics, items: [item] })).toThrow();
    expect(() => ChampionCoreBuildSchema.parse({ ...metrics, items: [item, item] })).toThrow();
    expect(
      ChampionCoreBuildSchema.parse({ ...metrics, items: [item, item, item] }).items,
    ).toHaveLength(3);
  });
});
