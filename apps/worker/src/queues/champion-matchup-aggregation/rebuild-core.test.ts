import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchIngestionStatus, PrismaClient } from '@prisma/client';
import { initialParticipantRankResolutionStatus } from '@league-helper/shared';
import { recalculateMatchupsForMatch, runRebuildChampionMatchups } from './rebuild-core.js';

const testDatabaseUrl =
  process.env.WORKER_TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_worker_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const MATCH_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REMAKE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function mockRedis() {
  return { incr: vi.fn().mockResolvedValue(1), quit: vi.fn() };
}

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

/** Subject (team 100) champion ids by lane; Ahri MIDDLE vs Syndra. */
const BLUE = [266, 64, 103, 222, 412] as const;
/** Opponent (team 200) champion ids; Syndra is PLATINUM, rest GOLD. */
const RED = [24, 11, 134, 18, 89] as const;

function participant(input: {
  participantId: number;
  championId: number;
  teamId: 100 | 200;
  teamPosition: (typeof POSITIONS)[number];
  win: boolean;
  rankTier: 'GOLD' | 'PLATINUM';
  goldDifferenceAt10?: number | null;
}): {
  participantId: number;
  championId: number;
  teamId: 100 | 200;
  teamPosition: (typeof POSITIONS)[number];
  individualPosition: (typeof POSITIONS)[number];
  lane: string;
  role: string;
  rankTierAtIngestion: string;
  rankResolutionStatus: ReturnType<typeof initialParticipantRankResolutionStatus>;
  externalAccountId: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalCs: number;
  timePlayedSeconds: number;
  totalDamageDealtToChampions: number;
  visionScore: number;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
} {
  return {
    participantId: input.participantId,
    championId: input.championId,
    teamId: input.teamId,
    teamPosition: input.teamPosition,
    individualPosition: input.teamPosition,
    lane: input.teamPosition === 'UTILITY' ? 'BOTTOM' : input.teamPosition,
    role: input.teamPosition === 'UTILITY' ? 'DUO_SUPPORT' : 'SOLO',
    rankTierAtIngestion: input.rankTier,
    rankResolutionStatus: initialParticipantRankResolutionStatus({
      queueId: 420,
      rankTierAtIngestion: input.rankTier,
      externalAccountId: `seed-puuid-${input.participantId}`,
    }),
    externalAccountId: `seed-puuid-${input.participantId}`,
    win: input.win,
    kills: 5,
    deaths: 2,
    assists: 7,
    totalCs: 200,
    timePlayedSeconds: 1800,
    totalDamageDealtToChampions: 20_000,
    visionScore: 30,
    goldDifferenceAt10: input.goldDifferenceAt10 ?? null,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
  };
}

