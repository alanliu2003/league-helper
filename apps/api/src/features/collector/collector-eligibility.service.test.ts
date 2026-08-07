import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedPlayer } from '@prisma/client';
import { CollectorEligibilityService } from './collector-eligibility.service';
import type { CollectorConfig } from './collector.config';
import type { TrackedPlayerRepository } from './tracked-player.repository';
import type { PlayerAccountRepository } from '../../persistence/player-account.repository';

function baseConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
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
    ...overrides,
  };
}

function tracked(overrides: Partial<TrackedPlayer> = {}): TrackedPlayer {
  return {
    id: 'tp-1',
    playerAccountId: 'acc-1',
    provider: 'RIOT',
    platformRoute: 'na1',
    enrollmentSource: 'ADMIN_SEED',
    status: 'ACTIVE',
    priority: 10,
    nextEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSuccessfulRefreshAt: null,
    lastClaimedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    consecutiveFailureCount: 0,
    lastFailureCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as TrackedPlayer;
}

describe('CollectorEligibilityService.preview', () => {
  let trackedPlayers: {
    countEligible: ReturnType<typeof vi.fn>;
    listEligiblePreview: ReturnType<typeof vi.fn>;
    claimEligibleWave: ReturnType<typeof vi.fn>;
    upsertEnrollment: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    finalizeSuccess: ReturnType<typeof vi.fn>;
    finalizeFailure: ReturnType<typeof vi.fn>;
    releaseOwnedLease: ReturnType<typeof vi.fn>;
  };
  let playerAccounts: {
    findById: ReturnType<typeof vi.fn>;
    upsertPlayerAccount: ReturnType<typeof vi.fn>;
  };
  let gameData: {
    getRecentMatchIds: ReturnType<typeof vi.fn>;
    resolvePlayer: ReturnType<typeof vi.fn>;
    getRankedEntries: ReturnType<typeof vi.fn>;
  };
  let service: CollectorEligibilityService;

  beforeEach(() => {
    trackedPlayers = {
      countEligible: vi.fn().mockResolvedValue(2),
      listEligiblePreview: vi.fn().mockResolvedValue([
        tracked({
          id: 'tp-high',
          priority: 20,
          nextEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        tracked({
          id: 'tp-low',
          playerAccountId: 'acc-2',
          priority: 1,
          nextEligibleAt: new Date('2026-01-02T00:00:00.000Z'),
          lastSuccessfulRefreshAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ]),
      claimEligibleWave: vi.fn(),
      upsertEnrollment: vi.fn(),
      setStatus: vi.fn(),
      finalizeSuccess: vi.fn(),
      finalizeFailure: vi.fn(),
      releaseOwnedLease: vi.fn(),
    };
    playerAccounts = {
      findById: vi.fn(),
      upsertPlayerAccount: vi.fn(),
    };
    gameData = {
      getRecentMatchIds: vi.fn().mockResolvedValue(['m1', 'm2']),
      resolvePlayer: vi.fn(),
      getRankedEntries: vi.fn(),
    };
    service = CollectorEligibilityService.create({
      trackedPlayers: trackedPlayers as unknown as TrackedPlayerRepository,
      playerAccounts: playerAccounts as unknown as PlayerAccountRepository,
      gameData,
      config: baseConfig(),
    });
  });

  it('returns eligible count + deterministic candidates without Riot or mutations', async () => {
    const preview = await service.preview({ queueId: 420 });

    expect(preview.eligibleCount).toBe(2);
    expect(preview.candidates.map((c) => c.trackedPlayerId)).toEqual(['tp-high', 'tp-low']);
    expect(preview.sampleDiscovery).toBeUndefined();
    expect(gameData.getRecentMatchIds).not.toHaveBeenCalled();
    expect(gameData.resolvePlayer).not.toHaveBeenCalled();
    expect(gameData.getRankedEntries).not.toHaveBeenCalled();
    expect(playerAccounts.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(trackedPlayers.claimEligibleWave).not.toHaveBeenCalled();
    expect(trackedPlayers.upsertEnrollment).not.toHaveBeenCalled();
    expect(trackedPlayers.setStatus).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeSuccess).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeFailure).not.toHaveBeenCalled();
    expect(trackedPlayers.releaseOwnedLease).not.toHaveBeenCalled();
  });

  it('sample-discovery uses only getRecentMatchIds pagination path', async () => {
    playerAccounts.findById.mockResolvedValue({
      id: 'acc-1',
      provider: 'RIOT',
      externalAccountId: 'puuid-hidden',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      currentGameName: 'A',
      currentTagLine: 'NA1',
      summonerId: null,
      accountId: null,
      profileIconId: null,
      summonerLevel: null,
    });

    const preview = await service.preview({
      queueId: 420,
      sampleDiscovery: 1,
      maxMatches: 5,
    });

    expect(preview.sampleDiscovery).toEqual([
      {
        trackedPlayerId: 'tp-high',
        playerAccountId: 'acc-1',
        platformRoute: 'na1',
        discoveredMatchCount: 2,
        wouldEnqueueCount: 2,
      },
    ]);
    expect(gameData.getRecentMatchIds).toHaveBeenCalledTimes(1);
    expect(gameData.getRecentMatchIds).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'na1',
        regionalRoute: 'americas',
      }),
      expect.objectContaining({ queue: 420, start: 0, count: 5 }),
    );
    expect(gameData.resolvePlayer).not.toHaveBeenCalled();
    expect(gameData.getRankedEntries).not.toHaveBeenCalled();
    expect(playerAccounts.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(trackedPlayers.claimEligibleWave).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeSuccess).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeFailure).not.toHaveBeenCalled();
    expect(trackedPlayers.releaseOwnedLease).not.toHaveBeenCalled();
  });

  it('uses same eligibility query inputs as claim (platforms + provider)', async () => {
    await service.preview({ queueId: 420, platformFilter: 'na1', candidateLimit: 3 });

    expect(trackedPlayers.listEligiblePreview).toHaveBeenCalledWith({
      platformRoutes: ['na1'],
      provider: 'RIOT',
      limit: 3,
    });
    expect(trackedPlayers.countEligible).toHaveBeenCalledWith({
      platformRoutes: ['na1'],
      provider: 'RIOT',
    });
  });
});
