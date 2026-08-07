import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChampionAggregationProcessingStatus,
  PrismaClient,
  StaticDataStatus,
} from '@prisma/client';
import {
  ChampionNotFoundError,
  ChampionStatsPositionRequiredError,
  ChampionStatsTableQuerySchema,
} from '@league-helper/shared';
import { loadChampionStatsConfig } from '../../config/champion-stats.config';
import { ChampionAggregateReadRepository } from '../../persistence/champion-aggregate-read.repository';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { assertTablePositionPresent } from './champion-stats-filters';
import { ChampionStatsCacheService } from './champion-stats-cache.service';
import { ChampionStatsService } from './champion-stats.service';
import { ChampionStaticService } from './champion-static.service';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const staticRepo = new ChampionStaticRepository(prisma as never);
const aggregateRepo = new ChampionAggregateReadRepository(prisma as never);

const media = {
  buildChampionIconUrl: (key: string, version: string) =>
    `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`,
  buildChampionSplashUrl: (key: string) =>
    `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_0.jpg`,
};

const redis = {
  get: async () => null,
  set: async () => 'OK',
};

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AnalysisFinding",
      "PlayerAnalysisReport",
      "PlayerMetricSnapshot",
      "MatchupAggregate",
      "ChampionAggregationRecalcScope",
      "ChampionAggregate",
      "ChampionAggregationProcessing",
      "IngestionJobRecord",
      "ChampionMasterySnapshot",
      "MatchTimeline",
      "MatchParticipant",
      "MatchTeam",
      "Match",
      "RankSnapshot",
      "PlayerAccountAlias",
      "CollectorRun",
      "TrackedPlayer",
      "PlayerAccount",
      "Player",
      "ChampionStaticData",
      "ItemStaticData",
      "RuneStaticData",
      "Patch"
    RESTART IDENTITY CASCADE;
  `);
}

function createServices() {
  const config = loadChampionStatsConfig({
    CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
    CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION: '1',
    CHAMPION_AGGREGATION_VERSION: '1',
    CHAMPION_AGGREGATION_MIN_SAMPLE: '30',
    CHAMPION_AGGREGATION_CONFIDENCE_LEVEL: '0.95',
    CHAMPION_AGGREGATION_DEFAULT_QUEUE_ID: '420',
    CHAMPION_STATS_CACHE_TTL_SECONDS: '60',
  });

  const staticService = new ChampionStaticService(staticRepo, media as never);
  const cache = new ChampionStatsCacheService(redis as never, config);
  const statsService = new ChampionStatsService(
    config,
    aggregateRepo,
    staticRepo,
    staticService,
    media as never,
    cache,
  );
  return { staticService, statsService };
}

describe('champions API integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetTestData();

    const patch = await prisma.patch.create({
      data: {
        version: '16.10.1',
        normalizedMajorMinor: '16.10',
        isActive: true,
        staticDataStatus: StaticDataStatus.READY,
        dataDragonVersion: '16.10.1',
      },
    });

    await prisma.championStaticData.createMany({
      data: [
        {
          patchId: patch.id,
          championId: 103,
          championKey: 'Ahri',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage'],
          baseStats: {},
          passive: {},
          spells: [],
          imageData: {},
        },
        {
          patchId: patch.id,
          championId: 1,
          championKey: 'Annie',
          name: 'Annie',
          title: 'the Dark Child',
          tags: ['Mage'],
          baseStats: {},
          passive: {},
          spells: [],
          imageData: {},
        },
        // League Classic variant — synced for history, hidden from public APIs
        {
          patchId: patch.id,
          championId: 60103,
          championKey: 'Jade_Ahri',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage', 'Assassin'],
          baseStats: {},
          passive: {},
          spells: [],
          imageData: {},
        },
      ],
    });

    await prisma.championAggregate.create({
      data: {
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
        totalDeaths: 40,
        totalAssists: 80,
        totalCs: 800,
        totalGameSeconds: 12_000,
        totalDamageToChampions: 90_000,
        totalVisionScore: 400,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date('2026-01-02T00:00:00.000Z'),
        latestEligibleMatchAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    // Older semantic patch — default resolution must prefer 16.10
    await prisma.championAggregate.create({
      data: {
        patch: '16.9',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'ALL',
        teamPosition: 'MIDDLE',
        championId: 103,
        sampleSize: 40,
        wins: 10,
        totalKills: 50,
        totalDeaths: 40,
        totalAssists: 40,
        totalCs: 400,
        totalGameSeconds: 6000,
        totalDamageToChampions: 40_000,
        totalVisionScore: 200,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const match = await prisma.match.create({
      data: {
        provider: 'RIOT',
        externalMatchId: 'TEST_NA1_CHAMP_1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        gameId: BigInt(9001),
        queueId: 420,
        mapId: 11,
        gameMode: 'CLASSIC',
        gameType: 'MATCHED_GAME',
        gameCreation: new Date('2026-01-01T00:00:00.000Z'),
        gameDurationSeconds: 1800,
        gameVersion: '16.10.1',
        normalizedPatch: '16.10',
        remake: false,
        earlySurrender: false,
        ingestionStatus: 'COMPLETED',
        normalizationVersion: '1',
      },
    });

    await prisma.championAggregationProcessing.create({
      data: {
        matchId: match.id,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        status: ChampionAggregationProcessingStatus.COMPLETED,
        processedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });
  });

  it('lists static champions and resolves case-insensitive detail', async () => {
    const { staticService } = createServices();
    const list = await staticService.list();
    expect(list.champions.length).toBeGreaterThanOrEqual(2);
    expect(list.champions.map((c) => c.championKey).sort()).toEqual(['Ahri', 'Annie']);
    expect(list.champions.some((c) => c.championKey === 'Jade_Ahri')).toBe(false);

    const detail = await staticService.getByKey('ahri');
    expect(detail.champion.championKey).toBe('Ahri');
    expect(detail.champion.canonicalChampionKey).toBe('Ahri');
  });

  it('hides League Classic champion detail routes', async () => {
    const { staticService } = createServices();
    await expect(staticService.getByKey('Jade_Ahri')).rejects.toBeInstanceOf(ChampionNotFoundError);

    const hiddenRow = await prisma.championStaticData.findFirst({
      where: { championKey: 'Jade_Ahri' },
    });
    expect(hiddenRow).not.toBeNull();
  });

  it('rejects numeric champion keys', async () => {
    const { staticService } = createServices();
    await expect(staticService.getByKey('103')).rejects.toBeInstanceOf(ChampionNotFoundError);
  });

  it('requires position for ranking and defaults semantic patch 16.10', async () => {
    expect(() => assertTablePositionPresent({})).toThrow(ChampionStatsPositionRequiredError);

    const { statsService } = createServices();
    const query = ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE' });
    const table = await statsService.getTable(query);

    expect(table.resolvedFilters.patch).toBe('16.10');
    expect(table.usedDefaultPatch).toBe(true);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.champion.championKey).toBe('Ahri');
    expect(table.freshness).toBe('CURRENT');
    expect(table.effectiveMinimumSample).toBe(30);
  });

  it('returns CHAMPION_HAS_NO_STATS for known champion without matching aggregate', async () => {
    const { statsService } = createServices();
    const response = await statsService.getChampionStats('Annie', {
      tier: 'ALL',
      position: 'MIDDLE',
    });

    expect(response.stats).toBeNull();
    expect(response.emptyReason).toBe('CHAMPION_HAS_NO_STATS');
    expect(response.positionBreakdown).toHaveLength(5);
  });

  it('returns detail stats for sampleSize 18 with INSUFFICIENT confidence (no includeInsufficient)', async () => {
    await prisma.championAggregate.create({
      data: {
        patch: '16.10',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'ALL',
        teamPosition: 'MIDDLE',
        championId: 1, // Annie
        sampleSize: 18,
        wins: 10,
        totalKills: 40,
        totalDeaths: 20,
        totalAssists: 30,
        totalCs: 300,
        totalGameSeconds: 4_000,
        totalDamageToChampions: 30_000,
        totalVisionScore: 100,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date('2026-01-02T00:00:00.000Z'),
        latestEligibleMatchAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await prisma.championAggregate.create({
      data: {
        patch: '16.10',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'ALL',
        teamPosition: 'SUPPORT',
        championId: 1,
        sampleSize: 8,
        wins: 3,
        totalKills: 10,
        totalDeaths: 15,
        totalAssists: 40,
        totalCs: 50,
        totalGameSeconds: 2_000,
        totalDamageToChampions: 8_000,
        totalVisionScore: 200,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date('2026-01-02T00:00:00.000Z'),
        latestEligibleMatchAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const { statsService } = createServices();
    const response = await statsService.getChampionStats('Annie', {
      tier: 'ALL',
      position: 'MIDDLE',
    });

    expect(response.stats).not.toBeNull();
    expect(response.stats?.metrics.sampleSize).toBe(18);
    expect(response.stats?.metrics.sampleConfidence).toBe('INSUFFICIENT');
    expect(response.emptyReason).toBeUndefined();
    expect(response.effectiveMinimumSample).toBe(30);

    const support = response.positionBreakdown.find((entry) => entry.position === 'SUPPORT');
    expect(support?.metrics?.sampleSize).toBe(8);
    expect(support?.metrics?.sampleConfidence).toBe('INSUFFICIENT');

    // Ranking floor unchanged: sampleSize 18 is not table-eligible.
    const table = await statsService.getTable(
      ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE' }),
    );
    expect(table.rows.every((row) => row.champion.championKey !== 'Annie')).toBe(true);
    expect(table.effectiveMinimumSample).toBe(30);
  });

  it('excludes ranking rows at sampleSize 29 and includes sampleSize 30', async () => {
    await prisma.championAggregate.create({
      data: {
        patch: '16.10',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'ALL',
        teamPosition: 'TOP',
        championId: 1,
        sampleSize: 29,
        wins: 15,
        totalKills: 50,
        totalDeaths: 40,
        totalAssists: 40,
        totalCs: 500,
        totalGameSeconds: 8_000,
        totalDamageToChampions: 40_000,
        totalVisionScore: 200,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });

    const { statsService } = createServices();
    const excluded = await statsService.getTable(
      ChampionStatsTableQuerySchema.parse({ position: 'TOP' }),
    );
    expect(excluded.rows).toEqual([]);
    expect(excluded.emptyReason).toBe('BELOW_MINIMUM_SAMPLE');

    await prisma.championAggregate.updateMany({
      where: {
        championId: 1,
        teamPosition: 'TOP',
        patch: '16.10',
        sampleSize: 29,
      },
      data: { sampleSize: 30, wins: 16 },
    });

    const included = await statsService.getTable(
      ChampionStatsTableQuerySchema.parse({ position: 'TOP' }),
    );
    expect(included.rows).toHaveLength(1);
    expect(included.rows[0]?.metrics.sampleSize).toBe(30);
    expect(included.emptyReason).toBeUndefined();
  });

  it('marks freshness RECALCULATION_PENDING when recalc scope rows exist', async () => {
    const match = await prisma.match.findFirstOrThrow();
    await prisma.championAggregationRecalcScope.create({
      data: {
        matchId: match.id,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        previousDimensionKeys: [],
      },
    });

    const { statsService } = createServices();
    const table = await statsService.getTable(
      ChampionStatsTableQuerySchema.parse({ position: 'MIDDLE' }),
    );
    expect(table.freshness).toBe('RECALCULATION_PENDING');
  });
});
