import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IngestionJobStatus,
  MatchIngestionStatus,
  PrismaClient,
  TimelineFetchStatus,
} from '@prisma/client';
import { IngestionJobRepository } from './ingestion-job.repository';
import { MatchRepository } from './match.repository';
import { PlayerAccountRepository } from './player-account.repository';
import { RankSnapshotRepository } from './rank-snapshot.repository';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const playerAccounts = new PlayerAccountRepository(prisma as never);
const ranks = new RankSnapshotRepository(prisma as never);
const matches = new MatchRepository(prisma as never);
const jobs = new IngestionJobRepository(prisma as never);

async function resetTestData(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AnalysisFinding",
      "PlayerAnalysisReport",
      "PlayerMetricSnapshot",
      "MatchupAggregate",
      "ChampionAggregate",
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

describe('persistence integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    await resetTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects and reports database health via raw query', async () => {
    const rows = await prisma.$queryRaw`SELECT 1 as ok`;
    expect(rows).toBeTruthy();
  });

  it('enforces uniqueness on provider + externalAccountId', async () => {
    await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-unique-1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      gameName: 'Alpha',
      tagLine: 'NA1',
    });

    await expect(
      prisma.playerAccount.create({
        data: {
          playerId: (await prisma.player.create({ data: {} })).id,
          provider: 'RIOT',
          externalAccountId: 'puuid-unique-1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          currentGameName: 'Beta',
          currentTagLine: 'NA1',
          normalizedGameName: 'beta',
          normalizedTagLine: 'na1',
        },
      }),
    ).rejects.toThrow();
  });

  it('finds accounts by case-normalized Riot ID', async () => {
    await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-lookup-1',
      platformRoute: 'euw1',
      regionalRoute: 'europe',
      gameName: 'HideOnBush',
      tagLine: 'EUW',
    });

    const found = await playerAccounts.findByPlatformRiotId('RIOT', 'euw1', '  hideonbush ', 'euw');
    expect(found?.externalAccountId).toBe('puuid-lookup-1');
  });

  it('preserves Riot ID alias history without duplicate current rows', async () => {
    const first = await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-alias-1',
      platformRoute: 'kr',
      regionalRoute: 'asia',
      gameName: 'OldName',
      tagLine: 'KR1',
    });

    await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-alias-1',
      platformRoute: 'kr',
      regionalRoute: 'asia',
      gameName: 'OldName',
      tagLine: 'KR1',
    });

    await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-alias-1',
      platformRoute: 'kr',
      regionalRoute: 'asia',
      gameName: 'NewName',
      tagLine: 'KR1',
    });

    const aliases = await prisma.playerAccountAlias.findMany({
      where: { playerAccountId: first.id },
      orderBy: { firstSeenAt: 'asc' },
    });

    expect(aliases).toHaveLength(2);
    expect(aliases.filter((alias) => alias.isCurrent)).toHaveLength(1);
    expect(aliases.find((alias) => alias.isCurrent)?.normalizedGameName).toBe('newname');
  });

  it('inserts rank snapshots only when values change', async () => {
    const account = await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-rank-1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      gameName: 'Ranked',
      tagLine: 'NA1',
    });

    const first = await ranks.insertIfChanged({
      playerAccountId: account.id,
      queueType: 'RANKED_SOLO_5x5',
      tier: 'SILVER',
      division: 'I',
      leaguePoints: 20,
      wins: 5,
      losses: 4,
    });
    const second = await ranks.insertIfChanged({
      playerAccountId: account.id,
      queueType: 'RANKED_SOLO_5x5',
      tier: 'SILVER',
      division: 'I',
      leaguePoints: 20,
      wins: 5,
      losses: 4,
    });
    const third = await ranks.insertIfChanged({
      playerAccountId: account.id,
      queueType: 'RANKED_SOLO_5x5',
      tier: 'SILVER',
      division: 'I',
      leaguePoints: 40,
      wins: 6,
      losses: 4,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).not.toBeNull();
    expect(await prisma.rankSnapshot.count({ where: { playerAccountId: account.id } })).toBe(2);
  });

  it('creates matches idempotently and enforces unique participants', async () => {
    const account = await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-match-1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      gameName: 'Matcher',
      tagLine: 'NA1',
    });

    const payload = {
      provider: 'RIOT' as const,
      externalMatchId: 'NA1_SEED_MATCH_1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-01-01T00:00:00.000Z'),
      gameDurationSeconds: 1200,
      gameVersion: '14.1.1.123',
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      teams: [
        { teamId: 100, win: true, bans: [1] },
        { teamId: 200, win: false, bans: [2] },
      ],
      participants: [
        {
          participantId: 0,
          playerAccountId: account.id,
          externalAccountId: account.externalAccountId,
          championId: 157,
          teamId: 100,
          teamPosition: 'MIDDLE',
          individualPosition: 'MIDDLE',
          win: true,
        },
        {
          participantId: 1,
          championId: 103,
          teamId: 200,
          teamPosition: 'MIDDLE',
          individualPosition: 'MIDDLE',
          win: false,
        },
      ],
      timeline: { fetchStatus: TimelineFetchStatus.FETCHED, rawPayload: { frames: [] } },
    };

    const first = await matches.createMatchIdempotent(payload);
    const second = await matches.createMatchIdempotent(payload);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.match.id).toBe(first.match.id);

    await expect(
      prisma.matchParticipant.create({
        data: {
          matchId: first.match.id,
          participantId: 0,
          championId: 1,
          teamId: 100,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: true,
        },
      }),
    ).rejects.toThrow();
  });

  it('attaches a known account to a participant and keeps history after account delete', async () => {
    const account = await playerAccounts.upsertPlayerAccount({
      provider: 'RIOT',
      externalAccountId: 'puuid-attach-1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      gameName: 'Attach',
      tagLine: 'NA1',
    });

    const { match } = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_SEED_MATCH_ATTACH',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-01-01T00:00:00.000Z'),
      gameDurationSeconds: 1000,
      gameVersion: '14.1.1.123',
      teams: [
        { teamId: 100, win: true },
        { teamId: 200, win: false },
      ],
      participants: [
        {
          participantId: 0,
          championId: 1,
          teamId: 100,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: true,
          externalAccountId: 'puuid-attach-1',
        },
      ],
    });

    const attached = await matches.attachPlayerAccountToParticipant(match.id, 0, account.id);
    expect(attached.playerAccountId).toBe(account.id);

    await prisma.playerAccount.delete({ where: { id: account.id } });

    const survivingMatch = await prisma.match.findUnique({ where: { id: match.id } });
    const participant = await prisma.matchParticipant.findUnique({
      where: { matchId_participantId: { matchId: match.id, participantId: 0 } },
    });

    expect(survivingMatch).not.toBeNull();
    expect(participant?.playerAccountId).toBeNull();
    expect(participant?.externalAccountId).toBe('puuid-attach-1');
  });

  it('cascades match deletion to participants/teams/timeline', async () => {
    const { match } = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_SEED_MATCH_CASCADE',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-01-01T00:00:00.000Z'),
      gameDurationSeconds: 900,
      gameVersion: '14.1.1.123',
      teams: [
        { teamId: 100, win: true },
        { teamId: 200, win: false },
      ],
      participants: [
        {
          participantId: 0,
          championId: 1,
          teamId: 100,
          teamPosition: 'TOP',
          individualPosition: 'TOP',
          win: true,
        },
      ],
      timeline: { fetchStatus: TimelineFetchStatus.PENDING },
    });

    await prisma.match.delete({ where: { id: match.id } });

    expect(await prisma.matchParticipant.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.matchTeam.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.matchTimeline.count({ where: { matchId: match.id } })).toBe(0);
  });

  it('creates ingestion jobs idempotently', async () => {
    const first = await jobs.createIdempotent({
      jobType: 'match.ingest',
      idempotencyKey: 'match:NA1_1',
      provider: 'RIOT',
      externalResourceId: 'NA1_1',
      status: IngestionJobStatus.QUEUED,
    });
    const second = await jobs.createIdempotent({
      jobType: 'match.ingest',
      idempotencyKey: 'match:NA1_1',
      provider: 'RIOT',
      externalResourceId: 'NA1_1',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it('runs the development seed idempotently', async () => {
    const { execSync } = await import('node:child_process');
    const path = await import('node:path');
    const apiRoot = path.resolve(__dirname, '../..');

    execSync('npx tsx prisma/seed.ts', {
      cwd: apiRoot,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    });
    execSync('npx tsx prisma/seed.ts', {
      cwd: apiRoot,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    });

    const accounts = await prisma.playerAccount.findMany({
      where: { externalAccountId: 'seed-fake-puuid-00000000-0000-4000-8000-000000000001' },
    });
    const seedMatches = await prisma.match.findMany({
      where: { externalMatchId: 'SEED_NA1_0000000001' },
    });

    expect(accounts).toHaveLength(1);
    expect(seedMatches).toHaveLength(1);
    expect(await prisma.matchParticipant.count({ where: { matchId: seedMatches[0]?.id } })).toBe(
      10,
    );
  }, 120_000);

  it('enforces aggregate dimension uniqueness and champion != opponent', async () => {
    await prisma.championAggregate.create({
      data: {
        patch: '14.1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: 'GOLD',
        teamPosition: 'MIDDLE',
        championId: 157,
        sampleSize: 10,
        wins: 6,
        calculatedAt: new Date(),
        sourceNormalizationVersion: '1',
      },
    });

    await expect(
      prisma.championAggregate.create({
        data: {
          patch: '14.1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
          rankTier: 'GOLD',
          teamPosition: 'MIDDLE',
          championId: 157,
          sampleSize: 11,
          wins: 7,
          calculatedAt: new Date(),
          sourceNormalizationVersion: '1',
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.matchupAggregate.create({
        data: {
          patch: '14.1',
          platformRoute: '',
          regionalRoute: '',
          queueId: 420,
          rankTier: 'GOLD',
          teamPosition: 'MIDDLE',
          championId: 157,
          opponentChampionId: 157,
          sampleSize: 5,
          wins: 2,
          calculatedAt: new Date(),
          sourceNormalizationVersion: '1',
        },
      }),
    ).rejects.toThrow();
  });
});
