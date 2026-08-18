import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '@prisma/client';
import type { PlayerAccount as ProviderAccount } from '@league-helper/shared';
import type { PlayerRefreshConfig } from '../../config/player-refresh.config';
import type { CollectorConfig } from '../collector/collector.config';
import type { CollectorEnrollmentService } from '../collector/collector-enrollment.service';
import { PlayerSearchService } from './player-search.service';

const refreshConfig: PlayerRefreshConfig = {
  cooldownSeconds: 0,
  profileCacheTtlSeconds: 60,
  masteryLimit: 10,
  masterySnapshotMinAgeSeconds: 3600,
  defaultMatchCount: 5,
  maxMatchCount: 20,
  defaultMatchQueueId: 420,
  rankedSoloQueueId: 420,
  matchIngestionQueueName: 'test-match-ingestion',
  matchIngestionJobAttempts: 5,
  matchIngestionReconcileBatchSize: 50,
  matchTimelineQueueName: 'test-match-timeline',
  matchTimelineJobAttempts: 5,
  matchTimelineSearchBackfillEnabled: false,
  refreshLockTtlSeconds: 30,
  redisUrl: 'redis://localhost:6379',
};

const providerAccount: ProviderAccount = {
  provider: 'RIOT',
  externalAccountId: 'puuid-secret',
  platform: 'na1',
  regionalRoute: 'americas',
  riotId: { gameName: 'Searcher', tagLine: 'NA1' },
};

function makeDbAccount(overrides: Partial<PlayerAccount> = {}): PlayerAccount {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    playerId: '00000000-0000-4000-8000-0000000000b1',
    provider: 'RIOT',
    externalAccountId: 'puuid-secret',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    currentGameName: 'Searcher',
    currentTagLine: 'NA1',
    normalizedGameName: 'searcher',
    normalizedTagLine: 'na1',
    summonerId: null,
    accountId: null,
    profileIconId: null,
    summonerLevel: null,
    lastResolvedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function baseCollectorConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    batchSize: 10,
    concurrency: 2,
    matchesPerPlayer: 20,
    maxMatchIdsPerRun: 200,
    maxEnqueuePerRun: 200,
    minRefreshIntervalMs: 6 * 60 * 60_000,
    baseBackoffMs: 15 * 60_000,
    maxBackoffMs: 24 * 60 * 60_000,
    maxBackoffExponent: 8,
    playerTimeoutMs: 10 * 60_000,
    leaseDurationMs: 15 * 60_000,
    staleRunAfterMs: 2 * 60 * 60_000,
    platformAllowlist: ['na1'],
    estimatedRequestsPerEnqueuedMatch: 2,
    priorityMin: 0,
    priorityMax: 1000,
    enrollFromBootstrap: false,
    enrollFromSearch: false,
    hotRefreshIntervalMs: 1 * 60 * 60_000,
    warmRefreshIntervalMs: 6 * 60 * 60_000,
    coldRefreshIntervalMs: 48 * 60 * 60_000,
    coldAfterZeroNewRuns: 3,
    hotPriority: 100,
    warmPriority: 50,
    coldPriority: 10,
    maxConsecutiveZeroNewMatchRuns: 100,
    ladderInitialPriority: 50,
    productRootInitialPriority: 100,
    schedulerEnabled: false,
    scheduleIntervalMs: 15 * 60_000,
    scheduleBatchSize: 10,
    scheduleConcurrency: 2,
    scheduleMaxMatchesPerPlayer: 20,
    scheduleMaxMatchIds: 200,
    scheduleMaxEnqueue: 200,
    schedulerLeaseSafetyMarginMs: 5 * 60_000,
    schedulerLeaseMs: 60 * 60_000,
    schedulerRateLimitCooldownMs: 15 * 60_000,
    riotShared429CooldownMinMs: 15 * 60_000,
    maxPendingIngestionJobs: 500,
    scheduleQueueId: 420,
    schedulePlatform: null,
    expandFromParticipants: false,
    expansionMaxDepth: 1,
    expansionMaxNewPlayersPerMatch: 3,
    expansionMaxNewPlayersPerSourcePlayer: 5,
    expansionMaxNewPlayersPerRun: 20,
    expansionMaxTrackedPlayers: 500,
    expansionQueueId: 420,
    totalTrackedPlayersHardCap: 5000,
    ladderMaxTotal: 3000,
    ladderMaxNewPerRun: 100,
    ladderQueueType: 'RANKED_SOLO_5x5',
    ladderTiers: ['CHALLENGER', 'GRANDMASTER'],
    ladderRepresentativeTiers: ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD'],
    ladderMaxPagesPerTierDivision: 1,
    ladderMaxCandidatesScanned: 500,
    ladderPlatform: null,
    ...overrides,
  };
}

