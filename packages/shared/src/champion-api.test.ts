import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AggregateDimensionsSchema,
  CHAMPION_STATS_DISCLAIMER,
  ChampionAggregateMetricsSchema,
  ChampionAggregateRowSchema,
  ChampionDetailSchema,
  ChampionStatsEmptyReasonSchema,
  ChampionStatsQuerySchema,
  ChampionStatsResponseSchema,
  ChampionStatsTableQuerySchema,
  ChampionStatsTableResponseSchema,
  RANK_TIER_SEMANTICS,
} from './champion-api';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  CHAMPION_AGGREGATION_QUEUE_NAME,
} from './job-queues/queue-names';
import { supportsStandardPositions } from './match-queues';
import * as shared from './index';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ChampionStatsTableQuerySchema', () => {
  it('requires position for table query', () => {
    expect(() => ChampionStatsTableQuerySchema.parse({ platform: 'na1', queueId: 420 })).toThrow();
  });

  it.each(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'] as const)(
    'accepts standard position %s',
    (position) => {
      expect(ChampionStatsTableQuerySchema.parse({ position }).position).toBe(position);
    },
  );

  it.each(['ALL', 'UNKNOWN'] as const)('rejects ranking position %s', (position) => {
    expect(() => ChampionStatsTableQuerySchema.parse({ position })).toThrow();
  });

  it.each(['UTILITY', 'SOLO', 'DUO', 'DUO_CARRY', 'DUO_SUPPORT'] as const)(
    'rejects raw Riot role %s',
    (position) => {
      expect(() => ChampionStatsTableQuerySchema.parse({ position })).toThrow();
    },
  );

  it('rejects platform ALL and empty string', () => {
    expect(() =>
      ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE', platform: 'ALL' }),
    ).toThrow();
    expect(() =>
      ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE', platform: '' }),
    ).toThrow();
  });

  it('rejects queueId sentinel -1', () => {
    expect(() =>
      ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE', queueId: -1 }),
    ).toThrow();
  });

  it('accepts tier ALL and UNKNOWN', () => {
    expect(ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE', tier: 'ALL' }).tier).toBe(
      'ALL',
    );
    expect(
      ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE', tier: 'UNKNOWN' }).tier,
    ).toBe('UNKNOWN');
    expect(ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE', tier: 'GOLD' }).tier).toBe(
      'GOLD',
    );
  });
});

describe('ChampionStatsQuerySchema', () => {
  it('allows omitted position for metadata + breakdown', () => {
    expect(ChampionStatsQuerySchema.parse({}).position).toBeUndefined();
  });

  it('accepts only the five standard positions when present', () => {
    expect(ChampionStatsQuerySchema.parse({ position: 'SUPPORT' }).position).toBe('SUPPORT');
    expect(() => ChampionStatsQuerySchema.parse({ position: 'UNKNOWN' })).toThrow();
    expect(() => ChampionStatsQuerySchema.parse({ position: 'UTILITY' })).toThrow();
  });
});

