import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChampionAggregationProcessingStatus,
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
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_test';

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

function baseChampionAggregateData(
  overrides: Partial<{
    patch: string;
    platformRoute: string;
    regionalRoute: string;
    queueId: number;
    rankTier: string;
    teamPosition: string;
    championId: number;
    sampleSize: number;
    wins: number;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
    totalCsDifferenceAt10: number | null;
    csDifferenceAt10Samples: number;
    totalCsDifferenceAt15: number | null;
    csDifferenceAt15Samples: number;
    totalGoldDifferenceAt10: number | null;
    goldDifferenceAt10Samples: number;
    totalGoldDifferenceAt15: number | null;
    goldDifferenceAt15Samples: number;
    latestEligibleMatchAt: Date | null;
  }> = {},
) {
  return {
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
    ...overrides,
  };
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
      data: baseChampionAggregateData(),
    });

    await expect(
      prisma.championAggregate.create({
        data: baseChampionAggregateData({
          sampleSize: 11,
          wins: 7,
        }),
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

  it('allows champion aggregate version coexistence and rejects same-version duplicates', async () => {
    const v1 = await prisma.championAggregate.create({
      data: baseChampionAggregateData({
        aggregationVersion: '1',
        sourceNormalizationVersion: '1',
      }),
    });

    const v2 = await prisma.championAggregate.create({
      data: baseChampionAggregateData({
        aggregationVersion: '2',
        sourceNormalizationVersion: '1',
        sampleSize: 12,
        wins: 8,
      }),
    });

    expect(v1.aggregationVersion).toBe('1');
    expect(v2.aggregationVersion).toBe('2');
    expect(v1.id).not.toBe(v2.id);

    await expect(
      prisma.championAggregate.create({
        data: baseChampionAggregateData({
          aggregationVersion: '1',
          sourceNormalizationVersion: '1',
          sampleSize: 99,
          wins: 50,
        }),
      }),
    ).rejects.toThrow();
  });

  it('defaults CSD sample counters to 0 and latestEligibleMatchAt to null', async () => {
    const row = await prisma.championAggregate.create({
      data: baseChampionAggregateData(),
    });

    expect(row.csDifferenceAt10Samples).toBe(0);
    expect(row.csDifferenceAt15Samples).toBe(0);
    expect(row.totalCsDifferenceAt10).toBeNull();
    expect(row.totalCsDifferenceAt15).toBeNull();
    expect(row.goldDifferenceAt10Samples).toBe(0);
    expect(row.goldDifferenceAt15Samples).toBe(0);
    expect(row.totalGoldDifferenceAt10).toBeNull();
    expect(row.totalGoldDifferenceAt15).toBeNull();
    expect(row.latestEligibleMatchAt).toBeNull();
    expect(row.aggregationVersion).toBe('1');
  });

  it('rejects negative GD/CSD sample counters via CHECK', async () => {
    await expect(
      prisma.championAggregate.create({
        data: baseChampionAggregateData({ csDifferenceAt10Samples: -1 }),
      }),
    ).rejects.toThrow();

    await expect(
      prisma.championAggregate.create({
        data: baseChampionAggregateData({ goldDifferenceAt15Samples: -1 }),
      }),
    ).rejects.toThrow();
  });

  it('accepts null totals with zero samples and zero totals with positive samples', async () => {
    const zeroSamples = await prisma.championAggregate.create({
      data: baseChampionAggregateData({
        championId: 1,
        totalCsDifferenceAt10: null,
        csDifferenceAt10Samples: 0,
        totalGoldDifferenceAt10: null,
        goldDifferenceAt10Samples: 0,
      }),
    });
    expect(zeroSamples.totalCsDifferenceAt10).toBeNull();
    expect(zeroSamples.csDifferenceAt10Samples).toBe(0);

    const zeroTotalPositiveSamples = await prisma.championAggregate.create({
      data: baseChampionAggregateData({
        championId: 2,
        totalCsDifferenceAt10: 0,
        csDifferenceAt10Samples: 3,
        totalCsDifferenceAt15: 0,
        csDifferenceAt15Samples: 2,
        totalGoldDifferenceAt10: 0,
        goldDifferenceAt10Samples: 4,
        totalGoldDifferenceAt15: 0,
        goldDifferenceAt15Samples: 1,
      }),
    });
    expect(zeroTotalPositiveSamples.totalCsDifferenceAt10).toBe(0);
    expect(zeroTotalPositiveSamples.csDifferenceAt10Samples).toBe(3);

    const positiveSamples = await prisma.championAggregate.create({
      data: baseChampionAggregateData({
        championId: 3,
        totalCsDifferenceAt10: 12,
        csDifferenceAt10Samples: 5,
        totalGoldDifferenceAt15: -40,
        goldDifferenceAt15Samples: 5,
      }),
    });
    expect(positiveSamples.totalCsDifferenceAt10).toBe(12);
    expect(positiveSamples.csDifferenceAt10Samples).toBe(5);
  });

  it('enforces champion aggregation processing unique key and cascades on match delete', async () => {
    const { match } = await matches.createMatchIdempotent({
      provider: 'RIOT',
      externalMatchId: 'NA1_SEED_MATCH_AGG_PROC',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      queueId: 420,
      gameCreation: new Date('2026-01-01T00:00:00.000Z'),
      gameDurationSeconds: 1100,
      gameVersion: '14.1.1.123',
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      teams: [
        { teamId: 100, win: true },
        { teamId: 200, win: false },
      ],
      participants: [
        {
          participantId: 0,
          championId: 157,
          teamId: 100,
          teamPosition: 'MIDDLE',
          individualPosition: 'MIDDLE',
          win: true,
        },
      ],
    });

    const marker = await prisma.championAggregationProcessing.create({
      data: {
        matchId: match.id,
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
        status: ChampionAggregationProcessingStatus.COMPLETED,
        processedAt: new Date(),
      },
    });

    expect(marker.status).toBe(ChampionAggregationProcessingStatus.COMPLETED);

    await expect(
      prisma.championAggregationProcessing.create({
        data: {
          matchId: match.id,
          sourceNormalizationVersion: '1',
          aggregationVersion: '1',
          status: ChampionAggregationProcessingStatus.FAILED,
          processedAt: new Date(),
          lastErrorCode: 'DUPLICATE',
        },
      }),
    ).rejects.toThrow();

    const failedMarker = await prisma.championAggregationProcessing.create({
      data: {
        matchId: match.id,
        sourceNormalizationVersion: '1',
        aggregationVersion: '2',
        status: ChampionAggregationProcessingStatus.FAILED,
        processedAt: new Date(),
        lastErrorCode: 'AGG_FAILED',
      },
    });
    expect(failedMarker.status).toBe(ChampionAggregationProcessingStatus.FAILED);

    const matchCountBefore = await prisma.match.count({ where: { id: match.id } });
    const participantCountBefore = await prisma.matchParticipant.count({
      where: { matchId: match.id },
    });
    expect(matchCountBefore).toBe(1);
    expect(participantCountBefore).toBe(1);

    await prisma.match.delete({ where: { id: match.id } });

    expect(await prisma.championAggregationProcessing.count({ where: { matchId: match.id } })).toBe(
      0,
    );
    expect(await prisma.match.count({ where: { id: match.id } })).toBe(0);
    expect(await prisma.matchParticipant.count({ where: { matchId: match.id } })).toBe(0);
  });
});
