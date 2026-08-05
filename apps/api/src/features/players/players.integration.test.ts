import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { IngestionJobStatus } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  ProviderRateLimitedError,
  ResourceNotFoundError,
} from '@league-helper/shared';
import { loadPlayerRefreshConfig, PLAYER_REFRESH_CONFIG } from '../../config/player-refresh.config';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import { MockRiotGameDataProvider } from '../../integrations/riot/mock-riot-game-data.provider';
import { IngestionJobRepository } from '../../persistence/ingestion-job.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import { MATCH_INGESTION_QUEUE, REDIS_CONNECTION } from '../../queues/queue.tokens';
import { PlayerProfileService } from './player-profile.service';
import { PlayerSearchService } from './player-search.service';
import { PlayersModule } from './players.module';

describe('players search integration', () => {
  let prisma: PrismaService;
  let search: PlayerSearchService;
  let profile: PlayerProfileService;
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
      .overrideProvider(MatchIngestionProducer)
      .useValue(producerMock)
      .overrideProvider(GAME_DATA_PROVIDER)
      .useClass(MockRiotGameDataProvider)
      .compile();

    prisma = moduleRef.get(PrismaService);
    search = moduleRef.get(PlayerSearchService);
    profile = moduleRef.get(PlayerProfileService);
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

  it('stores ranks and mastery and enqueues missing matches', async () => {
    const result = await search.search(
      { gameName: 'QueueTest', tagLine: 'NA1', platform: 'na1', matchCount: 5 },
      'corr-q',
    );

    expect(result.ranks.length).toBeGreaterThan(0);
    expect(result.mastery.length).toBeGreaterThan(0);
    expect(result.refresh.queuedMatchCount).toBeGreaterThan(0);
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