describe('champion response schemas', () => {
  const dimensions = {
    championId: 103,
    patch: '14.1',
    platform: 'na1' as const,
    regionalRoute: 'americas' as const,
    queueId: 420,
    rankTier: 'ALL' as const,
    position: 'MIDDLE' as const,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  };

  const metrics = {
    sampleSize: 100,
    wins: 55,
    winRate: 0.55,
    wilsonInterval: {
      lowerBound: 0.45,
      upperBound: 0.65,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'MEDIUM' as const,
    aggregateKdaRatio: 3.2,
    averageCsPerMinute: 7.1,
    averageDamagePerMinute: 600,
    averageVisionScorePerMinute: 1.2,
    averageGoldDifferenceAt10: 120,
    averageGoldDifferenceAt15: 200,
    averageCsDifferenceAt10: 5,
    averageCsDifferenceAt15: 8,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
  };

  const champion = {
    championId: 103,
    championKey: 'Ahri',
    name: 'Ahri',
    title: 'the Nine-Tailed Fox',
    tags: ['Mage', 'Assassin'],
    iconUrl: 'https://example.com/ahri.png',
  };

  it('rejects NaN and Infinity in numeric metric fields', () => {
    expect(() =>
      ChampionAggregateMetricsSchema.parse({ ...metrics, winRate: Number.NaN }),
    ).toThrow();
    expect(() =>
      ChampionAggregateMetricsSchema.parse({ ...metrics, winRate: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });

  it('keeps disclaimer only at envelope level (row has no disclaimer field)', () => {
    const row = ChampionAggregateRowSchema.parse({
      champion,
      dimensions,
      metrics,
    });
    expect(row).not.toHaveProperty('disclaimer');
    expect(ChampionAggregateRowSchema.shape).not.toHaveProperty('disclaimer');

    const table = ChampionStatsTableResponseSchema.parse({
      rows: [],
      emptyReason: 'NO_MATCHING_AGGREGATES',
      pagination: { nextCursor: null, limit: 50, offset: 0, totalCount: 0 },
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
      },
      freshness: 'CURRENT',
      requestedFilters: { position: 'MIDDLE' },
      resolvedFilters: {
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
        tier: 'ALL',
        position: 'MIDDLE',
      },
      usedDefaultPlatform: true,
      usedDefaultPatch: true,
      effectiveMinimumSample: 30,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    });
    expect(table.disclaimer).toBe(CHAMPION_STATS_DISCLAIMER);
  });

  it('uses championId not championKey on AggregateDimensions', () => {
    expect(AggregateDimensionsSchema.shape).toHaveProperty('championId');
    expect(AggregateDimensionsSchema.shape).not.toHaveProperty('championKey');
    expect(AggregateDimensionsSchema.parse(dimensions).championId).toBe(103);
  });

  it('represents known champion with stats:null and emptyReason', () => {
    const response = ChampionStatsResponseSchema.parse({
      champion,
      stats: null,
      emptyReason: 'CHAMPION_HAS_NO_STATS',
      positionBreakdown: [],
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
      },
      freshness: 'UNKNOWN',
      requestedFilters: {},
      resolvedFilters: {
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
        tier: 'ALL',
        position: null,
      },
      usedDefaultPlatform: true,
      usedDefaultPatch: true,
      effectiveMinimumSample: 30,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    });

    expect(response.stats).toBeNull();
    expect(response.emptyReason).toBe('CHAMPION_HAS_NO_STATS');
  });

  it('represents empty table rows with emptyReason', () => {
    const response = ChampionStatsTableResponseSchema.parse({
      rows: [],
      emptyReason: 'NO_MATCHING_AGGREGATES',
      pagination: { nextCursor: null, limit: 50, offset: 0, totalCount: 0 },
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      rankTierSemantics: RANK_TIER_SEMANTICS,
      sampleScope: {
        kind: 'COLLECTED_SAMPLE',
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
      },
      freshness: 'CURRENT',
      requestedFilters: { position: 'TOP' },
      resolvedFilters: {
        platform: 'na1',
        patch: '14.1',
        queueId: 420,
        tier: 'ALL',
        position: 'TOP',
      },
      usedDefaultPlatform: false,
      usedDefaultPatch: false,
      effectiveMinimumSample: 0,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    });

    expect(response.rows).toEqual([]);
    expect(ChampionStatsEmptyReasonSchema.parse(response.emptyReason)).toBe(
      'NO_MATCHING_AGGREGATES',
    );
  });

  it('omits unstable Data Dragon ability/baseStat blobs from ChampionDetail', () => {
    expect(ChampionDetailSchema.shape).not.toHaveProperty('passive');
    expect(ChampionDetailSchema.shape).not.toHaveProperty('spells');
    expect(ChampionDetailSchema.shape).not.toHaveProperty('baseStats');
    expect(ChampionDetailSchema.shape).not.toHaveProperty('rawPayload');
  });
});

describe('champion contract hygiene', () => {
  it('does not use z.unknown() in champion-api contracts', () => {
    const source = readFileSync(join(__dirname, 'champion-api.ts'), 'utf8');
    expect(source).not.toMatch(/z\.unknown\s*\(/);
  });

  it('does not expose puuid / raw payload / internal secret fields in champion schemas', () => {
    const files = ['champion-api.ts', 'champion-stats-cache.ts', 'job-queues/champion-aggregation-job.ts'];
    for (const relative of files) {
      const source = readFileSync(join(__dirname, relative), 'utf8');
      expect(source.toLowerCase()).not.toMatch(/\bpuuid\b/);
      expect(source).not.toMatch(/rawPayload/);
      expect(source).not.toMatch(/DATABASE_URL|REDIS_URL|RIOT_API_KEY|process\.env/);
    }
  });

  it('exports champion API, cache, and aggregation job symbols from package index', () => {
    expect(shared.CHAMPION_STATS_DISCLAIMER).toBe(CHAMPION_STATS_DISCLAIMER);
    expect(shared.RANK_TIER_SEMANTICS).toBe(RANK_TIER_SEMANTICS);
    expect(shared.ChampionStatsTableQuerySchema).toBe(ChampionStatsTableQuerySchema);
    expect(shared.ChampionStatsQuerySchema).toBe(ChampionStatsQuerySchema);
    expect(shared.AggregateDimensionsSchema).toBe(AggregateDimensionsSchema);
    expect(shared.buildChampionStatsGenerationKey).toBeTypeOf('function');
    expect(shared.buildChampionAggregationBullMqJobId).toBeTypeOf('function');
    expect(shared.CHAMPION_AGGREGATION_QUEUE_NAME).toBe(CHAMPION_AGGREGATION_QUEUE_NAME);
    expect(shared.CHAMPION_AGGREGATION_JOB_NAME).toBe(CHAMPION_AGGREGATION_JOB_NAME);
    expect(shared.supportsStandardPositions).toBe(supportsStandardPositions);
  });
});

describe('supportsStandardPositions', () => {
  it('marks standard SR queues true and ARAM/Arena/Custom false', () => {
    for (const queueId of [420, 440, 400, 430, 490, 480]) {
      expect(supportsStandardPositions(queueId)).toBe(true);
    }
    expect(supportsStandardPositions(450)).toBe(false);
    expect(supportsStandardPositions(1700)).toBe(false);
    expect(supportsStandardPositions(0)).toBe(false);
  });
});
