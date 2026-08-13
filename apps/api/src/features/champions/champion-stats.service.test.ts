import { describe, expect, it, vi } from 'vitest';
import {
  ChampionNotFoundError,
  ChampionStatsInvalidFilterError,
  ChampionStatsPositionRequiredError,
  type ChampionStatsTableQuery,
} from '@league-helper/shared';
import {
  assertTablePositionPresent,
  computeEffectiveMinimumSample,
} from './champion-stats-filters';
import { ChampionStatsService } from './champion-stats.service';
import { pickLatestSemanticPatch } from '../../persistence/champion-aggregate-read.repository';

const ahri = {
  championId: 103,
  championKey: 'Ahri',
  name: 'Ahri',
  title: 'the Nine-Tailed Fox',
  tags: ['Mage'],
  patchVersion: '14.1.1',
  dataDragonVersion: '14.1.1',
};

const config = {
  defaultPlatform: 'na1' as const,
  defaultQueueId: 420,
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
  minimumSample: 30,
  confidenceLevel: 0.95,
  cacheTtlSeconds: 60,
};

function baseAggregate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agg-1',
    patch: '16.10',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    rankTier: 'ALL',
    teamPosition: 'MIDDLE',
    championId: 103,
    sampleSize: 40,
    wins: 22,
    totalKills: 100,
    totalDeaths: 50,
    totalAssists: 80,
    totalCs: 800,
    totalGameSeconds: 12_000,
    totalDamageToChampions: 90_000,
    totalVisionScore: 400,
    totalGoldDifferenceAt10: 400,
    goldDifferenceAt10Samples: 40,
    totalGoldDifferenceAt15: 800,
    goldDifferenceAt15Samples: 40,
    totalCsDifferenceAt10: 20,
    csDifferenceAt10Samples: 40,
    totalCsDifferenceAt15: 40,
    csDifferenceAt15Samples: 40,
    aggregationVersion: '1',
    latestEligibleMatchAt: new Date('2026-01-01T00:00:00.000Z'),
    calculatedAt: new Date('2026-01-02T00:00:00.000Z'),
    sourceNormalizationVersion: '1',
    ...overrides,
  };
}

