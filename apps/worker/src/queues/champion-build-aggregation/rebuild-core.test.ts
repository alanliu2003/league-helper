import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchIngestionStatus, PrismaClient, StaticDataStatus } from '@prisma/client';
import { initialParticipantRankResolutionStatus } from '@league-helper/shared';
import { runRebuildChampionBuilds } from './rebuild-core.js';

const testDatabaseUrl =
  process.env.WORKER_TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_worker_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

function mockRedis() {
  return { incr: vi.fn().mockResolvedValue(1), quit: vi.fn() };
}

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AnalysisFinding",
      "PlayerAnalysisReport",
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

async function seedBuildSource(): Promise<void> {
  await prisma.patch.create({
    data: {
      version: '14.1.1',
      normalizedMajorMinor: '14.1',
      dataDragonVersion: '14.1.1',
      isActive: true,
      staticDataStatus: StaticDataStatus.READY,
      items: {
        create: [
          {
            itemId: 3006,
            name: "Berserker's Greaves",
            description: 'Boots',
            goldData: { total: 1100 },
            stats: {},
            tags: ['Boots'],
            imageData: {},
            purchasable: true,
            fromItemIds: [1001],
            intoItemIds: [],
            consumed: false,
          },
          {
            itemId: 1056,
            name: "Doran's Ring",
            description: 'Starter',
            goldData: { total: 400 },
            stats: {},
            tags: ['Lane'],
            imageData: {},
            purchasable: true,
            fromItemIds: [],
            intoItemIds: [],
            consumed: false,
          },
          {
            itemId: 3031,
            name: "Infinity Edge",
            description: 'Completed',
            goldData: { total: 3600 },
            stats: {},
            tags: [],
            imageData: {},
            purchasable: true,
            fromItemIds: [1038],
            intoItemIds: [],
            consumed: false,
          },
          {
            itemId: 3089,
            name: "Rabadon's Deathcap",
            description: 'Completed',
            goldData: { total: 3600 },
            stats: {},
            tags: [],
            imageData: {},
            purchasable: true,
            fromItemIds: [1026],
            intoItemIds: [],
            consumed: false,
          },
          {
            itemId: 3135,
            name: 'Void Staff',
            description: 'Completed',
            goldData: { total: 3000 },
            stats: {},
            tags: [],
            imageData: {},
            purchasable: true,
            fromItemIds: [1026],
            intoItemIds: [],
            consumed: false,
          },
        ],
      },
    },
  });

  await prisma.match.create({
    data: {
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      provider: 'RIOT',
      externalMatchId: 'NA1_build1',
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
      participants: {
        create: [
          {
            participantId: 1,
            championId: 103,
            teamId: 100,
            teamPosition: 'MIDDLE',
            individualPosition: 'MIDDLE',
            lane: 'MIDDLE',
            role: 'SOLO',
            rankTierAtIngestion: 'GOLD',
            rankResolutionStatus: initialParticipantRankResolutionStatus({
              queueId: 420,
              rankTierAtIngestion: 'GOLD',
              externalAccountId: 'seed-puuid',
            }),
            externalAccountId: 'seed-puuid',
            win: true,
            kills: 5,
            deaths: 2,
            assists: 7,
            totalCs: 200,
            timePlayedSeconds: 1800,
            totalDamageDealtToChampions: 20_000,
            visionScore: 30,
            itemIds: [3006, 0, 0, 0, 0, 0, 0],
            perkIds: [8112, 8126, 8138, 8105, 8226, 8210],
            statPerkIds: [5008, 5008, 5001],
            primaryPerkStyleId: 8100,
            secondaryPerkStyleId: 8200,
            summonerSpell1Id: 4,
            summonerSpell2Id: 12,
            skillOrder: [3, 2, 1, 2, 2, 4, 2, 3, 2, 3, 4, 3, 3, 1, 1, 4, 1, 1],
          },
        ],
      },
      teams: {
        create: [
          { teamId: 100, win: true },
          { teamId: 200, win: false },
        ],
      },
      timelineEvents: {
        create: [
          {
            eventIndex: 0,
            type: 'ITEM_PURCHASED',
            timestampMs: 1500,
            participantId: 1,
            itemId: 1056,
          },
          {
            eventIndex: 1,
            type: 'ITEM_PURCHASED',
            timestampMs: 300_000,
            participantId: 1,
            itemId: 3031,
          },
          {
            eventIndex: 2,
            type: 'ITEM_PURCHASED',
            timestampMs: 600_000,
            participantId: 1,
            itemId: 3089,
          },
          {
            eventIndex: 3,
            type: 'ITEM_PURCHASED',
            timestampMs: 900_000,
            participantId: 1,
            itemId: 3135,
          },
          {
            eventIndex: 4,
            type: 'SKILL_LEVEL_UP',
            timestampMs: 2000,
            participantId: 1,
            skillSlot: 3,
            levelUpType: 'NORMAL',
          },
          {
            eventIndex: 5,
            type: 'SKILL_LEVEL_UP',
            timestampMs: 3000,
            participantId: 1,
            skillSlot: 2,
            levelUpType: 'NORMAL',
          },
          {
            eventIndex: 6,
            type: 'SKILL_LEVEL_UP',
            timestampMs: 4000,
            participantId: 1,
            skillSlot: 1,
            levelUpType: 'NORMAL',
          },
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

describe('rebuild champion builds', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetTestData();
    await seedBuildSource();
  });

  it('dry-run reports eligibility without writes', async () => {
    const redis = mockRedis();
    const result = await runRebuildChampionBuilds(rebuildInput({ dryRun: true, redis }));
    expect(result.exitCode).toBe(0);
    expect(result.report.dryRun).toBe(true);
    expect(result.report.eligibleParticipants).toBe(1);
    expect(result.report.eligibility.SUMMONER_SPELLS).toBe(1);
    expect(result.report.eligibility.BOOTS).toBe(1);
    expect(result.report.eligibility.STARTING_ITEMS).toBe(1);
    expect(result.report.eligibility.CORE_BUILD).toBe(1);
    expect(result.report.itemTimelineEligibleParticipants).toBe(1);
    expect(result.report.coreBuildEligibleParticipants).toBe(1);
    expect(result.report.coreBuildIneligibleShort).toBe(0);
    expect(await prisma.championBuildAggregate.count()).toBe(0);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('requires confirmation for mutating apply', async () => {
    const result = await runRebuildChampionBuilds(rebuildInput({ confirmed: false }));
    expect(result.exitCode).toBe(1);
    expect(result.report.error).toMatch(/confirm/i);
    expect(await prisma.championBuildAggregate.count()).toBe(0);
  });

  it('is idempotent across delete+insert rebuilds', async () => {
    const redis = mockRedis();
    const first = await runRebuildChampionBuilds(rebuildInput({ redis }));
    expect(first.exitCode).toBe(0);
    const count = await prisma.championBuildAggregate.count();
    expect(count).toBeGreaterThan(0);
    expect(redis.incr).toHaveBeenCalledTimes(1);

    const second = await runRebuildChampionBuilds(rebuildInput({ redis }));
    expect(second.exitCode).toBe(0);
    expect(await prisma.championBuildAggregate.count()).toBe(count);
    expect(second.report.deletionsApplied).toBe(count);
    expect(redis.incr).toHaveBeenCalledTimes(2);

    const boots = await prisma.championBuildAggregate.findMany({
      where: { category: 'BOOTS', rankTier: 'ALL' },
    });
    expect(boots).toHaveLength(1);
    expect(boots[0]?.sampleSize).toBe(1);
    expect(boots[0]?.wins).toBe(1);

    const maxOrder = await prisma.championBuildAggregate.findMany({
      where: { category: 'SKILL_PRIORITY', rankTier: 'ALL' },
    });
    expect(maxOrder).toHaveLength(1);
    expect(maxOrder[0]?.signature).toBe('W>E>Q');
    expect(maxOrder[0]?.entityIds).toEqual([2, 3, 1]);

    const cores = await prisma.championBuildAggregate.findMany({
      where: { category: 'CORE_BUILD' },
    });
    expect(cores.length).toBeGreaterThan(0);
    expect(cores.every((row) => row.entityIds.length === 3)).toBe(true);
    expect(cores.every((row) => row.signature.split('>').length === 3)).toBe(true);
  });

  it('rebuilds only requested skill categories without deleting boots', async () => {
    const redis = mockRedis();
    const first = await runRebuildChampionBuilds(rebuildInput({ redis }));
    expect(first.exitCode).toBe(0);
    const bootsBefore = await prisma.championBuildAggregate.count({ where: { category: 'BOOTS' } });
    expect(bootsBefore).toBeGreaterThan(0);

    const skillOnly = await runRebuildChampionBuilds({
      ...rebuildInput({ redis }),
      filters: {
        patch: '14.1',
        platformRoute: 'na1',
        queueId: 420,
        categories: ['SKILL_PRIORITY', 'SKILL_SEQUENCE'],
      },
    });
    expect(skillOnly.exitCode).toBe(0);
    expect(await prisma.championBuildAggregate.count({ where: { category: 'BOOTS' } })).toBe(
      bootsBefore,
    );
    const maxOrder = await prisma.championBuildAggregate.findMany({
      where: { category: 'SKILL_PRIORITY', rankTier: 'ALL' },
    });
    expect(maxOrder[0]?.signature).toBe('W>E>Q');
    expect(maxOrder[0]?.signature.includes('>')).toBe(true);
    expect(maxOrder[0]?.signature.split('>')).toHaveLength(3);
  });

  it('rebuilds only CORE_BUILD without deleting boots or skills', async () => {
    const redis = mockRedis();
    const first = await runRebuildChampionBuilds(rebuildInput({ redis }));
    expect(first.exitCode).toBe(0);
    const bootsBefore = await prisma.championBuildAggregate.count({ where: { category: 'BOOTS' } });
    const skillsBefore = await prisma.championBuildAggregate.count({
      where: { category: 'SKILL_PRIORITY' },
    });
    const startingBefore = await prisma.championBuildAggregate.count({
      where: { category: 'STARTING_ITEMS' },
    });
    expect(bootsBefore).toBeGreaterThan(0);
    expect(skillsBefore).toBeGreaterThan(0);

    const coreOnly = await runRebuildChampionBuilds({
      ...rebuildInput({ redis }),
      filters: {
        patch: '14.1',
        platformRoute: 'na1',
        queueId: 420,
        categories: ['CORE_BUILD'],
      },
    });
    expect(coreOnly.exitCode).toBe(0);
    expect(await prisma.championBuildAggregate.count({ where: { category: 'BOOTS' } })).toBe(
      bootsBefore,
    );
    expect(
      await prisma.championBuildAggregate.count({ where: { category: 'SKILL_PRIORITY' } }),
    ).toBe(skillsBefore);
    expect(
      await prisma.championBuildAggregate.count({ where: { category: 'STARTING_ITEMS' } }),
    ).toBe(startingBefore);

    const cores = await prisma.championBuildAggregate.findMany({
      where: { category: 'CORE_BUILD' },
    });
    expect(cores.length).toBeGreaterThan(0);
    expect(cores.every((row) => row.entityIds.length === 3)).toBe(true);
    expect(cores.every((row) => !row.entityIds.includes(3006))).toBe(true);
    expect(coreOnly.report.deletionsApplied).toBe(cores.length);
  });
});
