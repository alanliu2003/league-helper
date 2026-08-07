import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChampionAggregationProcessingStatus,
  MatchIngestionStatus,
  PrismaClient,
} from '@prisma/client';
import { DEFAULT_CHAMPION_ROLLUP_POLICY } from '@league-helper/match-analytics';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { collectStdoutJson, reportCliFailure } from './cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_INTEGRITY_FAILURE, EXIT_SUCCESS } from './exit-codes.js';
import {
  collectFindingsForAggregateRow,
  runAuditChampions,
  type AggregateIntegrityRow,
} from './audit-champions-core.js';
import { runAuditRankCoverage } from './audit-rank-core.js';
import { withJsonStdoutGuard } from './json-stdout-guard.js';
import { runRebuildChampionAggregates } from './rebuild-core.js';
import { runReconcileChampionAggregates } from './reconcile-core.js';
import { runStatusChampionAggregates } from './status-core.js';

const testDatabaseUrl =
  process.env.WORKER_TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_worker_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

function config(
  overrides: Partial<ChampionAggregationWorkerConfig> = {},
): ChampionAggregationWorkerConfig {
  return {
    queueName: 'champion-aggregation-test',
    concurrency: 1,
    jobAttempts: 3,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    confidenceLevel: 0.95,
    ...overrides,
  };
}

function mockRedis() {
  return { incr: vi.fn().mockResolvedValue(1), quit: vi.fn() };
}