function createSearchService(input: {
  collectorConfig?: CollectorConfig;
  enroll?: ReturnType<typeof vi.fn>;
}) {
  const gameData = {
    resolvePlayer: vi.fn(async () => providerAccount),
    getRankedEntries: vi.fn(async () => []),
    getChampionMastery: vi.fn(async () => []),
    // Empty discovery keeps enqueue path out of these enrollment-focused tests.
    getRecentMatchIds: vi.fn(async () => []),
  };
  const playerAccounts = {
    upsertPlayerAccount: vi.fn(async () => makeDbAccount()),
  };
  const rankSnapshots = {
    insertIfChanged: vi.fn(async () => null),
    getLatestForPlayer: vi.fn(async () => []),
  };
  const masterySnapshots = {
    insertIfChanged: vi.fn(async () => null),
    getTopCurrentMasteryForPlayer: vi.fn(async () => []),
  };
  const matches = {
    listForPlayerAccount: vi.fn(async () => []),
    linkParticipantsByExternalAccountId: vi.fn(async () => 0),
    findExistingByExternalIds: vi.fn(async () => []),
    findLinkedCompletedExternalIds: vi.fn(async () => []),
    findExistingExternalIdsMissingLink: vi.fn(async () => []),
  };
  const ingestionJobs = {
    findByExternalResourceIds: vi.fn(async () => []),
    createIdempotent: vi.fn(async () => ({ id: 'job', created: true })),
    updateStatus: vi.fn(async () => undefined),
  };
  const producer = {
    enqueueMatch: vi.fn(async () => ({
      externalMatchId: 'm-1',
      jobId: 'job',
      published: true,
      alreadyExists: false,
    })),
    getJobStates: vi.fn(async () => new Map([['job', 'waiting']])),
  };
  const refreshStatus = {
    recordDiscoveredMatches: vi.fn(async () => undefined),
    compute: vi.fn(async () => ({
      state: 'PROCESSING',
      requestedMatchCount: 5,
      discoveredMatchCount: 1,
      knownMatchCount: 0,
      queuedMatchCount: 1,
      activeMatchCount: 0,
      delayedMatchCount: 0,
      completedMatchCount: 0,
      failedMatchCount: 0,
      lastResolvedAt: null,
      lastRefreshStartedAt: null,
      lastRefreshCompletedAt: null,
      lastRefreshedAt: null,
      isStale: false,
      warnings: [],
    })),
  };
  const cache = {
    setProfile: vi.fn(async () => undefined),
    invalidate: vi.fn(async () => undefined),
  };
  const dataDragon = {
    getCurrentVersion: vi.fn(async () => '14.15.1'),
    buildProfileIconUrl: vi.fn(() => null),
    getAllChampions: vi.fn(async () => []),
    getBaseUrl: vi.fn(() => 'https://ddragon.leagueoflegends.com'),
  };

  const enroll =
    input.enroll ??
    vi.fn(async () => ({
      ok: true,
      trackedPlayerId: 'tp-1',
      playerAccountId: '00000000-0000-4000-8000-0000000000a1',
      status: 'ACTIVE' as const,
      enrollmentSource: 'PRODUCT_SEARCH' as const, // first-source preserved by enrollment service
      created: true,
      reactivated: false,
      platformRoute: 'na1',
    }));

  const enrollment = input.collectorConfig
    ? ({ enroll } as unknown as CollectorEnrollmentService)
    : undefined;

  const service = new PlayerSearchService(
    gameData as never,
    refreshConfig,
    playerAccounts as never,
    rankSnapshots as never,
    masterySnapshots as never,
    matches as never,
    ingestionJobs as never,
    producer as never,
    { enqueueEnrichment: vi.fn() } as never,
    refreshStatus as never,
    cache as never,
    dataDragon as never,
    input.collectorConfig,
    enrollment,
  );

  return { service, enroll, gameData, playerAccounts };
}

