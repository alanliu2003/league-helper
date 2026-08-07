import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedPlayer } from '@prisma/client';
import { CollectorEnrollmentService } from './collector-enrollment.service';
import type { CollectorConfig } from './collector.config';
import type { TrackedPlayerRepository } from './tracked-player.repository';

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
    priority: 0,
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

describe('CollectorEnrollmentService', () => {
  let repo: {
    findByPlayerAccountId: ReturnType<typeof vi.fn>;
    upsertEnrollment: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  };
  let service: CollectorEnrollmentService;

  beforeEach(() => {
    repo = {
      findByPlayerAccountId: vi.fn(),
      upsertEnrollment: vi.fn(),
      setStatus: vi.fn(),
    };
    service = CollectorEnrollmentService.create(
      repo as unknown as TrackedPlayerRepository,
      baseConfig(),
    );
  });

  it('creates first enrollment as ACTIVE with clamped priority', async () => {
    repo.findByPlayerAccountId.mockResolvedValue(null);
    repo.upsertEnrollment.mockResolvedValue({
      trackedPlayer: tracked({ priority: 1000 }),
      created: true,
      reactivated: false,
    });

    const result = await service.enroll({
      account: { id: 'acc-1', provider: 'RIOT', platformRoute: 'na1' },
      source: 'ADMIN_SEED',
      priority: 5000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(repo.upsertEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        playerAccountId: 'acc-1',
        enrollmentSource: 'ADMIN_SEED',
        priority: 1000,
        reactivate: false,
        platformRoute: 'na1',
      }),
    );
  });

  it('preserves enrollmentSource and repairs routes on idempotent re-enroll', async () => {
    repo.findByPlayerAccountId.mockResolvedValue(
      tracked({
        enrollmentSource: 'ADMIN_SEED',
        provider: 'OLD',
        platformRoute: 'euw1',
        priority: 7,
      }),
    );
    repo.upsertEnrollment.mockResolvedValue({
      trackedPlayer: tracked({
        enrollmentSource: 'ADMIN_SEED',
        provider: 'RIOT',
        platformRoute: 'na1',
        priority: 7,
      }),
      created: false,
      reactivated: false,
    });

    const result = await service.enroll({
      account: { id: 'acc-1', provider: 'RIOT', platformRoute: 'NA1' },
      source: 'PRODUCT_SEARCH',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enrollmentSource).toBe('ADMIN_SEED');
    expect(result.created).toBe(false);
    expect(repo.upsertEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentSource: 'ADMIN_SEED', // first source preserved on re-enroll
        provider: 'RIOT',
        platformRoute: 'na1',
        priority: 7,
        reactivate: false,
      }),
    );
  });

  it('does not silently reactivate PAUSED without reactivate flag', async () => {
    repo.findByPlayerAccountId.mockResolvedValue(tracked({ status: 'PAUSED' }));
    repo.upsertEnrollment.mockResolvedValue({
      trackedPlayer: tracked({ status: 'PAUSED' }),
      created: false,
      reactivated: false,
    });

    const result = await service.enroll({
      account: { id: 'acc-1', provider: 'RIOT', platformRoute: 'na1' },
      source: 'ADMIN_SEED',
    });

    expect(result.ok).toBe(true);
    expect(repo.upsertEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ reactivate: false }),
    );
    if (!result.ok) return;
    expect(result.reactivated).toBe(false);
    expect(result.status).toBe('PAUSED');
  });

  it('reactivates SUSPENDED when reactivate=true', async () => {
    repo.findByPlayerAccountId.mockResolvedValue(tracked({ status: 'SUSPENDED' }));
    repo.upsertEnrollment.mockResolvedValue({
      trackedPlayer: tracked({ status: 'ACTIVE' }),
      created: false,
      reactivated: true,
    });

    const result = await service.enroll({
      account: { id: 'acc-1', provider: 'RIOT', platformRoute: 'na1' },
      source: 'ADMIN_SEED',
      reactivate: true,
    });

    expect(result.ok).toBe(true);
    expect(repo.upsertEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ reactivate: true }),
    );
    if (!result.ok) return;
    expect(result.reactivated).toBe(true);
  });

  it('returns UNSUPPORTED_PLATFORM for platforms outside allowlist', async () => {
    const result = await service.enroll({
      account: { id: 'acc-1', provider: 'RIOT', platformRoute: 'euw1' },
      source: 'ADMIN_SEED',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'UNSUPPORTED_PLATFORM',
        playerAccountId: 'acc-1',
      }),
    );
    expect(repo.upsertEnrollment).not.toHaveBeenCalled();
  });

  it('returns UNSUPPORTED_PLATFORM for invalid platform route strings', async () => {
    const result = await service.enroll({
      account: { id: 'acc-1', provider: 'RIOT', platformRoute: 'not-a-platform' },
      source: 'ADMIN_SEED',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'UNSUPPORTED_PLATFORM',
      }),
    );
    expect(repo.findByPlayerAccountId).not.toHaveBeenCalled();
  });

  it('setPlayerStatus ACTIVE with force + reset-failures', async () => {
    repo.setStatus.mockResolvedValue(
      tracked({
        status: 'ACTIVE',
        leaseOwner: null,
        leaseExpiresAt: null,
        consecutiveFailureCount: 0,
        lastFailureCode: null,
      }),
    );

    const result = await service.setPlayerStatus({
      trackedPlayerId: 'tp-1',
      status: 'ACTIVE',
      force: true,
      resetFailures: true,
    });

    expect(result.ok).toBe(true);
    expect(repo.setStatus).toHaveBeenCalledWith({
      trackedPlayerId: 'tp-1',
      status: 'ACTIVE',
      force: true,
      resetFailures: true,
    });
    if (!result.ok) return;
    expect(result.leaseCleared).toBe(true);
    expect(result.failuresReset).toBe(true);
  });

  it('setPlayerStatus returns not-found for missing tracked player', async () => {
    repo.setStatus.mockResolvedValue(null);

    const result = await service.setPlayerStatus({
      trackedPlayerId: 'missing',
      status: 'PAUSED',
    });

    expect(result).toEqual({
      ok: false,
      code: 'TRACKED_PLAYER_NOT_FOUND',
      message: 'Tracked player not found: missing',
      trackedPlayerId: 'missing',
    });
  });

  it('setPlayerStatus PAUSED without force preserves lease (repo force=false)', async () => {
    repo.setStatus.mockResolvedValue(tracked({ status: 'PAUSED', leaseOwner: 'owner-x' }));

    const result = await service.setPlayerStatus({
      trackedPlayerId: 'tp-1',
      status: 'PAUSED',
    });

    expect(result.ok).toBe(true);
    expect(repo.setStatus).toHaveBeenCalledWith({
      trackedPlayerId: 'tp-1',
      status: 'PAUSED',
      force: false,
      resetFailures: false,
    });
  });
});