function mockQueue(overrides: {
  getJob?: ReturnType<typeof vi.fn>;
  add?: ReturnType<typeof vi.fn>;
  getJobCounts?: ReturnType<typeof vi.fn>;
  getWorkers?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getJob: overrides.getJob ?? vi.fn().mockResolvedValue(null),
    add: overrides.add ?? vi.fn().mockResolvedValue({ id: 'job' }),
    getJobCounts:
      overrides.getJobCounts ??
      vi.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        delayed: 0,
        completed: 0,
        failed: 5,
      }),
    getWorkers: overrides.getWorkers ?? vi.fn().mockResolvedValue([{ id: 'w1' }]),
    close: vi.fn(),
  };
}

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AnalysisFinding",
      "PlayerAnalysisReport",
      "PlayerMetricSnapshot",
      "MatchupAggregate",
      "ChampionAggregate",
      "ChampionAggregationProcessing",
      "ChampionAggregationRecalcScope",
      "IngestionJobRecord",
      "ChampionMasterySnapshot",
      "MatchTimeline",
      "MatchParticipant",
      "MatchTeam",
      "Match",
      "RankSnapshot",
      "PlayerAccountAlias",
      "PlayerAccount",
      "Player",
      "ChampionStaticData",
      "ItemStaticData",
      "RuneStaticData",
      "Patch"
    RESTART IDENTITY CASCADE;
  `);
}

async function seedEligibleMatch(input: {
  id: string;
  externalMatchId: string;
  queueId?: number;
  patch?: string;
  platformRoute?: string;
  championId?: number;
  rankTierAtIngestion?: string | null;
  playerAccountId?: string | null;
}): Promise<void> {
  await prisma.match.create({
    data: {
      id: input.id,
      provider: 'RIOT',
      externalMatchId: input.externalMatchId,
      regionalRoute: 'americas',
      platformRoute: input.platformRoute ?? 'na1',
      gameCreation: new Date('2024-06-01T00:00:00.000Z'),
      gameEndTimestamp: new Date('2024-06-01T00:30:00.000Z'),
      gameDurationSeconds: 1800,
      gameVersion: '14.1.1',
      normalizedPatch: input.patch ?? '14.1',
      queueId: input.queueId ?? 420,
      mapId: 11,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      remake: false,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
      ingestedAt: new Date(),
      participants: {
        create: [
          {
            participantId: 1,
            playerAccountId: input.playerAccountId ?? null,
            championId: input.championId ?? 103,
            teamId: 100,
            teamPosition: 'MIDDLE',
            individualPosition: 'MIDDLE',
            lane: 'MIDDLE',
            role: 'SOLO',
            rankTierAtIngestion:
              input.rankTierAtIngestion === undefined ? 'GOLD' : input.rankTierAtIngestion,
            win: true,
            kills: 5,
            deaths: 2,
            assists: 7,
            totalCs: 200,
            timePlayedSeconds: 1800,
            totalDamageDealtToChampions: 20_000,
            visionScore: 30,
            goldDifferenceAt10: 100,
            goldDifferenceAt15: null,
            csDifferenceAt10: null,
            csDifferenceAt15: null,
          },
        ],
      },
      teams: {
        create: [
          { teamId: 100, win: true },
          { teamId: 200, win: false },
        ],
      },
    },
  });
}

describe('champion aggregate CLIs', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  it('rebuild dry-run writes nothing and does not increment cache generation', async () => {
    await seedEligibleMatch({
      id: '11111111-1111-4111-8111-111111111111',
      externalMatchId: 'NA1_dry1',
    });
    const redis = mockRedis();

    const result = await runRebuildChampionAggregates({
      prisma,
      redis: redis as never,
      config: config(),
      dryRun: true,
      confirmed: false,
      batchSize: 50,
      filters: {},
      rollupPolicy: DEFAULT_CHAMPION_ROLLUP_POLICY,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: false,
    });

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.report.dryRun).toBe(true);
    expect(result.report.eligibleMatches).toBe(1);
    expect(result.report.expectedUpserts).toBeGreaterThan(0);
    expect(await prisma.championAggregate.count()).toBe(0);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('rebuild apply requires confirmation', async () => {
    await seedEligibleMatch({
      id: '22222222-2222-4222-8222-222222222222',
      externalMatchId: 'NA1_confirm1',
    });
    const result = await runRebuildChampionAggregates({
      prisma,
      redis: mockRedis() as never,
      config: config(),
      dryRun: false,
      confirmed: false,
      batchSize: 50,
      filters: {},
      rollupPolicy: DEFAULT_CHAMPION_ROLLUP_POLICY,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: false,
    });
    expect(result.exitCode).toBe(EXIT_COMMAND_FAILURE);
    expect(result.report.error).toMatch(/confirm/i);
    expect(await prisma.championAggregate.count()).toBe(0);
  });

  it('rebuild is idempotent', async () => {
    await seedEligibleMatch({
      id: '33333333-3333-4333-8333-333333333333',
      externalMatchId: 'NA1_idem1',
    });
    const input = {
      prisma,
      redis: mockRedis() as never,
      config: config(),
      dryRun: false,
      confirmed: true,
      batchSize: 10,
      filters: {},
      rollupPolicy: DEFAULT_CHAMPION_ROLLUP_POLICY,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: false,
    };
    const first = await runRebuildChampionAggregates(input);
    const countAfterFirst = await prisma.championAggregate.count();
    const second = await runRebuildChampionAggregates(input);
    const countAfterSecond = await prisma.championAggregate.count();

    expect(first.exitCode).toBe(EXIT_SUCCESS);
    expect(second.exitCode).toBe(EXIT_SUCCESS);
    expect(countAfterFirst).toBeGreaterThan(0);
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('match-complete rebuild writes markers and clears pending recalc scopes', async () => {
    const matchId = 'acacacac-acac-4aca-8aca-acacacacacac';
    await seedEligibleMatch({
      id: matchId,
      externalMatchId: 'NA1_match_complete_rebuild',
      championId: 103,
    });
    await prisma.championAggregationRecalcScope.create({
      data: {
        matchId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        previousDimensionKeys: [],
      },
    });

    const result = await runRebuildChampionAggregates({
      prisma,
      redis: mockRedis() as never,
      config: config(),
      dryRun: false,
      confirmed: true,
      batchSize: 50,
      filters: { patch: '14.1', queueId: 420, platformRoute: 'na1' },
      rollupPolicy: DEFAULT_CHAMPION_ROLLUP_POLICY,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: false,
    });

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.report.markersUpdated).toBe(1);
    const marker = await prisma.championAggregationProcessing.findUnique({
      where: {
        matchId_sourceNormalizationVersion_aggregationVersion: {
          matchId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      },
    });
    expect(marker?.status).toBe(ChampionAggregationProcessingStatus.COMPLETED);
    expect(
      await prisma.championAggregationRecalcScope.count({
        where: {
          matchId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      }),
    ).toBe(0);
  });

  it('champion-filtered rebuild apply does not write COMPLETED markers or clear scopes', async () => {
    const matchId = 'abababab-abab-4aba-8aba-abababababab';
    await seedEligibleMatch({
      id: matchId,
      externalMatchId: 'NA1_champ_filter_marker',
      championId: 103,
    });
    await prisma.championAggregationRecalcScope.create({
      data: {
        matchId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        previousDimensionKeys: [],
      },
    });

    const before = await prisma.championAggregationProcessing.findUnique({
      where: {
        matchId_sourceNormalizationVersion_aggregationVersion: {
          matchId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      },
    });
    expect(before).toBeNull();

    const result = await runRebuildChampionAggregates({
      prisma,
      redis: mockRedis() as never,
      config: config(),
      dryRun: false,
      confirmed: true,
      batchSize: 50,
      filters: { championId: 103 },
      rollupPolicy: DEFAULT_CHAMPION_ROLLUP_POLICY,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: false,
    });

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.report.markersUpdated).toBe(0);
    expect(result.report.scopesCleared).toBe(0);
    expect(result.report.markersSkippedReason).toMatch(/champion filter/i);
    expect(await prisma.championAggregate.count()).toBeGreaterThan(0);
    const after = await prisma.championAggregationProcessing.findUnique({
      where: {
        matchId_sourceNormalizationVersion_aggregationVersion: {
          matchId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      },
    });
    expect(after).toBeNull();
    expect(
      await prisma.championAggregationRecalcScope.count({
        where: {
          matchId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      }),
    ).toBe(1);
  });

  it('rebuild deletion remains inside requested scope and preserves older aggregation versions', async () => {
    await seedEligibleMatch({
      id: '44444444-4444-4444-8444-444444444444',
      externalMatchId: 'NA1_scope1',
      patch: '14.1',
      championId: 103,
    });
    await prisma.championAggregate.createMany({
      data: [
        {
          patch: '14.1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
          rankTier: 'GOLD',
          teamPosition: 'MIDDLE',
          championId: 999,
          sampleSize: 1,
          wins: 1,
          calculatedAt: new Date(),
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
        {
          patch: '14.1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
          rankTier: 'GOLD',
          teamPosition: 'MIDDLE',
          championId: 103,
          sampleSize: 1,
          wins: 1,
          calculatedAt: new Date(),
          sourceNormalizationVersion: '1',
          aggregationVersion: 'legacy',
        },
      ],
    });

    const result = await runRebuildChampionAggregates({
      prisma,
      redis: mockRedis() as never,
      config: config(),
      dryRun: false,
      confirmed: true,
      batchSize: 50,
      filters: { patch: '14.1', championId: 103 },
      rollupPolicy: DEFAULT_CHAMPION_ROLLUP_POLICY,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: false,
    });

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    // Orphan champion 999 was outside champion filter — must remain
    expect(
      await prisma.championAggregate.count({
        where: { championId: 999, aggregationVersion: '1' },
      }),
    ).toBe(1);
    // Older aggregation version preserved
    expect(
      await prisma.championAggregate.count({
        where: { aggregationVersion: 'legacy' },
      }),
    ).toBe(1);
  });

  it('non-default rollup flags cannot silently write under current incremental version', async () => {
    const result = await runRebuildChampionAggregates({
      prisma,
      redis: mockRedis() as never,
      config: config(),
      dryRun: false,
      confirmed: true,
      batchSize: 50,
      filters: {},
      rollupPolicy: {
        ...DEFAULT_CHAMPION_ROLLUP_POLICY,
        includeAllTierAndPosition: true,
      },
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      currentIncrementalAggregationVersion: '1',
      nonDefaultRollupRequested: true,
    });
    expect(result.exitCode).toBe(EXIT_COMMAND_FAILURE);
    expect(result.report.error).toMatch(/dry-run|aggregation-version/i);
  });

  it('reconcile finds missing markers, failed markers, pending scopes, and deduplicates', async () => {
    const missingId = '55555555-5555-4555-8555-555555555555';
    const failedId = '66666666-6666-4666-8666-666666666666';
    const pendingId = '77777777-7777-4777-8777-777777777777';
    const currentId = '88888888-8888-4888-8888-888888888888';

    await seedEligibleMatch({ id: missingId, externalMatchId: 'NA1_m1' });
    await seedEligibleMatch({ id: failedId, externalMatchId: 'NA1_f1' });
    await seedEligibleMatch({ id: pendingId, externalMatchId: 'NA1_p1' });
    await seedEligibleMatch({ id: currentId, externalMatchId: 'NA1_c1' });

    await prisma.championAggregationProcessing.create({
      data: {
        matchId: failedId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        status: ChampionAggregationProcessingStatus.FAILED,
        processedAt: new Date(),
        lastErrorCode: 'TEST',
      },
    });
    await prisma.championAggregationProcessing.create({
      data: {
        matchId: currentId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        status: ChampionAggregationProcessingStatus.COMPLETED,
        processedAt: new Date(),
      },
    });
    await prisma.championAggregationRecalcScope.create({
      data: {
        matchId: pendingId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        previousDimensionKeys: [],
      },
    });

    const liveJob = {
      getState: vi.fn().mockResolvedValue('waiting'),
      remove: vi.fn(),
    };
    const add = vi.fn().mockResolvedValue({ id: 'job' });

    // First reconcile dry-run
    const dry = await runReconcileChampionAggregates({
      prisma,
      queue: mockQueue() as never,
      config: config(),
      dryRun: true,
      filters: {},
    });
    expect(dry.report.missingMarker).toBe(1);
    expect(dry.report.failedMarker).toBe(1);
    expect(dry.report.pendingRecalculationScope).toBe(1);
    expect(dry.report.current).toBe(1);
    expect(dry.report.jobsEnqueued).toBe(3);

    // Apply with one live job for pending scope → dedupe
    const getJobSmart = vi.fn(async (jobId: string) => {
      return String(jobId).includes(pendingId) ? liveJob : null;
    });
    const applied = await runReconcileChampionAggregates({
      prisma,
      queue: mockQueue({ getJob: getJobSmart, add }) as never,
      config: config(),
      dryRun: false,
      filters: {},
    });
    expect(applied.report.jobsDeduplicated).toBe(1);
    expect(applied.report.jobsEnqueued).toBe(2);
    expect(add).toHaveBeenCalledTimes(2);

    // Rerun → current/no-op for previously missing once markers exist? After enqueue only scopes exist.
    // Mark missing+failed as completed to simulate worker drain, clear scopes.
    await prisma.championAggregationProcessing.upsert({
      where: {
        matchId_sourceNormalizationVersion_aggregationVersion: {
          matchId: missingId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      },
      create: {
        matchId: missingId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        status: ChampionAggregationProcessingStatus.COMPLETED,
        processedAt: new Date(),
      },
      update: { status: ChampionAggregationProcessingStatus.COMPLETED },
    });
    await prisma.championAggregationProcessing.update({
      where: {
        matchId_sourceNormalizationVersion_aggregationVersion: {
          matchId: failedId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      },
      data: { status: ChampionAggregationProcessingStatus.COMPLETED },
    });
    await prisma.championAggregationProcessing.upsert({
      where: {
        matchId_sourceNormalizationVersion_aggregationVersion: {
          matchId: pendingId,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      },
      create: {
        matchId: pendingId,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        status: ChampionAggregationProcessingStatus.COMPLETED,
        processedAt: new Date(),
      },
      update: { status: ChampionAggregationProcessingStatus.COMPLETED },
    });
    await prisma.championAggregationRecalcScope.deleteMany();

    const rerun = await runReconcileChampionAggregates({
      prisma,
      queue: mockQueue() as never,
      config: config(),
      dryRun: true,
      filters: {},
    });
    expect(rerun.report.current).toBe(4);
    expect(rerun.report.missingMarker).toBe(0);
    expect(rerun.report.failedMarker).toBe(0);
    expect(rerun.report.pendingRecalculationScope).toBe(0);
    expect(rerun.report.jobsEnqueued).toBe(0);
  });

  it('status output shape and does not fail because failed jobs exist', async () => {
    await seedEligibleMatch({
      id: '99999999-9999-4999-8999-999999999999',
      externalMatchId: 'NA1_status1',
    });
    await prisma.championAggregate.create({
      data: {
        patch: '14.1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'ALL',
        teamPosition: 'MIDDLE',
        championId: 103,
        sampleSize: 5,
        wins: 3,
        calculatedAt: new Date(),
        latestEligibleMatchAt: new Date('2024-06-01T00:30:00.000Z'),
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
      },
    });

    const result = await runStatusChampionAggregates({
      prisma,
      queue: mockQueue() as never,
      config: config(),
      minSample: 30,
    });

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.report.ok).toBe(true);
    expect(result.report.queue.failed).toBe(5);
    expect(result.report).toMatchObject({
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      eligibleMatches: 1,
      aggregateRowCountCurrentVersions: 1,
      rowsBelowMinimumSample: 1,
      workerCount: 1,
    });
    expect(Array.isArray(result.report.rowsByPatch)).toBe(true);
  });

  it('rank audit denominator excludes non-ranked queues and reports them separately', async () => {
    await seedEligibleMatch({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      externalMatchId: 'NA1_r1',
      queueId: 420,
      rankTierAtIngestion: 'GOLD',
    });
    await seedEligibleMatch({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      externalMatchId: 'NA1_aram1',
      queueId: 450,
      rankTierAtIngestion: null,
    });

    const result = await runAuditRankCoverage({
      prisma,
      config: config(),
    });

    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.report.primaryDenominatorQueues).toEqual([420, 440]);
    expect(result.report.ranked.totalEligibleParticipants).toBe(1);
    expect(result.report.ranked.knownRankTier).toBe(1);
    expect(result.report.ranked.coveragePercent).toBe(100);
    expect(result.report.nonRanked.totalEligibleParticipants).toBe(1);
    expect(result.report.nonRanked.unknownRankTier).toBe(1);
  });

  it('integrity audit detects invalid counters (unit) and forbidden ALL rows; permits zero timeline total', async () => {
    const baseRow: AggregateIntegrityRow = {
      id: 'row-1',
      patch: '14.1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      rankTier: 'GOLD',
      teamPosition: 'MIDDLE',
      championId: 1,
      sampleSize: 2,
      wins: 5,
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
      totalCs: 0,
      totalGameSeconds: 0,
      totalDamageToChampions: 0,
      totalVisionScore: 0,
      totalGoldDifferenceAt10: null,
      goldDifferenceAt10Samples: 0,
      totalGoldDifferenceAt15: null,
      goldDifferenceAt15Samples: 0,
      totalCsDifferenceAt10: null,
      csDifferenceAt10Samples: 0,
      totalCsDifferenceAt15: null,
      csDifferenceAt15Samples: 0,
      latestEligibleMatchAt: null,
      calculatedAt: new Date(),
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    };
    const unit = collectFindingsForAggregateRow(baseRow, {
      confidenceLevel: 0.95,
      seenKeys: new Set(),
    });
    expect(unit.findings.some((f) => f.code === 'WINS_EXCEED_SAMPLE')).toBe(true);

    // DB check prevents wins>sampleSize inserts; use forbidden ALL + zero timeline total in DB.
    await prisma.championAggregate.createMany({
      data: [
        {
          patch: '14.1',
          platformRoute: '',
          regionalRoute: 'americas',
          queueId: 420,
          rankTier: 'GOLD',
          teamPosition: 'MIDDLE',
          championId: 2,
          sampleSize: 1,
          wins: 1,
          calculatedAt: new Date(),
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
        {
          patch: '14.1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
          rankTier: 'GOLD',
          teamPosition: 'MIDDLE',
          championId: 3,
          sampleSize: 4,
          wins: 2,
          totalGoldDifferenceAt10: 0,
          goldDifferenceAt10Samples: 2,
          calculatedAt: new Date(),
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
        },
      ],
    });

    const result = await runAuditChampions({
      prisma,
      config: config(),
    });

    expect(result.exitCode).toBe(EXIT_INTEGRITY_FAILURE);
    expect(result.report.findingCounts.FORBIDDEN_ALL_PLATFORM).toBe(1);
    expect(result.report.findingCounts.TIMELINE_TOTAL_SHOULD_BE_NULL).toBeUndefined();
    expect(result.report.findingCounts.TIMELINE_TOTAL_MISSING).toBeUndefined();
  });

  it('JSON mode payload is valid JSON only and contains no PUUID/secrets', () => {
    const payload = {
      ok: true,
      dryRun: true,
      eligibleMatches: 1,
      note: 'safe',
    };
    const text = collectStdoutJson(payload);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toMatch(/puuid/i);
    expect(text).not.toMatch(/DATABASE_URL/i);
    expect(text).not.toMatch(/REDIS_URL/i);
    expect(text).not.toMatch(/postgresql:\/\//i);
  });

  it('CLI cores do not call Riot or Data Dragon', async () => {
    const riotSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await runAuditRankCoverage({ prisma, config: config() });
    await runAuditChampions({ prisma, config: config() });
    expect(riotSpy).not.toHaveBeenCalled();
    riotSpy.mockRestore();
  });

  it('reserved ALL platform/regional/queue rollups are blocked on apply with no writes', async () => {
    const cases = [
      { includeAllPlatform: true },
      { includeAllRegionalRoute: true },
      { includeAllQueue: true },
    ] as const;

    for (const [index, rollup] of cases.entries()) {
      if (index > 0) {
        await resetTestData();
      }
      await seedEligibleMatch({
        id: 'cdcdcddc-cdcd-4cdc-8cdc-cdcdcddccdcd',
        externalMatchId: `NA1_reserved_${index}`,
      });

      const result = await runRebuildChampionAggregates({
        prisma,
        redis: mockRedis() as never,
        config: config(),
        dryRun: false,
        confirmed: true,
        batchSize: 50,
        filters: {},
        rollupPolicy: {
          ...DEFAULT_CHAMPION_ROLLUP_POLICY,
          ...rollup,
        },
        sourceNormalizationVersion: '1',
        aggregationVersion: 'alt',
        currentIncrementalAggregationVersion: '1',
        nonDefaultRollupRequested: true,
      });

      expect(result.exitCode).toBe(EXIT_COMMAND_FAILURE);
      expect(result.report.error).toMatch(/reserved|dry-run only/i);
      expect(await prisma.championAggregate.count()).toBe(0);
      expect(await prisma.championAggregationProcessing.count()).toBe(0);
    }
  });

  it('reconcile dry-run never calls queue.add', async () => {
    await seedEligibleMatch({
      id: 'dededede-dede-4ded-8ede-dededededede',
      externalMatchId: 'NA1_reconcile_dry',
    });
    const add = vi.fn();
    const result = await runReconcileChampionAggregates({
      prisma,
      queue: mockQueue({ add }) as never,
      config: config(),
      dryRun: true,
      filters: {},
    });
    expect(result.exitCode).toBe(EXIT_SUCCESS);
    expect(result.report.missingMarker).toBe(1);
    expect(result.report.jobsEnqueued).toBe(1);
    expect(add).not.toHaveBeenCalled();
  });

  it('reconcile apply with enqueue failures exits nonzero', async () => {
    await seedEligibleMatch({
      id: 'efefefef-efef-4efe-8efe-efefefefefef',
      externalMatchId: 'NA1_reconcile_fail',
    });
    const add = vi.fn().mockRejectedValue(new Error('enqueue failed'));
    const result = await runReconcileChampionAggregates({
      prisma,
      queue: mockQueue({ add }) as never,
      config: config(),
      dryRun: false,
      filters: {},
    });
    expect(result.exitCode).toBe(EXIT_COMMAND_FAILURE);
    expect(result.report.ok).toBe(false);
    expect(result.report.failures).toBeGreaterThan(0);
  });

  it('audit-champions exits 0 on clean/empty DB', async () => {
    const empty = await runAuditChampions({ prisma, config: config() });
    expect(empty.exitCode).toBe(EXIT_SUCCESS);
    expect(empty.report.passed).toBe(true);
    expect(empty.report.findings).toEqual([]);

    await prisma.championAggregate.create({
      data: {
        patch: '14.1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'GOLD',
        teamPosition: 'MIDDLE',
        championId: 103,
        sampleSize: 10,
        wins: 6,
        calculatedAt: new Date(),
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
      },
    });
    const clean = await runAuditChampions({ prisma, config: config() });
    expect(clean.exitCode).toBe(EXIT_SUCCESS);
    expect(clean.report.passed).toBe(true);
    expect(clean.report.rowsScanned).toBe(1);
  });

  it('reportCliFailure writes JSON stdout only when --json is set', () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderrChunks.push(args.map(String).join(' '));
    });

    reportCliFailure({ argv: [], message: 'boom-text' });
    expect(stdoutChunks.join('')).toBe('');
    expect(stderrChunks.join(' ')).toContain('boom-text');

    stdoutChunks.length = 0;
    stderrChunks.length = 0;
    reportCliFailure({ argv: ['--json'], message: 'boom-json' });
    expect(stdoutChunks.join('')).toContain('"ok":false');
    expect(stdoutChunks.join('')).toContain('boom-json');
    expect(() => JSON.parse(stdoutChunks.join('').trim())).not.toThrow();

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('withJsonStdoutGuard keeps console.log off stdout', async () => {
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await withJsonStdoutGuard(true, async () => {
      console.log(JSON.stringify({ level: 'info', message: 'pollution' }));
    });

    expect(stdoutChunks.join('')).toBe('');
    expect(errorSpy).toHaveBeenCalled();

    stdoutSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