describe('PlayerSearchService collector enrollment hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call enroll when COLLECTOR_ENROLL_FROM_SEARCH is false', async () => {
    const { service, enroll } = createSearchService({
      collectorConfig: baseCollectorConfig({ enrollFromSearch: false }),
    });

    await service.search({ gameName: 'Searcher', tagLine: 'NA1', platform: 'na1' }, 'corr-1');

    expect(enroll).not.toHaveBeenCalled();
  });

  it('does not call enroll when collector deps are omitted', async () => {
    const enroll = vi.fn();
    const { service } = createSearchService({});

    await service.search({ gameName: 'Searcher', tagLine: 'NA1', platform: 'na1' }, 'corr-2');

    expect(enroll).not.toHaveBeenCalled();
  });

  it('enrolls with PRODUCT_SEARCH when flag is true', async () => {
    const { service, enroll } = createSearchService({
      collectorConfig: baseCollectorConfig({ enrollFromSearch: true }),
    });

    await service.search({ gameName: 'Searcher', tagLine: 'NA1', platform: 'na1' }, 'corr-3');

    expect(enroll).toHaveBeenCalledWith({
      account: {
        id: '00000000-0000-4000-8000-0000000000a1',
        provider: 'RIOT',
        platformRoute: 'na1',
      },
      source: 'PRODUCT_SEARCH',
    });
  });

  it('keeps search success when enrollment throws', async () => {
    const enroll = vi.fn(async () => {
      throw new Error('tracked player write failed');
    });
    const { service } = createSearchService({
      collectorConfig: baseCollectorConfig({ enrollFromSearch: true }),
      enroll,
    });

    const response = await service.search(
      { gameName: 'Searcher', tagLine: 'NA1', platform: 'na1' },
      'corr-4',
    );

    expect(response.player.riotId.gameName).toBe('Searcher');
    expect(enroll).toHaveBeenCalled();
  });

  it('keeps search success when platform is unsupported', async () => {
    const enroll = vi.fn(async () => ({
      ok: false as const,
      playerAccountId: '00000000-0000-4000-8000-0000000000a1',
      code: 'UNSUPPORTED_PLATFORM' as const,
      message: 'unsupported',
      platformRoute: 'kr',
    }));
    const { service } = createSearchService({
      collectorConfig: baseCollectorConfig({
        enrollFromSearch: true,
        platformAllowlist: ['na1'],
      }),
      enroll,
    });

    const response = await service.search(
      { gameName: 'Searcher', tagLine: 'NA1', platform: 'na1' },
      'corr-5',
    );

    expect(response.player.platform).toBe('na1');
    expect(enroll).toHaveBeenCalled();
  });

  it('does not enroll when resolve fails before upsert', async () => {
    const { service, enroll, gameData, playerAccounts } = createSearchService({
      collectorConfig: baseCollectorConfig({ enrollFromSearch: true }),
    });
    gameData.resolvePlayer.mockRejectedValueOnce(new Error('not found'));

    await expect(
      service.search({ gameName: 'Missing', tagLine: 'NA1', platform: 'na1' }, 'corr-6'),
    ).rejects.toThrow(/not found/i);

    expect(playerAccounts.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(enroll).not.toHaveBeenCalled();
  });
});
