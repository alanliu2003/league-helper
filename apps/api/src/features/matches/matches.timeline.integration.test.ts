import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatchIngestionStatus, PrismaClient, TimelineFetchStatus, TimelineProductCoverage } from '@prisma/client';
import { PublicMatchDetailSchema, PublicMatchTimelineDetailSchema, ResourceNotFoundError } from '@league-helper/shared';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { MatchDetailService } from './match-detail.service';
import { MatchTimelineService } from './match-timeline.service';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const matches = new MatchRepository(prisma as never);
const playerAccounts = new PlayerAccountRepository(prisma as never);
const staticRepo = new ChampionStaticRepository(prisma as never);

const media = {
  getChampionByNumericId: async () => null,
  buildItemIconUrl: (itemId: number, version: string) =>
    `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`,
  buildRuneIconUrl: (iconPath: string) => `https://ddragon.leagueoflegends.com/cdn/img/${iconPath}`,
  buildSummonerSpellIconUrl: (imageFull: string, version: string) =>
    `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${imageFull}`,
};

const overview = new MatchDetailService(matches, prisma as never, staticRepo, media as never);
const timeline = new MatchTimelineService(matches, prisma as never, staticRepo, media as never);

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AnalysisFinding",
      "PlayerAnalysisReport",
      "ChampionAiInsight",
      "PlayerPlaystyleInsight",
      "PlayerMetricSnapshot",
      "MatchupAggregate",
      "ChampionAggregationRecalcScope",
      "ChampionBuildAggregate",
      "ChampionAggregate",
      "ChampionAggregationProcessing",
      "IngestionJobRecord",
      "ChampionMasterySnapshot",
      "MatchTimelineEvent",
      "MatchTimelineFrame",
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
      "SummonerSpellStaticData",
      "Patch"
    RESTART IDENTITY CASCADE;
  `);
}

function tenParticipants(linkedAccountId?: string) {
  return POSITIONS.flatMap((teamPosition, index) => [
    {
      participantId: index + 1,
      teamId: 100,
      championId: 23,
      teamPosition,
      individualPosition: teamPosition,
      win: true,
      riotIdGameName: `Blue${index + 1}`,
      riotIdTagLine: 'NA1',
      kills: 1,
      deaths: 0,
      assists: 0,
      playerAccountId: index === 0 ? linkedAccountId : undefined,
      externalAccountId: index === 0 ? 'puuid-should-not-leak' : undefined,
    },
    {
      participantId: index + 6,
      teamId: 200,
      championId: 64,
      teamPosition,
      individualPosition: teamPosition,
      win: false,
      riotIdGameName: `Red${index + 1}`,
      riotIdTagLine: 'NA1',
      kills: 0,
      deaths: 1,
      assists: 0,
    },
  ]);
}

describe('matches timeline integration', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns 200 schema coverage for FETCHED product data and cheap overview coverage', async () => {
    const account = await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-should-not-leak',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      gameName: 'Alice',
      tagLine: 'NA1',
    });

    const { match } = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_TIMELINE_STORED',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      mapId: 11,
      gameMode: 'CLASSIC',
      gameCreation: new Date('2026-08-01T00:00:00.000Z'),
      gameDurationSeconds: 1800,
      gameVersion: '14.11.1.123',
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      teams: [
        { teamId: 100, win: true, bans: [103], objectives: null },
        { teamId: 200, win: false, bans: [], objectives: null },
      ],
      participants: tenParticipants(account.id),
      timeline: { fetchStatus: TimelineFetchStatus.FETCHED },
    });

    await prisma.matchTimeline.update({
      where: { matchId: match.id },
      data: {
        productCoverage: TimelineProductCoverage.STORED,
        frameIntervalMs: 60_000,
      },
    });

    await prisma.matchTimelineEvent.createMany({
      data: [
        {
          matchId: match.id,
          eventIndex: 0,
          type: 'ITEM_PURCHASED',
          timestampMs: 1000,
          participantId: 1,
          itemId: 3031,
        },
        {
          matchId: match.id,
          eventIndex: 1,
          type: 'SKILL_LEVEL_UP',
          timestampMs: 2000,
          participantId: 1,
          skillSlot: 1,
        },
        {
          matchId: match.id,
          eventIndex: 2,
          type: 'CHAMPION_KILL',
          timestampMs: 5000,
          killerParticipantId: 1,
          victimParticipantId: 6,
          assistingParticipantIds: [],
          positionX: 10,
          positionY: 20,
        },
        {
          matchId: match.id,
          eventIndex: 3,
          type: 'ELITE_MONSTER_KILL',
          timestampMs: 8000,
          killerParticipantId: 1,
          teamId: 100,
          monsterType: 'DRAGON',
          monsterSubType: 'FIRE_DRAGON',
        },
        {
          matchId: match.id,
          eventIndex: 4,
          type: 'ELITE_MONSTER_KILL',
          timestampMs: 9000,
          killerParticipantId: 1,
          teamId: 100,
          monsterType: 'HORDE',
        },
        {
          matchId: match.id,
          eventIndex: 5,
          type: 'BUILDING_KILL',
          timestampMs: 12_000,
          killerParticipantId: 1,
          teamId: 200,
          buildingType: 'TOWER_BUILDING',
          towerType: 'OUTER_TURRET',
          laneType: 'TOP_LANE',
        },
      ],
    });

    await prisma.matchTimelineFrame.createMany({
      data: [
        { matchId: match.id, timestampMs: 0, participantId: 1, totalGold: 500, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 6, totalGold: 400, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 2, totalGold: 500, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 3, totalGold: 500, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 4, totalGold: 500, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 5, totalGold: 500, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 7, totalGold: 400, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 8, totalGold: 400, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 9, totalGold: 400, xp: 0, cs: 0, level: 1 },
        { matchId: match.id, timestampMs: 0, participantId: 10, totalGold: 400, xp: 0, cs: 0, level: 1 },
      ],
    });

    const detail = await timeline.getTimeline(match.id);
    const parsed = PublicMatchTimelineDetailSchema.parse(detail);
    expect(parsed.coverage).toEqual({
      items: true,
      skills: true,
      kills: true,
      objectives: true,
      frames: true,
    });
    expect(parsed.events).toHaveLength(6);
    expect(parsed.derived.kills).toHaveLength(1);
    expect(parsed.derived.objectives.map((row) => row.type)).toEqual(['dragon', 'tower']);
    expect(parsed.frameIntervalMs).toBe(60_000);
    expect(parsed.derived.gold.timestampsMs).toEqual([0]);
    const json = JSON.stringify(detail);
    expect(json).not.toContain('puuid');
    expect(json).not.toContain('externalAccountId');
    expect(json).not.toContain('rawPayload');

    const overviewDetail = await overview.getMatch(match.id);
    const overviewParsed = PublicMatchDetailSchema.parse(overviewDetail);
    expect(overviewParsed.timeline.productCoverage).toBe('STORED');
    expect(overviewParsed.timeline.productAvailable).toBe(true);
    expect(overviewParsed.timeline).not.toHaveProperty('coverage');
    expect(overviewParsed).not.toHaveProperty('events');
    expect(overviewParsed).not.toHaveProperty('frames');
  });

  it('returns 200 empty coverage for a real match with no product data', async () => {
    const { match } = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_TIMELINE_EMPTY',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-08-01T00:00:00.000Z'),
      gameDurationSeconds: 1800,
      gameVersion: '14.11.1.123',
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      teams: [
        { teamId: 100, win: true },
        { teamId: 200, win: false },
      ],
      participants: [
        {
          participantId: 1,
          teamId: 100,
          championId: 23,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: true,
          riotIdGameName: 'EmptyA',
          riotIdTagLine: 'NA1',
        },
        {
          participantId: 6,
          teamId: 200,
          championId: 64,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: false,
          riotIdGameName: 'EmptyB',
          riotIdTagLine: 'NA1',
        },
      ],
      timeline: { fetchStatus: TimelineFetchStatus.FETCHED },
    });

    const detail = await timeline.getTimeline(match.id);
    expect(detail.coverage).toEqual({
      items: false,
      skills: false,
      kills: false,
      objectives: false,
      frames: false,
    });
    expect(detail.events).toEqual([]);
    expect(detail.frames).toEqual([]);
  });

  it('throws RESOURCE_NOT_FOUND for an unknown match id', async () => {
    await expect(timeline.getTimeline('cccccccc-cccc-cccc-cccc-cccccccccccc')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Match not found.',
    });
    await expect(timeline.getTimeline('cccccccc-cccc-cccc-cccc-cccccccccccc')).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});