function tenLaneParticipants(opts: { ahriWins: boolean }): ReturnType<typeof participant>[] {
  return [
    ...POSITIONS.map((position, index) =>
      participant({
        participantId: index + 1,
        championId: BLUE[index]!,
        teamId: 100,
        teamPosition: position,
        win: opts.ahriWins,
        rankTier: 'GOLD',
        goldDifferenceAt10: position === 'MIDDLE' ? 500 : 0,
      }),
    ),
    ...POSITIONS.map((position, index) =>
      participant({
        participantId: index + 6,
        championId: RED[index]!,
        teamId: 200,
        teamPosition: position,
        win: !opts.ahriWins,
        rankTier: position === 'MIDDLE' ? 'PLATINUM' : 'GOLD',
        goldDifferenceAt10: position === 'MIDDLE' ? -500 : 0,
      }),
    ),
  ];
}

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AnalysisFinding",
      "PlayerAnalysisReport",
      "ChampionAiInsight",
      "PlayerPlaystyleInsight",
      "PlayerMetricSnapshot",
      "MatchupAggregate",
      "ChampionBuildAggregate",
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
      "SummonerSpellStaticData",
      "Patch"
    RESTART IDENTITY CASCADE;
  `);
}

async function seedEligibleMatch(): Promise<void> {
  await prisma.match.create({
    data: {
      id: MATCH_ID,
      provider: 'RIOT',
      externalMatchId: 'NA1_matchup1',
      regionalRoute: 'americas',
      platformRoute: 'na1',
      gameCreation: new Date('2024-06-01T00:00:00.000Z'),
      gameEndTimestamp: new Date('2024-06-01T00:30:00.000Z'),
      gameDurationSeconds: 1800,
      gameVersion: '14.1.1',
      normalizedPatch: '14.1',
      queueId: 420,
      mapId: 11,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      remake: false,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
      ingestedAt: new Date(),
      participants: { create: tenLaneParticipants({ ahriWins: true }) },
      teams: {
        create: [
          { teamId: 100, win: true },
          { teamId: 200, win: false },
        ],
      },
    },
  });
}

async function seedRemakeMatch(): Promise<void> {
  await prisma.match.create({
    data: {
      id: REMAKE_ID,
      provider: 'RIOT',
      externalMatchId: 'NA1_matchup_remake',
      regionalRoute: 'americas',
      platformRoute: 'na1',
      gameCreation: new Date('2024-06-01T01:00:00.000Z'),
      gameEndTimestamp: new Date('2024-06-01T01:03:00.000Z'),
      gameDurationSeconds: 180,
      gameVersion: '14.1.1',
      normalizedPatch: '14.1',
      queueId: 420,
      mapId: 11,
      gameMode: 'CLASSIC',
      gameType: 'MATCHED_GAME',
      remake: true,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
      ingestedAt: new Date(),
      participants: { create: tenLaneParticipants({ ahriWins: false }) },
      teams: {
        create: [
          { teamId: 100, win: false },
          { teamId: 200, win: true },
        ],
      },
    },
  });
}

function rebuildInput(overrides: {
  dryRun?: boolean;
  confirmed?: boolean;
  redis?: ReturnType<typeof mockRedis>;
}) {
  return {
    prisma,
    redis: (overrides.redis ?? mockRedis()) as never,
    dryRun: overrides.dryRun ?? false,
    confirmed: overrides.confirmed ?? true,
    batchSize: 50,
    offset: 0,
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
    filters: {
      patch: '14.1',
      platformRoute: 'na1',
      queueId: 420,
    },
  };
}

describe('rebuild champion matchups', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetTestData();
    await seedEligibleMatch();
    await seedRemakeMatch();
  });

  it('dry-run reports pairing without writes', async () => {
    const redis = mockRedis();
    const result = await runRebuildChampionMatchups(rebuildInput({ dryRun: true, redis }));
    expect(result.exitCode).toBe(0);
    expect(result.report.dryRun).toBe(true);
    expect(result.report.eligibleMatches).toBe(1);
    expect(result.report.matchesWithAllFivePairs).toBe(1);
    expect(result.report.directionalObservations).toBe(10);
    expect(result.report.skips).toEqual({
      UNKNOWN_POSITION: 0,
      DUPLICATE_POSITION: 0,
      MISSING_OPPONENT: 0,
      MALFORMED_TEAM: 0,
      SAME_CHAMPION_MIRROR: 0,
    });
    expect(await prisma.matchupAggregate.count()).toBe(0);
    expect(await prisma.matchParticipant.count()).toBe(20);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('requires confirmation for mutating apply', async () => {
    const result = await runRebuildChampionMatchups(rebuildInput({ confirmed: false }));
    expect(result.exitCode).toBe(1);
    expect(result.report.error).toMatch(/confirm/i);
    expect(await prisma.matchupAggregate.count()).toBe(0);
  });

  it('emits both directions once and attributes rank to the subject only', async () => {
    const redis = mockRedis();
    const result = await runRebuildChampionMatchups(rebuildInput({ redis }));
    expect(result.exitCode).toBe(0);
    expect(result.report.upsertsApplied).toBeGreaterThan(0);

    const ahriVsSyndra = await prisma.matchupAggregate.findMany({
      where: { championId: 103, opponentChampionId: 134, teamPosition: 'MIDDLE' },
      orderBy: { rankTier: 'asc' },
    });
    const syndraVsAhri = await prisma.matchupAggregate.findMany({
      where: { championId: 134, opponentChampionId: 103, teamPosition: 'MIDDLE' },
      orderBy: { rankTier: 'asc' },
    });

    expect(ahriVsSyndra.map((row) => row.rankTier).sort()).toEqual(['ALL', 'GOLD']);
    expect(syndraVsAhri.map((row) => row.rankTier).sort()).toEqual(['ALL', 'PLATINUM']);
    expect(ahriVsSyndra.every((row) => row.sampleSize === 1 && row.wins === 1)).toBe(true);
    expect(syndraVsAhri.every((row) => row.sampleSize === 1 && row.wins === 0)).toBe(true);
    expect(ahriVsSyndra.some((row) => row.rankTier === 'PLATINUM')).toBe(false);
    expect(syndraVsAhri.some((row) => row.rankTier === 'GOLD')).toBe(false);

    const ahriAll = ahriVsSyndra.find((row) => row.rankTier === 'ALL');
    expect(ahriAll?.totalGoldDifferenceAt10).toBe(500);
    expect(ahriAll?.goldDifferenceAt10Samples).toBe(1);

    expect(await prisma.matchParticipant.count()).toBe(20);
  });

  it('is idempotent and deletes stale rows without deleting source participants', async () => {
    const redis = mockRedis();
    const first = await runRebuildChampionMatchups(rebuildInput({ redis }));
    expect(first.exitCode).toBe(0);
    const count = await prisma.matchupAggregate.count();
    expect(count).toBeGreaterThan(0);

    await prisma.matchupAggregate.create({
      data: {
        patch: '14.1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'IRON',
        teamPosition: 'MIDDLE',
        championId: 999,
        opponentChampionId: 998,
        sampleSize: 99,
        wins: 99,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date(),
      },
    });
    expect(await prisma.matchupAggregate.count()).toBe(count + 1);

    const second = await runRebuildChampionMatchups(rebuildInput({ redis }));
    expect(second.exitCode).toBe(0);
    expect(await prisma.matchupAggregate.count()).toBe(count);
    expect(second.report.deletionsApplied).toBe(count + 1);
    expect(
      await prisma.matchupAggregate.findFirst({
        where: { championId: 999, opponentChampionId: 998 },
      }),
    ).toBeNull();
    expect(await prisma.matchParticipant.count()).toBe(20);
    expect(redis.incr).toHaveBeenCalledTimes(2);
  });

  it('incrementally deletes stale rank rows for affected pair identities', async () => {
    const redis = mockRedis();
    await runRebuildChampionMatchups(rebuildInput({ redis }));
    await prisma.matchupAggregate.create({
      data: {
        patch: '14.1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'IRON',
        teamPosition: 'MIDDLE',
        championId: 103,
        opponentChampionId: 134,
        sampleSize: 50,
        wins: 50,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        calculatedAt: new Date(),
      },
    });

    const result = await recalculateMatchupsForMatch({
      prisma,
      redis: redis as never,
      matchId: MATCH_ID,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    });
    expect(result.deletions).toBeGreaterThan(0);
    expect(
      await prisma.matchupAggregate.findFirst({
        where: {
          championId: 103,
          opponentChampionId: 134,
          teamPosition: 'MIDDLE',
          rankTier: 'IRON',
        },
      }),
    ).toBeNull();
    const remaining = await prisma.matchupAggregate.findMany({
      where: { championId: 103, opponentChampionId: 134, teamPosition: 'MIDDLE' },
    });
    expect(remaining.map((row) => row.rankTier).sort()).toEqual(['ALL', 'GOLD']);
    expect(remaining.every((row) => row.wins === 1 && row.sampleSize === 1)).toBe(true);
    expect(await prisma.matchParticipant.count()).toBe(20);
  });
});
