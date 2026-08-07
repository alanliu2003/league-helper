import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChampionStatsConfig } from '../../config/champion-stats.config';
import type { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  COLLECTOR_COVERAGE_NEAR_FLOOR_MIN,
  COLLECTOR_EXACT_POSITIONS,
  CollectorCoverageService,
  buildNearFloorBand,
} from './collector-coverage.service';

function statsConfig(overrides: Partial<ChampionStatsConfig> = {}): ChampionStatsConfig {
  return {
    defaultPlatform: 'na1',
    defaultQueueId: 420,
    sourceNormalizationVersion: 'norm-v1',
    aggregationVersion: 'agg-v1',
    minimumSample: 30,
    confidenceLevel: 0.95,
    cacheTtlSeconds: 60,
    ...overrides,
  };
}

describe('buildNearFloorBand', () => {
  it('uses design default 20 through configuredMinSample - 1', () => {
    expect(buildNearFloorBand(30)).toEqual({ min: 20, max: 29 });
    expect(buildNearFloorBand(25)).toEqual({ min: 20, max: 24 });
  });
});

describe('CollectorCoverageService.snapshot', () => {
  let prisma: {
    championAggregate: {
      aggregate: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    match: {
      groupBy: ReturnType<typeof vi.fn>;
    };
  };
  let aggregates: {
    resolveLatestSemanticPatch: ReturnType<typeof vi.fn>;
  };
  let service: CollectorCoverageService;

  beforeEach(() => {
    prisma = {
      championAggregate: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sampleSize: 0 } }),
        count: vi.fn().mockResolvedValue(0),
      },
      match: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    aggregates = {
      resolveLatestSemanticPatch: vi.fn().mockResolvedValue('15.14'),
    };
    service = new CollectorCoverageService(
      prisma as unknown as PrismaService,
      aggregates as unknown as ChampionAggregateReadRepository,
      statsConfig(),
    );
  });

  it('queries rankTier ALL and exact positions only (never ALL-position or UNKNOWN)', async () => {
    await service.snapshot({ effectivePlatforms: ['na1'], queueId: 420 });

    const countCalls = prisma.championAggregate.count.mock.calls.map((call) => call[0]?.where);
    expect(countCalls.length).toBeGreaterThan(0);
    for (const where of countCalls) {
      expect(where?.rankTier).toBe('ALL');
      expect(['ALL', 'UNKNOWN', 'UTILITY']).not.toContain(where?.teamPosition);
      expect(COLLECTOR_EXACT_POSITIONS).toContain(where?.teamPosition);
    }
  });

  it('builds separate platform groups from effectivePlatforms', async () => {
    aggregates.resolveLatestSemanticPatch
      .mockResolvedValueOnce('15.14')
      .mockResolvedValueOnce('15.13');

    const snapshot = await service.snapshot({
      effectivePlatforms: ['na1', 'euw1'],
      queueId: 420,
    });

    expect(aggregates.resolveLatestSemanticPatch).toHaveBeenCalledTimes(2);
    expect(snapshot.platforms.map((p) => p.platform)).toEqual(['na1', 'euw1']);
    expect(snapshot.platforms[0]?.patch).toBe('15.14');
    expect(snapshot.platforms[1]?.patch).toBe('15.13');
  });

  it('uses configured minimum sample and near-floor band in summaries', async () => {
    prisma.championAggregate.aggregate.mockResolvedValue({ _max: { sampleSize: 28 } });
    prisma.championAggregate.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2);

    const snapshot = await service.snapshot({
      effectivePlatforms: ['na1'],
      queueId: 420,
    });

    expect(snapshot.minimumSample).toBe(30);
    expect(snapshot.nearFloorBand).toEqual({
      min: COLLECTOR_COVERAGE_NEAR_FLOOR_MIN,
      max: 29,
    });
    expect(snapshot.sourceNormalizationVersion).toBe('norm-v1');
    expect(snapshot.aggregationVersion).toBe('agg-v1');

    const topPosition = snapshot.platforms[0]?.positions.find((p) => p.position === 'TOP');
    expect(topPosition).toEqual({
      position: 'TOP',
      maxSampleSize: 28,
      keysWithSampleGtZero: 5,
      keysAtOrAboveFloor: 0,
      keysInNearFloorBand: 2,
    });

    const floorWhere = prisma.championAggregate.count.mock.calls[1]?.[0]?.where;
    expect(floorWhere?.sampleSize).toEqual({ gte: 30 });

    const nearFloorWhere = prisma.championAggregate.count.mock.calls[2]?.[0]?.where;
    expect(nearFloorWhere?.sampleSize).toEqual({ gte: 20, lte: 29 });
  });

  it('labels snapshot as db_snapshot and includes match patch counts for the queue', async () => {
    prisma.match.groupBy.mockResolvedValue([
      { normalizedPatch: '15.14', _count: { _all: 42 } },
      { normalizedPatch: null, _count: { _all: 3 } },
    ]);

    const snapshot = await service.snapshot({
      effectivePlatforms: ['na1'],
      queueId: 420,
    });

    expect(snapshot.label).toBe('db_snapshot');
    expect(snapshot.status).toBe('available');
    expect(prisma.match.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['normalizedPatch'],
        where: expect.objectContaining({ queueId: 420, platformRoute: 'na1' }),
      }),
    );
    expect(snapshot.platforms[0]?.matchCountsByNormalizedPatch).toEqual([
      { patch: '15.14', count: 42 },
      { patch: null, count: 3 },
    ]);
  });

  it('returns partial status when no aggregate patch resolves', async () => {
    aggregates.resolveLatestSemanticPatch.mockResolvedValue(null);

    const snapshot = await service.snapshot({
      effectivePlatforms: ['na1'],
      queueId: 420,
    });

    expect(snapshot.status).toBe('partial');
    expect(snapshot.warning).toMatch(/no aggregate patch/i);
    expect(snapshot.platforms[0]?.patch).toBeNull();
    expect(prisma.championAggregate.aggregate).not.toHaveBeenCalled();
  });

  it('snapshotSafe returns unavailable without throwing when snapshot fails', async () => {
    aggregates.resolveLatestSemanticPatch.mockRejectedValue(new Error('db down'));

    const snapshot = await service.snapshotSafe({
      effectivePlatforms: ['na1'],
      queueId: 420,
    });

    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.label).toBe('db_snapshot');
    expect(snapshot.warning).toMatch(/db down/i);
    expect(snapshot.platforms).toEqual([]);
  });

  it('filters aggregates by current normalization and aggregation versions', async () => {
    await service.snapshot({ effectivePlatforms: ['na1'], queueId: 420 });

    const where = prisma.championAggregate.aggregate.mock.calls[0]?.[0]?.where;
    expect(where?.sourceNormalizationVersion).toBe('norm-v1');
    expect(where?.aggregationVersion).toBe('agg-v1');
    expect(where?.patch).toBe('15.14');
  });

  it('does not sum samples across platforms or patches', async () => {
    aggregates.resolveLatestSemanticPatch
      .mockResolvedValueOnce('15.14')
      .mockResolvedValueOnce('15.13');
    prisma.championAggregate.aggregate
      .mockResolvedValueOnce({ _max: { sampleSize: 10 } })
      .mockResolvedValue({ _max: { sampleSize: 7 } });

    const snapshot = await service.snapshot({
      effectivePlatforms: ['na1', 'euw1'],
      queueId: 420,
    });

    expect(aggregates.resolveLatestSemanticPatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ platform: 'na1', queueId: 420 }),
    );
    expect(aggregates.resolveLatestSemanticPatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ platform: 'euw1', queueId: 420 }),
    );

    const aggregateWheres = prisma.championAggregate.aggregate.mock.calls.map(
      (call) => call[0]?.where,
    );
    expect(aggregateWheres.every((where) => where?.platformRoute === 'na1' || where?.platformRoute === 'euw1')).toBe(
      true,
    );
    expect(aggregateWheres.some((where) => where?.platformRoute === 'na1' && where?.patch === '15.14')).toBe(
      true,
    );
    expect(aggregateWheres.some((where) => where?.platformRoute === 'euw1' && where?.patch === '15.13')).toBe(
      true,
    );
    expect(snapshot.platforms[0]?.positions[0]?.maxSampleSize).toBe(10);
    expect(snapshot.platforms[1]?.positions[0]?.maxSampleSize).toBe(7);
  });
});