function createService(
  overrides: {
    exact?: ReturnType<typeof baseAggregate> | null;
    breakdown?: Array<ReturnType<typeof baseAggregate>>;
    tableRows?: Array<ReturnType<typeof baseAggregate>>;
    totalCount?: number;
    latestPatch?: string | null;
    freshness?: 'CURRENT' | 'RECALCULATION_PENDING' | 'UNKNOWN';
    cacheGet?: unknown | null;
    generation?: number;
    setResult?: 'written' | 'skipped' | 'failed';
    findByKey?: typeof ahri | null;
  } = {},
) {
  const aggregates = {
    resolveLatestSemanticPatch: vi.fn(async () =>
      overrides.latestPatch === undefined ? '16.10' : overrides.latestPatch,
    ),
    listDistinctPatches: vi.fn(async () => ['16.9', '16.10']),
    listAvailablePlatforms: vi.fn(async () => ['na1', 'euw1']),
    listAvailableQueueIds: vi.fn(async () => [420, 440]),
    findExactAggregate: vi.fn(async (input: { scope: { minimumSample: number } }) => {
      const row = overrides.exact === undefined ? baseAggregate() : overrides.exact;
      if (row === null) {
        return null;
      }
      // Mirror repository `sampleSize: { gte: scope.minimumSample }`.
      return row.sampleSize >= input.scope.minimumSample ? row : null;
    }),
    findPositionBreakdown: vi.fn(async (input: { scope: { minimumSample: number } }) => {
      const rows = overrides.breakdown ?? [baseAggregate()];
      return rows.filter((row) => row.sampleSize >= input.scope.minimumSample);
    }),
    findTableRows: vi.fn(async (input: { scope: { minimumSample: number } }) => {
      const rows = (overrides.tableRows ?? [baseAggregate()]).filter(
        (row) => row.sampleSize >= input.scope.minimumSample,
      );
      return {
        rows,
        totalCount: overrides.totalCount ?? rows.length,
      };
    }),
    resolveFreshness: vi.fn(async () => overrides.freshness ?? 'CURRENT'),
  };

  const staticChampions = {
    findByChampionIds: vi.fn(async () => new Map([[103, ahri]])),
  };

  const championStatic = {
    requireByKey: vi.fn(async (key: string) => {
      if (overrides.findByKey === null) {
        throw new ChampionNotFoundError();
      }
      if (/^\d+$/.test(key.trim())) {
        throw new ChampionNotFoundError();
      }
      return overrides.findByKey ?? ahri;
    }),
  };

  const media = {
    buildChampionIconUrl: vi.fn(
      (key: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`,
    ),
    buildChampionSplashUrl: vi.fn(
      (key: string) => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_0.jpg`,
    ),
    buildPassiveIconUrl: vi.fn(
      (imageFull: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${imageFull}`,
    ),
    buildSpellIconUrl: vi.fn(
      (imageFull: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${imageFull}`,
    ),
  };

  const cache = {
    getGeneration: vi.fn(async () => overrides.generation ?? 1),
    getParsed: vi.fn(async () => overrides.cacheGet ?? null),
    setIfGenerationCurrent: vi.fn(async () => overrides.setResult ?? 'written'),
    tableKey: vi.fn((input: { generation: number }) => `table:${input.generation}`),
    championKey: vi.fn((input: { generation: number }) => `champion:${input.generation}`),
    filtersKey: vi.fn((input: { generation: number }) => `filters:${input.generation}`),
  };

  const service = new ChampionStatsService(
    config,
    aggregates as never,
    staticChampions as never,
    championStatic as never,
    media as never,
    cache as never,
  );

  return { service, aggregates, championStatic, cache, staticChampions };
}

describe('champion stats helpers', () => {
  it('requires position for ranking table', () => {
    expect(() => assertTablePositionPresent({})).toThrow(ChampionStatsPositionRequiredError);
  });

  it('computes effectiveMinimumSample from includeInsufficient and config floor', () => {
    expect(computeEffectiveMinimumSample(config, { includeInsufficient: false })).toBe(30);
    expect(computeEffectiveMinimumSample(config, { includeInsufficient: true })).toBe(0);
    expect(
      computeEffectiveMinimumSample(config, { minimumSample: 50, includeInsufficient: false }),
    ).toBe(50);
  });

  it('picks latest semantic patch (16.10 > 16.9)', () => {
    expect(pickLatestSemanticPatch(['16.9', '16.10', '16.2'])).toBe('16.10');
  });
});

describe('ChampionStatsService', () => {
  it('rejects cursor pagination with CHAMPION_STATS_INVALID_FILTER', async () => {
    const { service, aggregates } = createService();

    await expect(
      service.getTable({
        position: 'MIDDLE',
        tier: 'ALL',
        sortBy: 'winRate',
        sortDirection: 'desc',
        limit: 50,
        cursor: 'opaque-cursor',
      } as ChampionStatsTableQuery),
    ).rejects.toBeInstanceOf(ChampionStatsInvalidFilterError);

    expect(aggregates.findTableRows).not.toHaveBeenCalled();
  });

  it('uses default platform and semantic default patch for table ranking', async () => {
    const { service, aggregates } = createService();
    const query = {
      position: 'MIDDLE',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery;

    const response = await service.getTable(query);

    expect(response.usedDefaultPlatform).toBe(true);
    expect(response.usedDefaultPatch).toBe(true);
    expect(response.resolvedFilters.platform).toBe('na1');
    expect(response.resolvedFilters.patch).toBe('16.10');
    expect(response.effectiveMinimumSample).toBe(30);
    expect(response.rows[0]?.metrics.sampleSize).toBe(40);
    expect(response.sampleScope.kind).toBe('COLLECTED_SAMPLE');
    expect(aggregates.resolveLatestSemanticPatch).toHaveBeenCalled();
  });

  it('returns empty table with emptyReason when no aggregates match', async () => {
    const { service } = createService({ tableRows: [], totalCount: 0 });
    const response = await service.getTable({
      position: 'TOP',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    expect(response.rows).toEqual([]);
    expect(response.emptyReason).toBe('NO_MATCHING_AGGREGATES');
    expect(response.pagination.totalCount).toBe(0);
  });

  it('hides ranking rows below configured minimum sample with BELOW_MINIMUM_SAMPLE', async () => {
    const { service, aggregates } = createService({ tableRows: [], totalCount: 0 });
    aggregates.findTableRows
      .mockResolvedValueOnce({ rows: [], totalCount: 0 })
      .mockResolvedValueOnce({
        rows: [baseAggregate({ sampleSize: config.minimumSample - 1 })],
        totalCount: 1,
      });

    const response = await service.getTable({
      position: 'MIDDLE',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    expect(response.rows).toEqual([]);
    expect(response.emptyReason).toBe('BELOW_MINIMUM_SAMPLE');
    expect(response.effectiveMinimumSample).toBe(config.minimumSample);
  });

  it('shows ranking rows at exactly configured minimum sample', async () => {
    const { service } = createService({
      tableRows: [
        baseAggregate({
          sampleSize: config.minimumSample,
          teamPosition: 'MIDDLE',
          rankTier: 'ALL',
        }),
      ],
      totalCount: 1,
    });

    const response = await service.getTable({
      position: 'MIDDLE',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    expect(response.rows).toHaveLength(1);
    expect(response.rows[0]?.metrics.sampleSize).toBe(config.minimumSample);
    expect(response.emptyReason).toBeUndefined();
  });

  it('queries ALL-tier materialized rows for tier=ALL (does not sum tiers in service)', async () => {
    const { service, aggregates } = createService({
      tableRows: [baseAggregate({ sampleSize: 40, rankTier: 'ALL' })],
      totalCount: 1,
    });

    await service.getTable({
      position: 'SUPPORT',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    expect(aggregates.findTableRows).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          tier: 'ALL',
          position: 'SUPPORT',
        }),
      }),
    );
  });

  it('returns non-empty table after cache generation advances past an empty generation', async () => {
    const tableQuery = {
      position: 'TOP',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery;

    const { service, cache, aggregates } = createService({
      tableRows: [],
      totalCount: 0,
      generation: 1,
    });
    aggregates.findTableRows
      .mockResolvedValueOnce({ rows: [], totalCount: 0 })
      .mockResolvedValueOnce({ rows: [], totalCount: 0 }); // unfiltered emptyReason probe

    const empty = await service.getTable(tableQuery);
    expect(empty.rows).toEqual([]);
    expect(empty.emptyReason).toBe('NO_MATCHING_AGGREGATES');
    expect(cache.tableKey).toHaveBeenCalledWith(expect.objectContaining({ generation: 1 }));

    // Seed gen-1 cache hit so stale empty would keep being served without generation advance.
    cache.getParsed.mockImplementation(async (key: string) => {
      if (key === 'table:1') {
        return empty;
      }
      return null;
    });

    aggregates.findTableRows.mockClear();
    const cachedEmpty = await service.getTable(tableQuery);
    expect(cachedEmpty.rows).toEqual([]);
    expect(aggregates.findTableRows).not.toHaveBeenCalled();

    cache.getGeneration.mockResolvedValue(2);
    aggregates.findTableRows.mockResolvedValue({
      rows: [baseAggregate({ sampleSize: 40, teamPosition: 'TOP' })],
      totalCount: 1,
    });

    const filled = await service.getTable(tableQuery);
    expect(filled.rows).toHaveLength(1);
    expect(cache.tableKey).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }));
    expect(aggregates.findTableRows).toHaveBeenCalled();
  });

  it('returns known champion with stats null and CHAMPION_HAS_NO_STATS', async () => {
    const { service } = createService({
      exact: null,
      breakdown: [],
    });

    const response = await service.getChampionStats('Ahri', {
      tier: 'ALL',
      position: 'MIDDLE',
    });

    expect(response.champion.championKey).toBe('Ahri');
    expect(response.stats).toBeNull();
    expect(response.emptyReason).toBe('CHAMPION_HAS_NO_STATS');
    expect(response.positionBreakdown).toHaveLength(5);
    expect(response.positionBreakdown.every((entry) => entry.metrics === null)).toBe(true);
  });

  it('returns detail exact stats for sampleSize 18 without includeInsufficient', async () => {
    const { service, aggregates } = createService({
      exact: baseAggregate({ sampleSize: 18, wins: 10, teamPosition: 'MIDDLE' }),
      breakdown: [baseAggregate({ sampleSize: 18, wins: 10, teamPosition: 'MIDDLE' })],
    });

    const response = await service.getChampionStats('Ahri', {
      tier: 'ALL',
      position: 'MIDDLE',
    });

    expect(response.stats).not.toBeNull();
    expect(response.stats?.metrics.sampleSize).toBe(18);
    expect(response.stats?.metrics.sampleConfidence).toBe('INSUFFICIENT');
    expect(response.emptyReason).toBeUndefined();
    // Envelope ranking/confidence floor remains configured minimum (not detail visibility).
    expect(response.effectiveMinimumSample).toBe(config.minimumSample);
    expect(aggregates.findExactAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ minimumSample: 1 }),
      }),
    );
  });

  it('returns detail exact stats for sampleSize 1 without includeInsufficient', async () => {
    const { service } = createService({
      exact: baseAggregate({
        sampleSize: 1,
        wins: 1,
        teamPosition: 'MIDDLE',
        goldDifferenceAt10Samples: 0,
        goldDifferenceAt15Samples: 0,
        csDifferenceAt10Samples: 0,
        csDifferenceAt15Samples: 0,
        totalGoldDifferenceAt10: null,
        totalGoldDifferenceAt15: null,
        totalCsDifferenceAt10: null,
        totalCsDifferenceAt15: null,
      }),
      breakdown: [],
    });

    const response = await service.getChampionStats('Ahri', {
      tier: 'ALL',
      position: 'MIDDLE',
    });

    expect(response.stats).not.toBeNull();
    expect(response.stats?.metrics.sampleSize).toBe(1);
    expect(response.stats?.metrics.sampleConfidence).toBe('INSUFFICIENT');
    expect(response.emptyReason).toBeUndefined();
  });

  it('does not present a zero-sample aggregate as valid detail statistics', async () => {
    const { service, aggregates } = createService({
      exact: baseAggregate({
        sampleSize: 0,
        wins: 0,
        teamPosition: 'MIDDLE',
        goldDifferenceAt10Samples: 0,
        goldDifferenceAt15Samples: 0,
        csDifferenceAt10Samples: 0,
        csDifferenceAt15Samples: 0,
        totalGoldDifferenceAt10: null,
        totalGoldDifferenceAt15: null,
        totalCsDifferenceAt10: null,
        totalCsDifferenceAt15: null,
      }),
      breakdown: [],
    });

    const response = await service.getChampionStats('Ahri', {
      tier: 'ALL',
      position: 'MIDDLE',
    });

    expect(response.stats).toBeNull();
    expect(response.emptyReason).toBe('CHAMPION_HAS_NO_STATS');
    expect(aggregates.findExactAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ minimumSample: 1 }),
      }),
    );
  });

  it('includes sub-30 position breakdown roles without includeInsufficient', async () => {
    const { service, aggregates } = createService({
      exact: null,
      breakdown: [
        baseAggregate({
          sampleSize: 8,
          wins: 3,
          teamPosition: 'SUPPORT',
          goldDifferenceAt10Samples: 8,
          goldDifferenceAt15Samples: 8,
          csDifferenceAt10Samples: 8,
          csDifferenceAt15Samples: 8,
        }),
      ],
    });

    const response = await service.getChampionStats('Ahri', { tier: 'ALL' });

    expect(aggregates.findPositionBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ minimumSample: 1 }),
      }),
    );

    const support = response.positionBreakdown.find((entry) => entry.position === 'SUPPORT');
    const top = response.positionBreakdown.find((entry) => entry.position === 'TOP');
    expect(support?.metrics).not.toBeNull();
    expect(support?.metrics?.sampleSize).toBe(8);
    expect(support?.metrics?.sampleConfidence).toBe('INSUFFICIENT');
    expect(top?.metrics).toBeNull();
    expect(top?.dimensions).toBeNull();
  });

  it('returns five-role breakdown with nulls for missing roles when position omitted', async () => {
    const { service } = createService({
      breakdown: [baseAggregate({ teamPosition: 'MIDDLE' })],
    });

    const response = await service.getChampionStats('Ahri', { tier: 'ALL' });

    expect(response.stats).toBeNull();
    expect(response.positionBreakdown.map((entry) => entry.position)).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'SUPPORT',
    ]);
    const middle = response.positionBreakdown.find((entry) => entry.position === 'MIDDLE');
    const top = response.positionBreakdown.find((entry) => entry.position === 'TOP');
    expect(middle?.metrics?.sampleSize).toBe(40);
    expect(top?.metrics).toBeNull();
    expect(top?.dimensions).toBeNull();
  });

  it('propagates unknown champion as CHAMPION_NOT_FOUND', async () => {
    const { service } = createService({ findByKey: null });
    await expect(service.getChampionStats('Nope', { tier: 'ALL' })).rejects.toBeInstanceOf(
      ChampionNotFoundError,
    );
  });

  it('falls back to PostgreSQL when Redis cache miss / failure returns null', async () => {
    const { service, aggregates, cache } = createService({ cacheGet: null });
    cache.getParsed.mockResolvedValue(null);
    cache.getGeneration.mockResolvedValue(0);

    await service.getTable({
      position: 'MIDDLE',
      platform: 'euw1',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    expect(aggregates.findTableRows).toHaveBeenCalled();
    expect(cache.setIfGenerationCurrent).toHaveBeenCalled();
  });

  it('isolates cache keys across platforms', async () => {
    const { service, cache } = createService();

    await service.getTable({
      position: 'MIDDLE',
      platform: 'na1',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);
    await service.getTable({
      position: 'MIDDLE',
      platform: 'euw1',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    const scopes = cache.tableKey.mock.calls.map(
      (call) => (call[0] as { scope: { platform: string } }).scope.platform,
    );
    expect(scopes).toContain('na1');
    expect(scopes).toContain('euw1');
  });

  it('does not leak empty-string platform or -1 queue in table DTOs', async () => {
    const { service } = createService();
    const response = await service.getTable({
      position: 'MIDDLE',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('"platform":""');
    expect(serialized).not.toContain('"queueId":-1');
    expect(response.resolvedFilters.platform).toBe('na1');
    expect(response.resolvedFilters.queueId).toBe(420);
  });

  it('reads freshness from repository markers (not timestamp heuristic)', async () => {
    const { service, aggregates } = createService({ freshness: 'RECALCULATION_PENDING' });
    const response = await service.getTable({
      position: 'MIDDLE',
      tier: 'ALL',
      sortBy: 'winRate',
      sortDirection: 'desc',
      limit: 50,
    } as ChampionStatsTableQuery);

    expect(response.freshness).toBe('RECALCULATION_PENDING');
    expect(aggregates.resolveFreshness).toHaveBeenCalled();
  });

  it('returns filters metadata with Task 4 schema fields', async () => {
    const { service } = createService({ latestPatch: '16.10' });
    const filters = await service.getFilters();

    expect(filters.defaultPlatform).toBe('na1');
    expect(filters.defaultQueueId).toBe(420);
    expect(filters.defaultPatch).toBe('16.10');
    expect(filters.availablePositions).toContain('MIDDLE');
    expect(filters.disclaimer).toContain('collected by League Helper');
    expect(filters.sourceNormalizationVersion).toBe('1');
  });
});
