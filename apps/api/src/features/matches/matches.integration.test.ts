import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MatchIngestionStatus, PrismaClient, TimelineFetchStatus } from '@prisma/client';
import { PublicMatchDetailSchema, ResourceNotFoundError } from '@league-helper/shared';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { MatchDetailService } from './match-detail.service';

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

const service = new MatchDetailService(matches, prisma as never, staticRepo, media as never);

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

describe('matches integration', () => {
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

  it('returns a completed 10-player match that parses as PublicMatchDetail', async () => {
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
      externalMatchId: 'NA1_DETAIL_COMPLETE',
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
        { teamId: 100, win: true, bans: [103], objectives: { dragon: { first: true, kills: 2 } } },
        { teamId: 200, win: false, bans: [], objectives: null },
      ],
      participants: tenParticipants(account.id),
      timeline: { fetchStatus: TimelineFetchStatus.FETCHED },
    });

    const detail = await service.getMatch(match.id);
    const parsed = PublicMatchDetailSchema.parse(detail);
    expect(parsed.teams).toHaveLength(2);
    expect(parsed.teams.flatMap((team) => team.participants)).toHaveLength(10);
    expect(parsed.teams[0]!.participants[0]!.playerId).toBe(account.playerId);
    const json = JSON.stringify(detail);
    expect(json).not.toContain('puuid');
    expect(json).not.toContain('externalAccountId');
    expect(json).not.toContain('rawPayload');
  });

  it('throws RESOURCE_NOT_FOUND for an unknown match id', async () => {
    await expect(service.getMatch('cccccccc-cccc-cccc-cccc-cccccccccccc')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(service.getMatch('cccccccc-cccc-cccc-cccc-cccccccccccc')).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });

  it('returns 200-equivalent data for remakes and incomplete ingestions', async () => {
    const remake = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_DETAIL_REMAKE',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-08-01T00:00:00.000Z'),
      gameDurationSeconds: 180,
      gameVersion: '14.11.1.123',
      remake: true,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      teams: [
        { teamId: 100, win: false },
        { teamId: 200, win: false },
      ],
      participants: [
        {
          participantId: 1,
          teamId: 100,
          championId: 23,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: false,
          riotIdGameName: 'RemakeA',
          riotIdTagLine: 'NA1',
        },
        {
          participantId: 6,
          teamId: 200,
          championId: 64,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: false,
          riotIdGameName: 'RemakeB',
          riotIdTagLine: 'NA1',
        },
      ],
    });

    const incomplete = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_DETAIL_PENDING',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-08-01T00:00:00.000Z'),
      gameDurationSeconds: 600,
      gameVersion: '14.11.1.123',
      ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
      teams: [{ teamId: 100, win: true }],
      participants: [
        {
          participantId: 1,
          teamId: 100,
          championId: 23,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: true,
          riotIdGameName: 'Partial',
          riotIdTagLine: 'NA1',
        },
      ],
    });

    const remakeDetail = await service.getMatch(remake.match.id);
    expect(remakeDetail.match.remake).toBe(true);
    expect(remakeDetail.match.winningSide).toBeNull();

    const incompleteDetail = await service.getMatch(incomplete.match.id);
    expect(incompleteDetail.match.ingestionStatus).toBe('IN_PROGRESS');
    expect(incompleteDetail.teams.flatMap((team) => team.participants)).toHaveLength(1);
  });
});
