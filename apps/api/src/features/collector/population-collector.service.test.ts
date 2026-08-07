import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorRunStatus, type CollectorRun, type TrackedPlayer } from '@prisma/client';
import type { CollectorConfig } from './collector.config';
import {
  CollectorRunError,
  PopulationCollectorService,
  preallocateWaveBudgets,
} from './population-collector.service';
import type { CollectorRunRepository } from './collector-run.repository';
import type { TrackedPlayerRepository } from './tracked-player.repository';
import type { CollectorEligibilityService } from './collector-eligibility.service';
import type { PlayerMatchDiscoveryService } from '../players/discovery/player-match-discovery.service';
import type { PlayerMatchDiscoveryResult } from '../players/discovery/player-match-discovery.types';
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
    playerTimeoutMs: 5_000,
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

function accountUuid(label: string): string {
  // Keep a stable, unique 12-hex suffix (labels may exceed 6 bytes).
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(16).padStart(12, '0').slice(-12);
  return `11111111-1111-4111-8111-${suffix}`;
}

function tracked(
  id: string,
  overrides: Partial<TrackedPlayer> & { playerAccountId?: string } = {},
): TrackedPlayer {
  return {
    id,
    playerAccountId: overrides.playerAccountId ?? accountUuid(id),
    provider: 'RIOT',
    platformRoute: 'na1',
    enrollmentSource: 'ADMIN_SEED',
    status: 'ACTIVE',
    priority: 0,
    nextEligibleAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSuccessfulRefreshAt: null,
    lastClaimedAt: null,
    leaseOwner: 'owner',
    leaseExpiresAt: new Date('2026-01-01T01:00:00.000Z'),
    consecutiveFailureCount: 0,
    lastFailureCode: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CollectorRun;
}

function okDiscovery(overrides: Partial<PlayerMatchDiscoveryResult> = {}): PlayerMatchDiscoveryResult {
  return {
    ok: true,
    playerAccountId: accountUuid('acc'),
    discoveredMatchCount: 2,
    enqueuedCount: 2,
    skippedAlreadyCompleteCount: 0,
    externalMatchIds: ['m1', 'm2'],
    warnings: [],
    ...overrides,
  };
}

function matchingAccount(playerAccountId: string) {
  return {
    id: playerAccountId,
    provider: 'RIOT',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    externalAccountId: 'puuid-hidden',
    currentGameName: 'A',
    currentTagLine: 'NA1',
    summonerId: null,
    accountId: null,
    profileIconId: null,
    summonerLevel: null,
  };
}

describe('preallocateWaveBudgets', () => {
  it('gives each claimed player at least 1 then tops up without overshoot', () => {
    const claimed = [tracked('a'), tracked('b'), tracked('c')];
    const assignments = preallocateWaveBudgets({
      claimed,
      matchesPerPlayer: 20,
      remainingMatchBudget: 25,
      remainingEnqueueBudget: 100,
    });
    expect(assignments.map((a) => a.maxMatches)).toEqual([20, 4, 1]);
    expect(assignments.reduce((sum, a) => sum + a.maxMatches, 0)).toBe(25);
  });
});

describe('PopulationCollectorService.runOnce', () => {
  let trackedPlayers: {
    claimEligibleWave: ReturnType<typeof vi.fn>;
    countEligible: ReturnType<typeof vi.fn>;
    finalizeSuccess: ReturnType<typeof vi.fn>;
    finalizeFailure: ReturnType<typeof vi.fn>;
    releaseOwnedLease: ReturnType<typeof vi.fn>;
    countOwnedUnreleasedLeases: ReturnType<typeof vi.fn>;
    forceReleaseOwnedLeases: ReturnType<typeof vi.fn>;
  };
  let runs: {
    createRunning: ReturnType<typeof vi.fn>;
    finalizeIfRunning: ReturnType<typeof vi.fn>;
  };
  let discovery: {
    discoverAndEnqueue: ReturnType<typeof vi.fn>;
  };
  let eligibility: {
    preview: ReturnType<typeof vi.fn>;
  };
  let playerAccounts: {
    findById: ReturnType<typeof vi.fn>;
  };
  let service: PopulationCollectorService;

  const defaultInput = {
    queueId: 420,
    batchLimit: 10,
    concurrency: 2,
    matchesPerPlayer: 20,
    maxMatchIdsPerRun: 200,
    maxEnqueuePerRun: 200,
  };

  beforeEach(() => {
    trackedPlayers = {
      claimEligibleWave: vi.fn().mockResolvedValue([]),
      countEligible: vi.fn().mockResolvedValue(0),
      finalizeSuccess: vi.fn().mockResolvedValue({ updated: true, status: 'ACTIVE' }),
      finalizeFailure: vi.fn().mockResolvedValue({ updated: true, status: 'ACTIVE' }),
      releaseOwnedLease: vi.fn().mockResolvedValue({ updated: true, status: 'ACTIVE' }),
      countOwnedUnreleasedLeases: vi.fn().mockResolvedValue(0),
      forceReleaseOwnedLeases: vi.fn().mockResolvedValue(0),
    };
    runs = {
      createRunning: vi.fn().mockImplementation(async (input) =>
        runRow({
          ownerToken: input.ownerToken,
          effectivePlatforms: input.effectivePlatforms,
          batchLimit: input.batchLimit,
          concurrency: input.concurrency,
          queueId: input.queueId,
        }),
      ),
      finalizeIfRunning: vi.fn().mockImplementation(async (input) =>
        runRow({
          id: input.id,
          ownerToken: input.ownerToken,
          status: input.status,
          finishedAt: new Date(),
          playersClaimed: input.counters.playersClaimed,
          playersAttempted: input.counters.playersAttempted,
          playersSucceeded: input.counters.playersSucceeded,
          playersFailed: input.counters.playersFailed,
          ownershipLost: input.counters.ownershipLost,
          matchIdsDiscovered: input.counters.matchIdsDiscovered,
          matchesEnqueued: input.counters.matchesEnqueued,
          matchesSkippedComplete: input.counters.matchesSkippedComplete,
          rateLimitStops: input.counters.rateLimitStops,
          budgetExhausted: input.counters.budgetExhausted,
          failureCode: input.counters.failureCode ?? null,
        }),
      ),
    };
    discovery = {
      discoverAndEnqueue: vi.fn().mockResolvedValue(okDiscovery()),
    };
    eligibility = {
      preview: vi.fn().mockResolvedValue({
        eligibleCount: 0,
        effectivePlatforms: ['na1'],
        queueId: 420,
        candidates: [],
      }),
    };
    playerAccounts = {
      findById: vi.fn(async (id: string) => matchingAccount(id)),
    };
    service = PopulationCollectorService.create({
      trackedPlayers: trackedPlayers as unknown as TrackedPlayerRepository,
      runs: runs as unknown as CollectorRunRepository,
      discovery: discovery as unknown as PlayerMatchDiscoveryService,
      eligibility: eligibility as unknown as CollectorEligibilityService,
      playerAccounts: playerAccounts as unknown as PlayerAccountRepository,
      config: baseConfig(),
    });
  });

  it('zero eligible → COMPLETED with zero counters', async () => {
    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('COMPLETED');
    expect(result.counters).toMatchObject({
      playersClaimed: 0,
      playersAttempted: 0,
      playersSucceeded: 0,
      playersFailed: 0,
      ownershipLost: 0,
      budgetExhausted: false,
    });
    expect(discovery.discoverAndEnqueue).not.toHaveBeenCalled();
  });

  it('all success → COMPLETED including zero-match success', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1'), tracked('tp-2')])
      .mockResolvedValueOnce([]);
    discovery.discoverAndEnqueue
      .mockResolvedValueOnce(okDiscovery({ discoveredMatchCount: 0, enqueuedCount: 0, externalMatchIds: [] }))
      .mockResolvedValueOnce(okDiscovery({ discoveredMatchCount: 3, enqueuedCount: 1, skippedAlreadyCompleteCount: 2 }));

    const result = await service.runOnce({ ...defaultInput, concurrency: 2 });
    expect(result.status).toBe('COMPLETED');
    expect(result.counters.playersSucceeded).toBe(2);
    expect(result.counters.playersFailed).toBe(0);
    expect(result.counters.playersSucceeded + result.counters.playersFailed + result.counters.ownershipLost).toBe(
      result.counters.playersAttempted,
    );
    expect(trackedPlayers.finalizeSuccess).toHaveBeenCalledTimes(2);
  });

  it('player failure → PARTIAL and not ownershipLost', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([]);
    discovery.discoverAndEnqueue.mockResolvedValueOnce({
      ok: false,
      discoveredMatchCount: 0,
      enqueuedCount: 0,
      skippedAlreadyCompleteCount: 0,
      externalMatchIds: [],
      warnings: [{ code: 'DISCOVERY_FAILED', message: 'boom' }],
      normalizedFailureCode: 'DISCOVERY_FAILED',
    });

    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('PARTIAL');
    expect(result.counters.playersFailed).toBe(1);
    expect(result.counters.ownershipLost).toBe(0);
    expect(trackedPlayers.finalizeFailure).toHaveBeenCalled();
  });

  it('ownership lost → PARTIAL, ownershipLost++, not playersFailed', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([]);
    trackedPlayers.finalizeSuccess.mockResolvedValueOnce({ updated: false });

    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('PARTIAL');
    expect(result.counters.ownershipLost).toBe(1);
    expect(result.counters.playersFailed).toBe(0);
    expect(result.counters.playersSucceeded).toBe(0);
  });

  it('missing PlayerAccount → TRACKED_ACCOUNT_MISSING without discovery', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-missing')])
      .mockResolvedValueOnce([]);
    playerAccounts.findById.mockResolvedValueOnce(null);

    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('PARTIAL');
    expect(result.counters.playersFailed).toBe(1);
    expect(discovery.discoverAndEnqueue).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'TRACKED_ACCOUNT_MISSING' }),
    );
  });

  it('provider/platform mismatch → ACCOUNT_IDENTITY_INVALID without discovery', async () => {
    const player = tracked('tp-mismatch');
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([player])
      .mockResolvedValueOnce([]);
    playerAccounts.findById.mockResolvedValueOnce({
      ...matchingAccount(player.playerAccountId),
      platformRoute: 'euw1',
    });

    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('PARTIAL');
    expect(discovery.discoverAndEnqueue).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'ACCOUNT_IDENTITY_INVALID' }),
    );
  });

  it('invalid playerAccountId UUID → ACCOUNT_REFERENCE_INVALID without discovery', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-bad', { playerAccountId: 'not-a-uuid' })])
      .mockResolvedValueOnce([]);

    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('PARTIAL');
    expect(playerAccounts.findById).not.toHaveBeenCalled();
    expect(discovery.discoverAndEnqueue).not.toHaveBeenCalled();
    expect(trackedPlayers.finalizeFailure).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'ACCOUNT_REFERENCE_INVALID' }),
    );
  });

  it('rate limit stops later waves', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([tracked('tp-2')]);
    discovery.discoverAndEnqueue.mockResolvedValueOnce({
      ok: false,
      discoveredMatchCount: 0,
      enqueuedCount: 0,
      skippedAlreadyCompleteCount: 0,
      externalMatchIds: [],
      warnings: [],
      normalizedFailureCode: 'RATE_LIMITED',
      rateLimited: true,
      retryAfterMs: 30_000,
    });

    const result = await service.runOnce({ ...defaultInput, concurrency: 1, batchLimit: 5 });
    expect(result.status).toBe('PARTIAL');
    expect(result.counters.rateLimitStops).toBe(1);
    expect(trackedPlayers.claimEligibleWave).toHaveBeenCalledTimes(1);
    expect(discovery.discoverAndEnqueue).toHaveBeenCalledTimes(1);
  });

  it('rate limit on first started player drains unstarted wave peers without Riot', async () => {
    const p1 = tracked('tp-rl-1');
    const p2 = tracked('tp-rl-2');
    const p3 = tracked('tp-rl-3');
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([p1, p2, p3])
      .mockResolvedValueOnce([]);

    let releaseFirst: ((value: PlayerMatchDiscoveryResult) => void) | undefined;
    let releaseSecond: ((value: PlayerMatchDiscoveryResult) => void) | undefined;
    const firstHang = new Promise<PlayerMatchDiscoveryResult>((resolve) => {
      releaseFirst = resolve;
    });
    const secondHang = new Promise<PlayerMatchDiscoveryResult>((resolve) => {
      releaseSecond = resolve;
    });

    discovery.discoverAndEnqueue.mockImplementation(async (input) => {
      if (input.playerAccountId === p1.playerAccountId) {
        return firstHang;
      }
      if (input.playerAccountId === p2.playerAccountId) {
        return secondHang;
      }
      throw new Error(`unexpected discovery for ${input.playerAccountId}`);
    });

    const runPromise = service.runOnce({
      ...defaultInput,
      concurrency: 2,
      batchLimit: 3,
    });

    // Both concurrency slots start (p1 + p2); p3 remains queued.
    await vi.waitFor(() => {
      expect(discovery.discoverAndEnqueue).toHaveBeenCalledTimes(2);
    });

    // Rate-limit resolves first so the free worker drains p3 without Riot.
    releaseFirst?.({
      ok: false,
      discoveredMatchCount: 0,
      enqueuedCount: 0,
      skippedAlreadyCompleteCount: 0,
      externalMatchIds: [],
      warnings: [],
      normalizedFailureCode: 'RATE_LIMITED',
      rateLimited: true,
      retryAfterMs: 12_000,
    });

    await vi.waitFor(() => {
      expect(trackedPlayers.finalizeFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          trackedPlayerId: p3.id,
          failureCode: 'RATE_LIMITED',
        }),
      );
    });

    // In-flight peer may finish normally after the stop signal.
    releaseSecond?.(okDiscovery({ discoveredMatchCount: 1, enqueuedCount: 1 }));

    const result = await runPromise;
    expect(result.status).toBe('PARTIAL');
    expect(result.counters.rateLimitStops).toBe(1);
    expect(result.counters.playersFailed).toBeGreaterThanOrEqual(2);
    expect(discovery.discoverAndEnqueue).toHaveBeenCalledTimes(2);
    expect(
      discovery.discoverAndEnqueue.mock.calls.map(
        (call) => (call[0] as { playerAccountId: string }).playerAccountId,
      ),
    ).not.toContain(p3.playerAccountId);
  });

  it('processes wave players in parallel when concurrency≥2', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-par-1'), tracked('tp-par-2')])
      .mockResolvedValueOnce([]);

    let inFlight = 0;
    let maxInFlight = 0;
    discovery.discoverAndEnqueue.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return okDiscovery();
    });

    const result = await service.runOnce({ ...defaultInput, concurrency: 2 });
    expect(result.status).toBe('COMPLETED');
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
    expect(discovery.discoverAndEnqueue).toHaveBeenCalledTimes(2);
  });

  it('batch limit across waves', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1'), tracked('tp-2')])
      .mockResolvedValueOnce([tracked('tp-3')]);

    const result = await service.runOnce({
      ...defaultInput,
      batchLimit: 3,
      concurrency: 2,
    });

    expect(result.counters.playersClaimed).toBe(3);
    expect(result.status).toBe('COMPLETED');
    const limits = trackedPlayers.claimEligibleWave.mock.calls.map(
      (call) => (call[0] as { limit: number }).limit,
    );
    expect(limits[0]).toBe(2);
    expect(limits[1]).toBe(1);
  });

  it('concurrency never exceeded in claim wave size', async () => {
    trackedPlayers.claimEligibleWave.mockResolvedValueOnce([]).mockResolvedValue([]);
    await service.runOnce({ ...defaultInput, concurrency: 2, batchLimit: 10 });
    trackedPlayers.claimEligibleWave.mockReset();
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('a'), tracked('b')])
      .mockResolvedValueOnce([]);
    await service.runOnce({ ...defaultInput, concurrency: 2, batchLimit: 10 });
    expect((trackedPlayers.claimEligibleWave.mock.calls[0]?.[0] as { limit: number }).limit).toBe(2);
  });

  it('pre-allocates maxMatches so parallel budgets do not overshoot', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1'), tracked('tp-2')])
      .mockResolvedValueOnce([]);
    discovery.discoverAndEnqueue
      .mockResolvedValueOnce(okDiscovery({ discoveredMatchCount: 6, enqueuedCount: 6 }))
      .mockResolvedValueOnce(okDiscovery({ discoveredMatchCount: 1, enqueuedCount: 1 }));

    const result = await service.runOnce({
      ...defaultInput,
      concurrency: 2,
      matchesPerPlayer: 20,
      maxMatchIdsPerRun: 7,
      maxEnqueuePerRun: 100,
    });

    // Claim capped by useful budget; each claimed player gets >= 1 (6+1=7 reserved).
    expect(discovery.discoverAndEnqueue).toHaveBeenCalledTimes(2);
    const reserved = discovery.discoverAndEnqueue.mock.calls
      .map((call) => (call[0] as { maxMatches: number }).maxMatches)
      .sort((a, b) => a - b);
    expect(reserved).toEqual([1, 6]);
    expect(result.counters.matchIdsDiscovered).toBe(7);
    expect(result.counters.playersSucceeded).toBe(2);
  });

  it('wave claim size is capped by useful budget', async () => {
    trackedPlayers.claimEligibleWave.mockResolvedValueOnce([tracked('tp-1')]).mockResolvedValueOnce([]);
    await service.runOnce({
      ...defaultInput,
      concurrency: 5,
      batchLimit: 10,
      maxMatchIdsPerRun: 2,
      maxEnqueuePerRun: 100,
    });
    expect((trackedPlayers.claimEligibleWave.mock.calls[0]?.[0] as { limit: number }).limit).toBe(2);
  });

  it('zero-budget claimed player releases lease without finalizeSuccess', async () => {
    // Claim mock returns more rows than waveLimit/budget (defense-in-depth path).
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-budget-1'), tracked('tp-budget-2')])
      .mockResolvedValueOnce([]);
    trackedPlayers.countEligible.mockResolvedValue(1);
    discovery.discoverAndEnqueue.mockResolvedValue(
      okDiscovery({ discoveredMatchCount: 1, enqueuedCount: 1 }),
    );

    const result = await service.runOnce({
      ...defaultInput,
      concurrency: 2,
      batchLimit: 10,
      matchesPerPlayer: 20,
      maxMatchIdsPerRun: 1,
      maxEnqueuePerRun: 1,
    });

    // waveLimit = min(2,10,1,1)=1 but mock returned 2 → second gets maxMatches=0.
    expect(trackedPlayers.releaseOwnedLease).toHaveBeenCalledWith(
      expect.objectContaining({ trackedPlayerId: 'tp-budget-2' }),
    );
    expect(trackedPlayers.finalizeSuccess).not.toHaveBeenCalledWith(
      expect.objectContaining({ trackedPlayerId: 'tp-budget-2' }),
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.counters.budgetExhausted).toBe(true);
    expect(result.counters.playersFailed).toBeGreaterThanOrEqual(1);
    expect(
      result.counters.playersSucceeded +
        result.counters.playersFailed +
        result.counters.ownershipLost,
    ).toBe(result.counters.playersAttempted);
  });

  it('no useful budget → no claim; PARTIAL + budgetExhausted when eligible remain', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([tracked('tp-2')]);
    discovery.discoverAndEnqueue.mockResolvedValueOnce(
      okDiscovery({ discoveredMatchCount: 5, enqueuedCount: 5 }),
    );
    trackedPlayers.countEligible.mockResolvedValue(3);

    const result = await service.runOnce({
      ...defaultInput,
      concurrency: 1,
      matchesPerPlayer: 5,
      maxMatchIdsPerRun: 5,
      maxEnqueuePerRun: 5,
    });

    expect(result.status).toBe('PARTIAL');
    expect(result.counters.budgetExhausted).toBe(true);
    expect(trackedPlayers.claimEligibleWave).toHaveBeenCalledTimes(1);
  });

  it('exact batchLimit after successes → COMPLETED not budgetExhausted', async () => {
    trackedPlayers.claimEligibleWave.mockResolvedValueOnce([tracked('tp-1')]);
    const result = await service.runOnce({
      ...defaultInput,
      batchLimit: 1,
      concurrency: 1,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.counters.budgetExhausted).toBe(false);
    expect(result.counters.playersClaimed).toBe(1);
  });

  it('setup failure before attempts → FAILED best-effort', async () => {
    runs.createRunning.mockRejectedValueOnce(new Error('db down'));
    await expect(service.runOnce(defaultInput)).rejects.toThrow(CollectorRunError);
    expect(runs.finalizeIfRunning).not.toHaveBeenCalled();
  });

  it('post-attempt exception → best-effort PARTIAL', async () => {
    trackedPlayers.claimEligibleWave.mockResolvedValueOnce([tracked('tp-1')]);
    discovery.discoverAndEnqueue.mockResolvedValueOnce(okDiscovery());
    trackedPlayers.countOwnedUnreleasedLeases.mockRejectedValueOnce(new Error('lease check failed'));

    await expect(service.runOnce(defaultInput)).rejects.toThrow();
    expect(runs.finalizeIfRunning).toHaveBeenCalledWith(
      expect.objectContaining({ status: CollectorRunStatus.PARTIAL }),
    );
  });

  it('finalization conflict throws nonzero', async () => {
    trackedPlayers.claimEligibleWave.mockResolvedValueOnce([]);
    runs.finalizeIfRunning.mockResolvedValueOnce(null);
    await expect(service.runOnce(defaultInput)).rejects.toThrow(/finalization conflict/i);
  });

  it('unreleased lease guard force-releases or fails', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([]);
    trackedPlayers.countOwnedUnreleasedLeases
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    trackedPlayers.forceReleaseOwnedLeases.mockResolvedValueOnce(1);

    const result = await service.runOnce(defaultInput);
    expect(result.status).toBe('COMPLETED');
    expect(trackedPlayers.forceReleaseOwnedLeases).toHaveBeenCalled();
  });

  it('unreleased leases after force-release → throw UNRELEASED_LEASES', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([]);
    trackedPlayers.countOwnedUnreleasedLeases.mockResolvedValue(1);
    trackedPlayers.forceReleaseOwnedLeases.mockResolvedValue(0);

    await expect(service.runOnce(defaultInput)).rejects.toMatchObject({
      code: 'UNRELEASED_LEASES',
    });
  });

  it('status-aware success finalization uses finalizeSuccess', async () => {
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1')])
      .mockResolvedValueOnce([]);
    await service.runOnce(defaultInput);
    expect(trackedPlayers.finalizeSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        trackedPlayerId: 'tp-1',
        minRefreshIntervalMs: baseConfig().minRefreshIntervalMs,
      }),
    );
  });

  it('preview delegates to eligibility without creating a run', async () => {
    await service.preview({ queueId: 420 });
    expect(eligibility.preview).toHaveBeenCalledWith({ queueId: 420 });
    expect(runs.createRunning).not.toHaveBeenCalled();
  });

  it('PLAYER_ACCOUNT discovery mode only', async () => {
    const accountId = accountUuid('acc-xyz');
    trackedPlayers.claimEligibleWave
      .mockResolvedValueOnce([tracked('tp-1', { playerAccountId: accountId })])
      .mockResolvedValueOnce([]);
    await service.runOnce(defaultInput);
    expect(discovery.discoverAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'PLAYER_ACCOUNT',
        playerAccountId: accountId,
        dryRun: false,
      }),
    );
  });
});
