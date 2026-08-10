import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
  RIOT_SHARED_429_COOLDOWN_REDIS_KEY,
  RiotSharedCooldownStore,
} from '@league-helper/server-riot';
import { ProviderRateLimitedError } from '@league-helper/shared';
import { loadCollectorConfig } from './collector.config';
import { LadderSeedService, type LadderSeedProvider } from './ladder/ladder-seed.service';
import type { LadderEnrollmentService } from './ladder/ladder-enrollment.service';
import {
  PopulationCollectorService,
} from './population-collector.service';
import type { CollectorRunRepository } from './collector-run.repository';
import type { TrackedPlayerRepository } from './tracked-player.repository';
import type { CollectorEligibilityService } from './collector-eligibility.service';
import type { PlayerMatchDiscoveryService } from '../players/discovery/player-match-discovery.service';
import type { PlayerAccountRepository } from '../../persistence/player-account.repository';
import { CollectorRunStatus, type CollectorRun, type TrackedPlayer } from '@prisma/client';

const redisUrl = (process.env.REDIS_URL ?? 'redis://localhost:6379').trim();
const testKey = `${RIOT_SHARED_429_COOLDOWN_REDIS_KEY}:consumers:${process.pid}:${Date.now()}`;

type IoredisClient = {
  get(key: string): Promise<string | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<'OK'>;
  ping(): Promise<string>;
};

function accountUuid(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(16).padStart(12, '0').slice(-12);
  return `11111111-1111-4111-8111-${suffix}`;
}

function tracked(id: string): TrackedPlayer {
  return {
    id,
    playerAccountId: accountUuid(id),
    provider: 'RIOT',
    platformRoute: 'na1',
    enrollmentSource: 'ADMIN_SEED',
    discoveryDepth: 0,
    status: 'ACTIVE',
    priority: 0,
    nextEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSuccessfulRefreshAt: null,
    lastClaimedAt: null,
    leaseOwner: 'owner',
    leaseExpiresAt: new Date('2026-01-01T01:00:00.000Z'),
    consecutiveFailureCount: 0,
    consecutiveZeroNewMatchRuns: 0,
    lastFailureCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as TrackedPlayer;
}

function runRow(overrides: Partial<CollectorRun> = {}): CollectorRun {
  return {
    id: 'run-1',
    ownerToken: 'token-1',
    status: CollectorRunStatus.RUNNING,
    startedAt: new Date(),
    finishedAt: null,
    platformFilter: null,
    effectivePlatforms: ['na1'],
    queueId: 420,
    batchLimit: 10,
    concurrency: 2,
    playersClaimed: 0,
    playersAttempted: 0,
    playersSucceeded: 0,
    playersFailed: 0,
    ownershipLost: 0,
    matchIdsDiscovered: 0,
    matchesEnqueued: 0,
    matchesSkippedComplete: 0,
    rateLimitStops: 0,
    budgetExhausted: false,
    failureCode: null,
    participantsConsidered: 0,
    playersEnrolledFromParticipants: 0,
    playersAlreadyTrackedFromParticipants: 0,
    playersSkippedDepthLimit: 0,
    playersSkippedPopulationCap: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CollectorRun;
}

describe('Riot shared cooldown consumers (redis integration)', () => {
  let redis: IoredisClient | null = null;
  let publisher: RiotSharedCooldownStore | null = null;
  let reader: RiotSharedCooldownStore | null = null;

  beforeAll(async () => {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
      enableOfflineQueue: false,
    });
    await client.connect();
    await client.ping();
    redis = client as unknown as IoredisClient;
    publisher = new RiotSharedCooldownStore(redis, { redisKey: testKey });
    reader = new RiotSharedCooldownStore(redis, { redisKey: testKey });
  });

  beforeEach(async () => {
    if (!redis) {
      throw new Error('Redis client was not initialized');
    }
    await redis.del(testKey);
  });

  afterAll(async () => {
    if (redis) {
      await redis.del(testKey);
      await redis.quit();
    }
  });

  it('ladder 429 publish is visible to a separate store and gates collector claims', async () => {
    if (!publisher || !reader) {
      throw new Error('Redis integration stores unavailable');
    }

    const getChallengerLeague = vi.fn().mockRejectedValue(
      new ProviderRateLimitedError('ladder limited', { retryAfterSeconds: 60 }),
    );
    const provider: LadderSeedProvider = {
      getChallengerLeague,
      getGrandmasterLeague: vi.fn(),
      getMasterLeague: vi.fn(),
      getLeagueEntriesByTierDivision: vi.fn(),
    };

    const ladder = LadderSeedService.create({
      prisma: {
        trackedPlayer: { findUnique: vi.fn() },
      } as never,
      playerAccounts: {
        findByProviderExternalId: vi.fn().mockResolvedValue(null),
      } as never,
      enrollment: {
        enrollLadderCandidate: vi.fn(),
      } as unknown as LadderEnrollmentService,
      config: {
        ...loadCollectorConfig({}),
        riotShared429CooldownMinMs: DEFAULT_RIOT_SHARED_429_COOLDOWN_MIN_MS,
        platformAllowlist: ['na1'],
      },
      gameData: provider,
      sharedCooldown: publisher,
    });

    const ladderResult = await ladder.seed({
      platform: 'na1',
      mode: 'apex',
      tiers: ['CHALLENGER'],
      dryRun: true,
    });
    expect(ladderResult.stoppedReason).toBe('rate_limited');
    expect(await reader.isCoolingDown(Date.now())).toBe(true);

    const claimEligibleWave = vi.fn().mockResolvedValue([tracked('tp-gate')]);
    const collector = PopulationCollectorService.create({
      trackedPlayers: {
        claimEligibleWave,
        countEligible: vi.fn().mockResolvedValue(0),
        finalizeSuccess: vi.fn(),
        finalizeFailure: vi.fn(),
        releaseOwnedLease: vi.fn().mockResolvedValue({ updated: true }),
        countOwnedUnreleasedLeases: vi.fn().mockResolvedValue(0),
        forceReleaseOwnedLeases: vi.fn().mockResolvedValue(0),
      } as unknown as TrackedPlayerRepository,
      runs: {
        createRunning: vi.fn().mockImplementation(async (input) =>
          runRow({ ownerToken: input.ownerToken, effectivePlatforms: input.effectivePlatforms }),
        ),
        finalizeIfRunning: vi.fn().mockImplementation(async (input) =>
          runRow({
            id: input.id,
            ownerToken: input.ownerToken,
            status: input.status,
            finishedAt: new Date(),
            ...input.counters,
          }),
        ),
      } as unknown as CollectorRunRepository,
      discovery: {
        discoverAndEnqueue: vi.fn(),
      } as unknown as PlayerMatchDiscoveryService,
      eligibility: {
        preview: vi.fn(),
      } as unknown as CollectorEligibilityService,
      playerAccounts: {
        findById: vi.fn(),
      } as unknown as PlayerAccountRepository,
      config: loadCollectorConfig({}),
      sharedCooldown: reader,
    });

    const collectorResult = await collector.runOnce({
      queueId: 420,
      batchLimit: 10,
      concurrency: 1,
      matchesPerPlayer: 20,
      maxMatchIdsPerRun: 200,
      maxEnqueuePerRun: 200,
    });

    expect(collectorResult.counters.playersClaimed).toBe(0);
    expect(collectorResult.counters.rateLimitStops).toBe(0);
    expect(claimEligibleWave).not.toHaveBeenCalled();
    expect(getChallengerLeague).toHaveBeenCalledTimes(1);
  });
});
