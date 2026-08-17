import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { IngestionJobStatus } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  ProviderRateLimitedError,
  ResourceNotFoundError,
} from '@league-helper/shared';
import { loadPlayerRefreshConfig, PLAYER_REFRESH_CONFIG } from '../../config/player-refresh.config';
import { MockRiotGameDataProvider } from '@league-helper/server-riot';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import { IngestionJobRepository } from '../../persistence/ingestion-job.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import { MATCH_INGESTION_QUEUE, PLAYER_AI_PLAYSTYLE_QUEUE, REDIS_CONNECTION } from '../../queues/queue.tokens';
import { PlayerPlaystyleService } from './player-playstyle.service';
import { PlayerProfileService } from './player-profile.service';
import { PlayerRefreshService } from './player-refresh.service';
import { PlayerSearchService } from './player-search.service';
import { PlayersModule } from './players.module';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_test';

describe('players search integration', () => {
  let prisma: PrismaService;
  let search: PlayerSearchService;
  let profile: PlayerProfileService;
  let playstyle: PlayerPlaystyleService;
  let refreshService: PlayerRefreshService;
  let jobs: IngestionJobRepository;
  let mockProvider: MockRiotGameDataProvider;

  const publishedJobIds = new Set<string>();
  const producerMock = {
    enqueueMatch: vi.fn(async (payload: { externalMatchId: string }) => {
      const jobId = `ingest_${payload.externalMatchId}`;
      const alreadyExists = publishedJobIds.has(jobId);
      publishedJobIds.add(jobId);
      return {
        externalMatchId: payload.externalMatchId,
        jobId,
        published: true,
        alreadyExists,
      };
    }),
    enqueueMatches: vi.fn(),
    getJobState: vi.fn(async (jobId: string) => (publishedJobIds.has(jobId) ? 'waiting' : null)),
    getJobStates: vi.fn(async (jobIds: string[]) => {
      const map = new Map<string, string | null>();
      for (const id of jobIds) {
        map.set(id, publishedJobIds.has(id) ? 'waiting' : null);
      }
      return map;
    }),
    getQueueCounts: vi.fn(async () => ({
      waiting: publishedJobIds.size,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
    })),
  };

  const redisMock = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => 'OK'),
    del: vi.fn(async () => 1),
    ttl: vi.fn(async () => -2),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
  };

  beforeAll(async () => {
    process.env.RIOT_PROVIDER_MODE = 'mock';
    process.env.CHAMPION_STATS_DEFAULT_PLATFORM ??= 'na1';
    // Never truncate the public/dev schema used by local `pnpm dev`.
    process.env.DATABASE_URL = testDatabaseUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [PlayersModule],
    })
      .overrideProvider(PLAYER_REFRESH_CONFIG)
      .useValue({
        ...loadPlayerRefreshConfig(),
        cooldownSeconds: 0,
        masterySnapshotMinAgeSeconds: 3600,
        defaultMatchCount: 5,
        maxMatchCount: 20,
        matchIngestionQueueName: 'test-match-ingestion',
      })
      .overrideProvider(REDIS_CONNECTION)
      .useValue(redisMock)
      .overrideProvider(MATCH_INGESTION_QUEUE)
      .useValue({
        add: vi.fn(),
        getJob: vi.fn(async () => null),
        getJobCounts: vi.fn(async () => ({})),
        close: vi.fn(),
      })
      .overrideProvider(PLAYER_AI_PLAYSTYLE_QUEUE)
      .useValue({
        add: vi.fn(),
        getJob: vi.fn(async () => null),
        getJobCounts: vi.fn(async () => ({})),
        close: vi.fn(),
      })
      .overrideProvider(MatchIngestionProducer)
      .useValue(producerMock)
      .overrideProvider(GAME_DATA_PROVIDER)
      .useFactory({
        factory: (): MockRiotGameDataProvider => new MockRiotGameDataProvider(),
      })
      .overrideProvider(DataDragonChampionService)
      .useValue({
        getAllChampions: vi.fn(async () => []),
        getChampionByNumericId: vi.fn(async () => null),
        getChampionByStringId: vi.fn(async () => null),
        getCurrentVersion: vi.fn(async () => '14.15.1'),
        getBaseUrl: vi.fn(() => 'https://ddragon.leagueoflegends.com'),
        buildChampionIconUrl: vi.fn(() => ''),
        buildProfileIconUrl: vi.fn(
          (profileIconId: number, version: string) =>
            `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`,
        ),
        buildItemIconUrl: vi.fn(() => null),
        refreshCache: vi.fn(async () => []),
      })
      .compile();

    prisma = moduleRef.get(PrismaService);
    search = moduleRef.get(PlayerSearchService);
    profile = moduleRef.get(PlayerProfileService);
    playstyle = moduleRef.get(PlayerPlaystyleService);
    refreshService = moduleRef.get(PlayerRefreshService);
    jobs = moduleRef.get(IngestionJobRepository);
    mockProvider = moduleRef.get(GAME_DATA_PROVIDER) as MockRiotGameDataProvider;
  });

  beforeEach(async () => {
    publishedJobIds.clear();
    producerMock.enqueueMatch.mockClear();
    redisMock.get.mockClear();
    redisMock.set.mockClear();
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "IngestionJobRecord",
        "ChampionMasterySnapshot",
        "RankSnapshot",
        "MatchParticipant",
        "MatchTeam",
        "MatchTimeline",
        "Match",
        "PlayerAccountAlias",
        "CollectorRun",
        "TrackedPlayer",
        "PlayerAccount",
        "Player"
      CASCADE
    `);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('creates Player and PlayerAccount on first search and reuses on repeat', async () => {
    const first = await search.search(
      { gameName: 'Example', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
      'corr-1',
    );
    const second = await search.search(
      { gameName: 'Example', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
      'corr-2',
    );

    expect(first.player.id).toBe(second.player.id);
    expect(first.player.accountId).toBe(second.player.accountId);
    expect(JSON.stringify(first)).not.toMatch(/puuid/i);
    expect(JSON.stringify(first)).not.toContain('externalAccountId');

    const accounts = await prisma.playerAccount.count();
    expect(accounts).toBe(1);
  });

  it('preserves Riot ID alias history without duplicating current aliases', async () => {
    await search.search(
      { gameName: 'AliasOne', tagLine: 'NA1', platform: 'na1', matchCount: 1 },
      'corr-a',
    );

    const account = await prisma.playerAccount.findFirstOrThrow();
    const resolveSpy = vi.spyOn(mockProvider, 'resolvePlayer');
    resolveSpy.mockResolvedValueOnce({
      provider: 'RIOT',
      externalAccountId: account.externalAccountId,
      riotId: { gameName: 'AliasTwo', tagLine: 'NA1' },
      platform: 'na1',
      regionalRoute: 'americas',
      summonerId: 'summoner-1',
      accountId: 'acct-1',
      profileIconId: 1,
      summonerLevel: 30,
    });

    const result = await search.search(
      { gameName: 'AliasTwo', tagLine: 'NA1', platform: 'na1', matchCount: 1 },
      'corr-b',
    );

    expect(result.player.id).toBe(account.playerId);
    expect(result.player.riotId.gameName).toBe('AliasTwo');

    const aliases = await prisma.playerAccountAlias.findMany({
      where: { playerAccountId: account.id },
    });
    expect(aliases.filter((a) => a.isCurrent)).toHaveLength(1);

    resolveSpy.mockRestore();
  });

  it('rejects unsupported platform before provider invocation', async () => {
    const spy = vi.spyOn(mockProvider, 'resolvePlayer');
    await expect(
      search.search({ gameName: 'Example', tagLine: 'NA1', platform: 'cn1' as never }, 'corr-x'),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('does not create records when player is not found', async () => {
    await expect(
      search.search(
        { gameName: 'MissingPlayer', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
        'corr-404',
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);

    expect(await prisma.player.count()).toBe(0);
    expect(await prisma.ingestionJobRecord.count()).toBe(0);
  });

  it('returns not found for playstyle on an unknown player uuid', async () => {
    await expect(
      playstyle.getPlaystyle('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it('stores ranks and mastery and enqueues missing matches', async () => {
    const result = await search.search(
      { gameName: 'QueueTest', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
      'corr-q',
    );

    expect(result.ranks.length).toBeGreaterThan(0);
    expect(result.mastery.length).toBeGreaterThan(0);
    expect(result.refresh.queuedMatchCount).toBeGreaterThan(0);
    expect(result.refresh.state).toBe('PROCESSING');
    expect(result.refresh.state).not.toBe('COMPLETE');
    expect(producerMock.enqueueMatch).toHaveBeenCalled();

    const jobCount = await prisma.ingestionJobRecord.count({
      where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.QUEUED },
    });
    expect(jobCount).toBeGreaterThan(0);

    const before = await prisma.ingestionJobRecord.count();
    await search.search(
      { gameName: 'QueueTest', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
      'corr-q2',
    );
    const after = await prisma.ingestionJobRecord.count();
    expect(after).toBe(before);
  });

  it('links existing participants by PUUID so matches become visible without COMPLETE-from-discovery', async () => {
    const created = await search.search(
      { gameName: 'LinkMe', tagLine: 'NA1', platform: 'na1', matchCount: 1 },
      'corr-link-1',
    );
    const account = await prisma.playerAccount.findFirstOrThrow({
      where: { playerId: created.player.id },
    });

    // Simulate a Match that was ingested but never linked to this account.
    const match = await prisma.match.create({
      data: {
        provider: 'RIOT',
        externalMatchId: 'NA1_FAKE_MATCH_1001',
        regionalRoute: 'americas',
        queueId: 420,
        gameCreation: new Date(),
        gameDurationSeconds: 1800,
        gameVersion: '14.1.1',
        ingestionStatus: 'COMPLETED',
        normalizationVersion: '1',
        participants: {
          create: {
            participantId: 1,
            externalAccountId: account.externalAccountId,
            championId: 1,
            teamId: 100,
            teamPosition: 'TOP',
            individualPosition: 'TOP',
            win: true,
            kills: 1,
            deaths: 0,
            assists: 2,
          },
        },
        teams: {
          create: { teamId: 100, win: true },
        },
      },
    });

    expect(match.id).toBeTruthy();
    expect(await prisma.matchParticipant.count({ where: { playerAccountId: account.id } })).toBe(0);

    const refreshed = await search.search(
      { gameName: 'LinkMe', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
      'corr-link-2',
    );

    expect(
      await prisma.matchParticipant.count({ where: { playerAccountId: account.id } }),
    ).toBeGreaterThan(0);
    expect(refreshed.matches.some((m) => m.externalMatchId === 'NA1_FAKE_MATCH_1001')).toBe(true);
    // Discovery alone must not mark COMPLETE while other IDs remain uningested.
    expect(refreshed.refresh.state).not.toBe('COMPLETE');
  });

  it('keeps profile reads offline from Riot', async () => {
    const created = await search.search(
      { gameName: 'ReadOnly', tagLine: 'NA1', platform: 'na1', matchCount: 2 },
      'corr-r',
    );

    const spy = vi.spyOn(mockProvider, 'resolvePlayer');
    const loaded = await profile.getProfile(created.player.id);
    expect(loaded.player.id).toBe(created.player.id);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(loaded)).not.toMatch(/puuid/i);
    spy.mockRestore();
  });

  it('does not fail profile when Data Dragon is unavailable', async () => {
    const created = await search.search(
      { gameName: 'DdDown', tagLine: 'NA1', platform: 'na1', matchCount: 2 },
      'corr-dd',
    );

    expect(created.mastery.length).toBeGreaterThan(0);
    expect(created.mastery.every((m) => m.championName == null)).toBe(true);

    redisMock.get.mockResolvedValue(null);
    const loaded = await profile.getProfile(created.player.id);
    expect(loaded.player.id).toBe(created.player.id);
    expect(loaded.mastery.every((m) => m.championId > 0)).toBe(true);
    expect(loaded.mastery.every((m) => m.championName == null)).toBe(true);
  });

  it('continues when mastery fails', async () => {
    const masterySpy = vi
      .spyOn(mockProvider, 'getChampionMastery')
      .mockRejectedValueOnce(new ProviderRateLimitedError('slow down', { retryAfterSeconds: 2 }));

    const result = await search.search(
      { gameName: 'Partial', tagLine: 'NA1', platform: 'na1', matchCount: 2 },
      'corr-p',
    );

    expect(result.player.id).toBeTruthy();
    expect(result.refresh.warnings.some((w) => w.code === 'PROVIDER_RATE_LIMITED')).toBe(true);
    masterySpy.mockRestore();
  });

  it('keeps stored matches after refresh discovers additional uningested IDs', async () => {
    const created = await search.search(
      { gameName: 'KeepMatches', tagLine: 'NA1', platform: 'na1', matchCount: 1 },
      'corr-keep-1',
    );
    const account = await prisma.playerAccount.findFirstOrThrow({
      where: { playerId: created.player.id },
    });

    const storedExternalId = 'NA1_STORED_KEEP_1';
    await prisma.match.create({
      data: {
        provider: 'RIOT',
        externalMatchId: storedExternalId,
        regionalRoute: 'americas',
        queueId: 450,
        gameCreation: new Date('2024-06-01T12:00:00.000Z'),
        gameDurationSeconds: 1200,
        gameVersion: '14.1.1',
        ingestionStatus: 'COMPLETED',
        normalizationVersion: '1',
        participants: {
          create: {
            participantId: 1,
            externalAccountId: account.externalAccountId,
            playerAccountId: account.id,
            championId: 23,
            championName: 'Tryndamere',
            teamId: 100,
            teamPosition: 'TOP',
            individualPosition: 'TOP',
            win: true,
            kills: 3,
            deaths: 1,
            assists: 4,
          },
        },
        teams: { create: { teamId: 100, win: true } },
      },
    });

    const before = await profile.getMatches(created.player.id, {
      limit: 20,
      includeRemakes: true,
    });
    expect(before.items.some((m) => m.externalMatchId === storedExternalId)).toBe(true);
    expect(before.items.some((m) => m.queueId === 450)).toBe(true);

    const matchIdsSpy = vi.spyOn(mockProvider, 'getRecentMatchIds');
    matchIdsSpy.mockResolvedValueOnce(['NA1_NEW_A', 'NA1_NEW_B', storedExternalId]);

    const status = await refreshService.refresh(
      created.player.id,
      { matchCount: 5 },
      'corr-keep-refresh',
    );

    expect(status.state).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(status, 'matches')).toBe(false);

    const immediately = await profile.getMatches(created.player.id, {
      limit: 20,
      includeRemakes: true,
    });
    expect(immediately.items.some((m) => m.externalMatchId === storedExternalId)).toBe(true);

    const cachedProfile = await profile.getProfile(created.player.id);
    expect(cachedProfile.matches.some((m) => m.externalMatchId === storedExternalId)).toBe(true);

    // Simulate worker completing one newly discovered match.
    await prisma.match.create({
      data: {
        provider: 'RIOT',
        externalMatchId: 'NA1_NEW_A',
        regionalRoute: 'americas',
        queueId: 420,
        gameCreation: new Date('2024-06-02T12:00:00.000Z'),
        gameDurationSeconds: 1500,
        gameVersion: '14.1.1',
        ingestionStatus: 'COMPLETED',
        normalizationVersion: '1',
        participants: {
          create: {
            participantId: 1,
            externalAccountId: account.externalAccountId,
            playerAccountId: account.id,
            championId: 61,
            championName: 'Orianna',
            teamId: 100,
            teamPosition: 'MIDDLE',
            individualPosition: 'MIDDLE',
            win: false,
            kills: 2,
            deaths: 3,
            assists: 8,
          },
        },
        teams: { create: { teamId: 100, win: false } },
      },
    });

    const afterIngest = await profile.getMatches(created.player.id, {
      limit: 20,
      includeRemakes: true,
    });
    expect(afterIngest.items.some((m) => m.externalMatchId === storedExternalId)).toBe(true);
    expect(afterIngest.items.some((m) => m.externalMatchId === 'NA1_NEW_A')).toBe(true);
    expect(afterIngest.items.map((m) => m.queueId)).toEqual(expect.arrayContaining([420, 450]));

    matchIdsSpy.mockRestore();
  });

  it('omits Riot queue filter for general search and refresh by default', async () => {
    const matchIdsSpy = vi.spyOn(mockProvider, 'getRecentMatchIds');

    const created = await search.search(
      { gameName: 'AllQueues', tagLine: 'NA1', platform: 'na1', matchCount: 3 },
      'corr-all-q',
    );
    expect(matchIdsSpy).toHaveBeenCalled();
    const searchOptions = matchIdsSpy.mock.calls.at(-1)?.[1] as { queue?: number; count?: number };
    expect(searchOptions.queue).toBeUndefined();
    expect(searchOptions.count).toBe(3);

    matchIdsSpy.mockClear();
    await refreshService.refresh(created.player.id, { matchCount: 3 }, 'corr-all-refresh');
    const refreshOptions = matchIdsSpy.mock.calls.at(-1)?.[1] as { queue?: number };
    expect(refreshOptions.queue).toBeUndefined();

    matchIdsSpy.mockClear();
    await refreshService.refresh(
      created.player.id,
      { matchCount: 3, queueId: 420 },
      'corr-ranked-refresh',
    );
    const rankedOptions = matchIdsSpy.mock.calls.at(-1)?.[1] as { queue?: number };
    expect(rankedOptions.queue).toBe(420);

    matchIdsSpy.mockRestore();
  });
  it('leaves durable PENDING when queue publication fails', async () => {
    producerMock.enqueueMatch.mockImplementationOnce(
      async (payload: { externalMatchId: string }) => ({
        externalMatchId: payload.externalMatchId,
        jobId: `ingest_${payload.externalMatchId}`,
        published: false,
        alreadyExists: false,
        warning: {
          code: 'QUEUE_UNAVAILABLE',
          message: 'Queue publication failed',
        },
      }),
    );

    const result = await search.search(
      { gameName: 'QueueFail', tagLine: 'NA1', platform: 'na1', matchCount: 2 },
      'corr-qf',
    );

    expect(result.player.id).toBeTruthy();
    expect(result.refresh.warnings.some((w) => w.code === 'QUEUE_UNAVAILABLE')).toBe(true);

    const pending = await jobs.findPending(MATCH_INGESTION_JOB_NAME, 50);
    expect(pending.length).toBeGreaterThan(0);
  });
});
