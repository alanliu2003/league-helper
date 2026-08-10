import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChampionStatsConfig } from '../../config/champion-stats.config';
import type { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import type { PrismaService } from '../../prisma/prisma.service';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import {
  COLLECTOR_COVERAGE_NEAR_FLOOR_MIN,
  COLLECTOR_EXACT_POSITIONS,
  COVERAGE_DENSITY_THRESHOLDS,
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

function collectorConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    ...loadCollectorConfig({}),
    expansionMaxTrackedPlayers: 500,
    ladderMaxTotal: 1500,
    totalTrackedPlayersHardCap: 5000,
    coldAfterZeroNewRuns: 3,
    ...overrides,
  };
}

type PrismaMock = {
  championAggregate: {
    aggregate: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  match: {
    groupBy: ReturnType<typeof vi.fn>;
  };
  trackedPlayer: {
    groupBy: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  collectorPopulationBudget: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  patch: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  championStaticData: {
    findMany: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
  trackedPlayerCreate?: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('buildNearFloorBand', () => {
  it('uses design default 20 through configuredMinSample - 1', () => {
    expect(buildNearFloorBand(30)).toEqual({ min: 20, max: 29 });
    expect(buildNearFloorBand(25)).toEqual({ min: 20, max: 24 });
  });
});

describe('CollectorCoverageService.snapshot', () => {
  let prisma: PrismaMock;
  let aggregates: {
    resolveLatestSemanticPatch: ReturnType<typeof vi.fn>;
  };
  let service: CollectorCoverageService;

  beforeEach(() => {
    prisma = {
      championAggregate: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sampleSize: 0 } }),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      match: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
      trackedPlayer: {
        groupBy: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      collectorPopulationBudget: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      patch: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      championStaticData: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    aggregates = {
      resolveLatestSemanticPatch: vi.fn().mockResolvedValue('15.14'),
    };
    service = new CollectorCoverageService(
      prisma as unknown as PrismaService,
      aggregates as unknown as ChampionAggregateReadRepository,
      statsConfig(),
      collectorConfig(),
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
    expect(
      aggregateWheres.every(
        (where) => where?.platformRoute === 'na1' || where?.platformRoute === 'euw1',
      ),
    ).toBe(true);
    expect(
      aggregateWheres.some((where) => where?.platformRoute === 'na1' && where?.patch === '15.14'),
    ).toBe(true);
    expect(
      aggregateWheres.some((where) => where?.platformRoute === 'euw1' && where?.patch === '15.13'),
    ).toBe(true);
    expect(snapshot.platforms[0]?.positions[0]?.maxSampleSize).toBe(10);
    expect(snapshot.platforms[1]?.positions[0]?.maxSampleSize).toBe(7);
  });
});

describe('CollectorCoverageService.report', () => {
  let prisma: PrismaMock;
  let aggregates: {
    resolveLatestSemanticPatch: ReturnType<typeof vi.fn>;
  };
  let service: CollectorCoverageService;
  let writeSpies: Array<ReturnType<typeof vi.fn>>;

  function mockDensityCounts(sampleSize: number): void {
    // report() -> snapshot() uses 3 counts per position × 5 positions, then density uses more.
    // Use implementation that inspects the where.sampleSize predicate.
    prisma.championAggregate.count.mockImplementation(async (args: { where?: { sampleSize?: unknown } }) => {
      const sample = args.where?.sampleSize as
        | { gte?: number; gt?: number; lte?: number }
        | undefined;
      if (!sample) {
        return 0;
      }
      if (typeof sample.gt === 'number') {
        return sampleSize > sample.gt ? 1 : 0;
      }
      if (typeof sample.gte === 'number' && typeof sample.lte === 'number') {
        return sampleSize >= sample.gte && sampleSize <= sample.lte ? 1 : 0;
      }
      if (typeof sample.gte === 'number') {
        return sampleSize >= sample.gte ? 1 : 0;
      }
      return 0;
    });
    prisma.championAggregate.aggregate.mockResolvedValue({ _max: { sampleSize } });
    prisma.championAggregate.groupBy.mockResolvedValue([
      { sampleSize, _count: { _all: 1 } },
    ]);
  }

  beforeEach(() => {
    writeSpies = [vi.fn(), vi.fn(), vi.fn()];
    prisma = {
      championAggregate: {
        aggregate: vi.fn().mockResolvedValue({ _max: { sampleSize: 0 } }),
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
        findMany: vi.fn().mockResolvedValue([]),
      },
      match: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
      trackedPlayer: {
        groupBy: vi.fn().mockImplementation(async (args: { by: string[] }) => {
          if (args.by[0] === 'enrollmentSource') {
            return [];
          }
          return [];
        }),
        count: vi.fn().mockResolvedValue(0),
      },
      collectorPopulationBudget: {
        findUnique: vi.fn().mockResolvedValue({ matchParticipantEnrolledCount: 0 }),
      },
      patch: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patch-1',
          version: '15.14.1',
          normalizedMajorMinor: '15.14',
        }),
      },
      championStaticData: {
        findMany: vi.fn().mockResolvedValue([
          { championId: 1, championKey: 'Annie' },
          { championId: 2, championKey: 'Olaf' },
        ]),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      create: writeSpies[0]!,
      update: writeSpies[1]!,
      delete: writeSpies[2]!,
    };
    aggregates = {
      resolveLatestSemanticPatch: vi.fn().mockResolvedValue('15.14'),
    };
    service = new CollectorCoverageService(
      prisma as unknown as PrismaService,
      aggregates as unknown as ChampionAggregateReadRepository,
      statsConfig(),
      collectorConfig(),
    );
  });

  it('returns a valid empty report without crashing', async () => {
    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    expect(report.ok).toBe(true);
    expect(report.mode).toBe('coverage');
    expect(report.label).toBe('population_coverage_observability');
    expect(report.trackedPlayers.total).toBe(0);
    expect(report.trackedPlayers.byEnrollmentSource).toMatchObject({
      ADMIN_SEED: 0,
      PRODUCT_SEARCH: 0,
      BOOTSTRAP: 0,
      LADDER: 0,
      MATCH_PARTICIPANT: 0,
    });
    expect(report.championCoverage.platforms[0]?.density).toEqual({
      championPositionKeysGte1: 0,
      championPositionKeysGte30: 0,
      championPositionKeysGte100: 0,
    });
    expect(report.championCoverage.densityThresholds).toEqual(COVERAGE_DENSITY_THRESHOLDS);
    expect(report.championCoverage.minimumSampleRankingFloor).toBe(30);
  });

  it('places sampleSize=1 in >=1 only', async () => {
    mockDensityCounts(1);

    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });
    const density = report.championCoverage.platforms[0]?.density;

    expect(density?.championPositionKeysGte1).toBeGreaterThan(0);
    expect(density?.championPositionKeysGte30).toBe(0);
    expect(density?.championPositionKeysGte100).toBe(0);
  });

  it('places sampleSize=30 in >=1 and >=30 but not >=100', async () => {
    mockDensityCounts(30);

    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });
    const density = report.championCoverage.platforms[0]?.density;

    expect(density?.championPositionKeysGte1).toBeGreaterThan(0);
    expect(density?.championPositionKeysGte30).toBeGreaterThan(0);
    expect(density?.championPositionKeysGte100).toBe(0);
  });

  it('places sampleSize=100 in all density buckets', async () => {
    mockDensityCounts(100);

    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });
    const density = report.championCoverage.platforms[0]?.density;

    expect(density?.championPositionKeysGte1).toBeGreaterThan(0);
    expect(density?.championPositionKeysGte30).toBeGreaterThan(0);
    expect(density?.championPositionKeysGte100).toBeGreaterThan(0);
  });

  it('excludes UNKNOWN from reported positions and density queries', async () => {
    mockDensityCounts(5);
    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    expect(report.championCoverage.positions).toEqual(COLLECTOR_EXACT_POSITIONS);
    expect(report.championCoverage.positions).not.toContain('UNKNOWN');
    expect(report.championCoverage.platforms[0]?.byPosition.map((row) => row.position)).toEqual(
      COLLECTOR_EXACT_POSITIONS,
    );

    const densityWheres = prisma.championAggregate.count.mock.calls
      .map((call) => call[0]?.where)
      .filter((where) => where?.teamPosition != null);
    for (const where of densityWheres) {
      if (typeof where.teamPosition === 'string') {
        expect(where.teamPosition).not.toBe('UNKNOWN');
        expect(COLLECTOR_EXACT_POSITIONS).toContain(where.teamPosition);
      } else if (where.teamPosition?.in) {
        expect(where.teamPosition.in).toEqual([...COLLECTOR_EXACT_POSITIONS]);
        expect(where.teamPosition.in).not.toContain('UNKNOWN');
      }
    }
  });

  it('filters by current semantic patch from resolveLatestSemanticPatch', async () => {
    aggregates.resolveLatestSemanticPatch.mockResolvedValue('16.15');
    mockDensityCounts(1);

    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    expect(aggregates.resolveLatestSemanticPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'na1',
        queueId: 420,
        versions: {
          sourceNormalizationVersion: 'norm-v1',
          aggregationVersion: 'agg-v1',
        },
      }),
    );
    expect(report.championCoverage.platforms[0]?.semanticPatch).toBe('16.15');

    const densityWhere = prisma.championAggregate.count.mock.calls.find(
      (call) => call[0]?.where?.teamPosition?.in != null,
    )?.[0]?.where;
    expect(densityWhere?.patch).toBe('16.15');
  });

  it('filters by queue id', async () => {
    mockDensityCounts(1);
    await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    expect(prisma.match.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ queueId: 420, platformRoute: 'na1' }),
      }),
    );
    const densityWhere = prisma.championAggregate.count.mock.calls.find(
      (call) => call[0]?.where?.teamPosition?.in != null,
    )?.[0]?.where;
    expect(densityWhere?.queueId).toBe(420);
  });

  it('filters density aggregates by rankTier ALL', async () => {
    mockDensityCounts(1);
    await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    const densityWhere = prisma.championAggregate.count.mock.calls.find(
      (call) => call[0]?.where?.teamPosition?.in != null,
    )?.[0]?.where;
    expect(densityWhere?.rankTier).toBe('ALL');
  });

  it('reports enrollment source counts including LADDER', async () => {
    prisma.trackedPlayer.groupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by[0] === 'enrollmentSource') {
        return [
          { enrollmentSource: 'ADMIN_SEED', _count: { _all: 2 } },
          { enrollmentSource: 'LADDER', _count: { _all: 7 } },
          { enrollmentSource: 'MATCH_PARTICIPANT', _count: { _all: 3 } },
        ];
      }
      if (args.by[0] === 'platformRoute') {
        return [{ platformRoute: 'na1', _count: { _all: 12 } }];
      }
      if (args.by[0] === 'discoveryDepth') {
        return [
          { discoveryDepth: 0, _count: { _all: 9 } },
          { discoveryDepth: 1, _count: { _all: 3 } },
        ];
      }
      if (args.by[0] === 'status') {
        return [{ status: 'ACTIVE', _count: { _all: 12 } }];
      }
      return [];
    });
    prisma.trackedPlayer.count.mockResolvedValue(12);

    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    expect(report.trackedPlayers.total).toBe(12);
    expect(report.trackedPlayers.byEnrollmentSource).toEqual({
      ADMIN_SEED: 2,
      PRODUCT_SEARCH: 0,
      BOOTSTRAP: 0,
      LADDER: 7,
      MATCH_PARTICIPANT: 3,
    });
    expect(report.trackedPlayers.byPlatformRoute).toEqual({ na1: 12 });
    expect(report.trackedPlayers.byDiscoveryDepth).toEqual({ '0': 9, '1': 3 });
  });

  it('does not mutate via create/update/delete during report', async () => {
    mockDensityCounts(1);
    prisma.championStaticData.findMany.mockResolvedValue([
      { championId: 103, championKey: 'Ahri' },
    ]);
    prisma.championAggregate.findMany.mockResolvedValue([{ championId: 103 }]);

    await service.report({ effectivePlatforms: ['na1'], queueId: 420 });

    for (const spy of writeSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
    // $queryRaw is used for SELECTs only in report path; ensure no write-looking SQL.
    for (const call of prisma.$queryRaw.mock.calls) {
      const sql = String(call[0]?.strings?.join(' ') ?? call[0] ?? '');
      expect(sql.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    }
  });

  it('marks matches-by-tier unavailable instead of fabricating zeros', async () => {
    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });
    const ladder = report.championCoverage.platforms[0]?.ladderRepresentation;

    expect(ladder?.currentPatchQueueMatchesByTier.status).toBe('unavailable');
    expect(ladder?.currentPatchQueueMatchesByTier.reason).toMatch(/ambiguous/i);
  });

  it('computes classic-zero from public ChampionStaticData roster', async () => {
    mockDensityCounts(1);
    prisma.championStaticData.findMany.mockResolvedValue([
      { championId: 1, championKey: 'Annie' },
      { championId: 2, championKey: 'Olaf' },
      { championId: 60001, championKey: 'Jade_Annie' },
      { championId: 3, championKey: 'Bad_Key' },
    ]);
    prisma.championAggregate.findMany.mockResolvedValue([{ championId: 1 }]);

    const report = await service.report({ effectivePlatforms: ['na1'], queueId: 420 });
    const classicZero = report.championCoverage.platforms[0]?.classicZero;

    expect(classicZero?.status).toBe('available');
    expect(classicZero?.rosterSource).toBe('ChampionStaticData_public');
    expect(classicZero?.totalRosterChampions).toBe(2); // Annie + Olaf only
    expect(classicZero?.championsWithZeroQualifyingCoverage).toBe(1); // Olaf
  });

  it('reportSafe returns structured failure report without throwing', async () => {
    prisma.trackedPlayer.count.mockRejectedValue(new Error('db exploded'));

    const report = await service.reportSafe({ effectivePlatforms: ['na1'], queueId: 420 });

    expect(report.ok).toBe(true);
    expect(report.mode).toBe('coverage');
    expect(report.warnings.join(' ')).toMatch(/db exploded/i);
    expect(report.densitySnapshot.status).toBe('unavailable');
  });
});
