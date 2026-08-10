import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorRunStatus } from '@prisma/client';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import {
  abortableSleep,
  CollectorSchedulerService,
} from './collector-scheduler.service';
import type { CollectorSchedulerStateRepository } from './collector-scheduler-state.repository';
import type { PopulationCollectorService } from './population-collector.service';
import type { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import type { CollectorRunOnceResult } from './collector.types';
import { CollectorModule } from './collector.module';

function baseConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    ...loadCollectorConfig({}),
    schedulerLeaseMs: 60 * 60_000,
    scheduleIntervalMs: 50,
    maxPendingIngestionJobs: 100,
    schedulerRateLimitCooldownMs: 15 * 60_000,
    ...overrides,
  };
}

function runResult(overrides: Partial<CollectorRunOnceResult> = {}): CollectorRunOnceResult {
  return {
    runId: 'run-abc',
    ownerToken: 'collector-owner',
    status: CollectorRunStatus.COMPLETED,
    effectivePlatforms: ['na1'],
    queueId: 420,
    batchLimit: 10,
    concurrency: 2,
    counters: {
      playersClaimed: 1,
      playersAttempted: 1,
      playersSucceeded: 1,
      playersFailed: 0,
      ownershipLost: 0,
      matchIdsDiscovered: 2,
      matchesEnqueued: 2,
      matchesSkippedComplete: 0,
      rateLimitStops: 0,
      budgetExhausted: false,
      failureCode: null,
    },
    durationMs: 10,
    ...overrides,
  };
}

describe('CollectorSchedulerService', () => {
  const originalEnabled = process.env.COLLECTOR_SCHEDULER_ENABLED;

  let schedulerState: {
    tryAcquireLease: ReturnType<typeof vi.fn>;
    renewLease: ReturnType<typeof vi.fn>;
    recordTrigger: ReturnType<typeof vi.fn>;
    recordOutcome: ReturnType<typeof vi.fn>;
    setCooldown: ReturnType<typeof vi.fn>;
    releaseLease: ReturnType<typeof vi.fn>;
    readState: ReturnType<typeof vi.fn>;
    ensureSingleton: ReturnType<typeof vi.fn>;
  };
  let populationCollector: { runOnce: ReturnType<typeof vi.fn> };
  let matchIngestion: { getQueueCounts: ReturnType<typeof vi.fn> };
  let config: CollectorConfig;
  let service: CollectorSchedulerService;

  let sharedCooldown: {
    getCooldownState: ReturnType<typeof vi.fn>;
    isCoolingDown: ReturnType<typeof vi.fn>;
    extendCooldown: ReturnType<typeof vi.fn>;
  } | null;

  function buildService(
    cfg: CollectorConfig = config,
    cooldown: typeof sharedCooldown = sharedCooldown,
  ): CollectorSchedulerService {
    return new CollectorSchedulerService(
      schedulerState as unknown as CollectorSchedulerStateRepository,
      populationCollector as unknown as PopulationCollectorService,
      matchIngestion as unknown as MatchIngestionProducer,
      cfg,
      cooldown as never,
    );
  }

  beforeEach(() => {
    process.env.COLLECTOR_SCHEDULER_ENABLED = 'true';
    config = baseConfig();
    schedulerState = {
      tryAcquireLease: vi.fn().mockResolvedValue(true),
      renewLease: vi.fn().mockResolvedValue(true),
      recordTrigger: vi.fn().mockResolvedValue(true),
      recordOutcome: vi.fn().mockResolvedValue(true),
      setCooldown: vi.fn().mockResolvedValue(true),
      releaseLease: vi.fn().mockResolvedValue(true),
      readState: vi.fn().mockResolvedValue({
        id: 'singleton',
        cooldownUntil: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastTriggerAt: null,
        lastOutcome: null,
        lastCollectorRunId: null,
        lastErrorCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      ensureSingleton: vi.fn().mockResolvedValue(undefined),
    };
    populationCollector = {
      runOnce: vi.fn().mockResolvedValue(runResult()),
    };
    matchIngestion = {
      getQueueCounts: vi.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
      }),
    };
    sharedCooldown = {
      getCooldownState: vi.fn().mockResolvedValue({ cooldownUntil: null }),
      isCoolingDown: vi.fn().mockResolvedValue(false),
      extendCooldown: vi.fn().mockResolvedValue({
        cooldownUntil: Date.now() + 15 * 60_000,
        extended: true,
        previousCooldownUntil: null,
      }),
    };
    service = buildService();
  });

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.COLLECTOR_SCHEDULER_ENABLED;
    } else {
      process.env.COLLECTOR_SCHEDULER_ENABLED = originalEnabled;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('constructor does not start scheduling', () => {
    const tickSpy = vi.spyOn(CollectorSchedulerService.prototype, 'tick');
    const runLoopSpy = vi.spyOn(CollectorSchedulerService.prototype, 'runLoop');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    buildService();
    expect(tickSpy).not.toHaveBeenCalled();
    expect(runLoopSpy).not.toHaveBeenCalled();
    // Lease renewal setInterval starts only inside an owned tick — never at construct.
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('CollectorModule does not declare OnModuleInit scheduling', () => {
    expect(CollectorModule.prototype).not.toHaveProperty('onModuleInit');
    const proto = Object.getPrototypeOf(CollectorModule.prototype) as object;
    expect(proto).not.toHaveProperty('onModuleInit');
  });

  it('disabled: no acquire, no queue probe, no runOnce, no shared write', async () => {
    process.env.COLLECTOR_SCHEDULER_ENABLED = 'false';
    const result = await service.tick();
    expect(result).toEqual({ outcome: 'SKIPPED_DISABLED' });
    expect(schedulerState.tryAcquireLease).not.toHaveBeenCalled();
    expect(matchIngestion.getQueueCounts).not.toHaveBeenCalled();
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
    expect(schedulerState.recordOutcome).not.toHaveBeenCalled();
    expect(schedulerState.recordTrigger).not.toHaveBeenCalled();
    expect(schedulerState.releaseLease).not.toHaveBeenCalled();
  });

  it('invalid enable flag fails tick without shared mutation', async () => {
    process.env.COLLECTOR_SCHEDULER_ENABLED = 'maybe';
    const result = await service.tick();
    expect(result).toEqual({
      outcome: 'FAILED_TO_START',
      errorCode: 'INVALID_SCHEDULER_ENABLED',
    });
    expect(schedulerState.tryAcquireLease).not.toHaveBeenCalled();
    expect(matchIngestion.getQueueCounts).not.toHaveBeenCalled();
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
  });

  it('enabled + acquisition fails: SKIPPED_OVERLAP; no queue probe; no runOnce', async () => {
    schedulerState.tryAcquireLease.mockResolvedValue(false);
    const result = await service.tick();
    expect(result).toEqual({ outcome: 'SKIPPED_OVERLAP' });
    expect(matchIngestion.getQueueCounts).not.toHaveBeenCalled();
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
    expect(schedulerState.recordOutcome).not.toHaveBeenCalled();
    expect(schedulerState.releaseLease).not.toHaveBeenCalled();
  });

  it('cooldown active: owner acquired; no queue probe/runOnce; records SKIPPED_COOLDOWN; lease released', async () => {
    const cooldownUntil = new Date(Date.now() + 60_000);
    schedulerState.readState.mockResolvedValue({
      id: 'singleton',
      cooldownUntil,
      leaseOwner: 'x',
      leaseExpiresAt: new Date(),
      lastTriggerAt: null,
      lastOutcome: null,
      lastCollectorRunId: null,
      lastErrorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.tick();
    expect(result).toEqual({ outcome: 'SKIPPED_COOLDOWN' });
    expect(schedulerState.tryAcquireLease).toHaveBeenCalledTimes(1);
    expect(matchIngestion.getQueueCounts).not.toHaveBeenCalled();
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
    expect(schedulerState.recordOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'SKIPPED_COOLDOWN',
    );
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('shared Riot cooldown takes precedence over local cooldown check', async () => {
    const sharedUntil = Date.now() + 120_000;
    sharedCooldown!.getCooldownState.mockResolvedValue({ cooldownUntil: sharedUntil });
    const result = await service.tick();
    expect(result).toEqual({ outcome: 'SKIPPED_COOLDOWN' });
    expect(schedulerState.readState).not.toHaveBeenCalled();
    expect(matchIngestion.getQueueCounts).not.toHaveBeenCalled();
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('queue below threshold: runOnce executes', async () => {
    matchIngestion.getQueueCounts.mockResolvedValue({
      waiting: 10,
      active: 5,
      delayed: 0,
      failed: 0,
      completed: 0,
    });
    const result = await service.tick();
    expect(result.outcome).toBe('TRIGGERED');
    expect(populationCollector.runOnce).toHaveBeenCalledTimes(1);
  });

  it('queue exactly threshold: allowed', async () => {
    matchIngestion.getQueueCounts.mockResolvedValue({
      waiting: 50,
      active: 40,
      delayed: 10,
      failed: 0,
      completed: 0,
    });
    // pending = 100 === maxPendingIngestionJobs
    const result = await service.tick();
    expect(result.outcome).toBe('TRIGGERED');
    expect(populationCollector.runOnce).toHaveBeenCalledTimes(1);
  });

  it('queue above threshold: no runOnce; SKIPPED_BACKPRESSURE', async () => {
    matchIngestion.getQueueCounts.mockResolvedValue({
      waiting: 50,
      active: 40,
      delayed: 11,
      failed: 0,
      completed: 0,
    });
    const result = await service.tick();
    expect(result).toEqual({ outcome: 'SKIPPED_BACKPRESSURE' });
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
    expect(schedulerState.recordOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'SKIPPED_BACKPRESSURE',
    );
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('queue probe throws: no runOnce; fail-safe skip', async () => {
    matchIngestion.getQueueCounts.mockRejectedValue(new Error('redis down'));
    const result = await service.tick();
    expect(result).toEqual({
      outcome: 'SKIPPED_BACKPRESSURE',
      errorCode: 'QUEUE_PROBE_FAILED',
    });
    expect(populationCollector.runOnce).not.toHaveBeenCalled();
    expect(schedulerState.recordOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'SKIPPED_BACKPRESSURE',
      'QUEUE_PROBE_FAILED',
    );
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('runOnce called exactly once when triggered', async () => {
    await service.tick();
    expect(populationCollector.runOnce).toHaveBeenCalledTimes(1);
  });

  it('runOnce receives approved schedule config', async () => {
    config = baseConfig({
      schedulePlatform: 'euw1',
      scheduleQueueId: 420,
      scheduleBatchSize: 8,
      scheduleConcurrency: 3,
      scheduleMaxMatchesPerPlayer: 15,
      scheduleMaxMatchIds: 120,
      scheduleMaxEnqueue: 90,
    });
    service = buildService(config);

    await service.tick();
    expect(populationCollector.runOnce).toHaveBeenCalledWith({
      platformFilter: 'euw1',
      queueId: 420,
      batchLimit: 8,
      concurrency: 3,
      matchesPerPlayer: 15,
      maxMatchIdsPerRun: 120,
      maxEnqueuePerRun: 90,
    });
  });

  it('runOnce terminal PARTIAL still returns TRIGGERED', async () => {
    populationCollector.runOnce.mockResolvedValue(
      runResult({ status: CollectorRunStatus.PARTIAL }),
    );
    const result = await service.tick();
    expect(result).toEqual({ outcome: 'TRIGGERED', collectorRunId: 'run-abc' });
    expect(schedulerState.recordOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'TRIGGERED',
    );
  });

  it('runOnce terminal FAILED still returns TRIGGERED', async () => {
    populationCollector.runOnce.mockResolvedValue(
      runResult({ status: CollectorRunStatus.FAILED }),
    );
    const result = await service.tick();
    expect(result).toEqual({ outcome: 'TRIGGERED', collectorRunId: 'run-abc' });
  });

  it('runOnce throw → FAILED_TO_START and releases lease', async () => {
    populationCollector.runOnce.mockRejectedValue(new Error('boom'));
    const result = await service.tick();
    expect(result).toEqual({
      outcome: 'FAILED_TO_START',
      errorCode: 'RUN_ONCE_START_FAILED',
    });
    expect(schedulerState.recordOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'FAILED_TO_START',
      'RUN_ONCE_START_FAILED',
    );
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('rate-limited run sets cooldown', async () => {
    populationCollector.runOnce.mockResolvedValue(
      runResult({
        status: CollectorRunStatus.PARTIAL,
        counters: {
          ...runResult().counters,
          rateLimitStops: 1,
        },
      }),
    );
    // Collector already published a longer shared cooldown; local mirrors max(local, shared).
    const sharedUntil = Date.now() + 30 * 60_000;
    sharedCooldown!.getCooldownState
      .mockResolvedValueOnce({ cooldownUntil: null }) // preflight inactive
      .mockResolvedValueOnce({ cooldownUntil: sharedUntil }); // after rate-limited run
    const result = await service.tick();
    expect(result.outcome).toBe('TRIGGERED');
    expect(schedulerState.setCooldown).toHaveBeenCalledTimes(1);
    const [, until] = schedulerState.setCooldown.mock.calls[0] as [string, Date];
    expect(until.getTime()).toBe(sharedUntil);
    expect(sharedCooldown!.extendCooldown).not.toHaveBeenCalled();
  });

  it('rate-limited run extends shared when inactive then mirrors local', async () => {
    populationCollector.runOnce.mockResolvedValue(
      runResult({
        status: CollectorRunStatus.PARTIAL,
        counters: {
          ...runResult().counters,
          rateLimitStops: 1,
        },
      }),
    );
    sharedCooldown!.getCooldownState.mockResolvedValue({ cooldownUntil: null });
    // Longer than local schedulerRateLimitCooldownMs so max() selects shared.
    const extendedUntil = Date.now() + config.riotShared429CooldownMinMs + 60_000;
    sharedCooldown!.extendCooldown.mockResolvedValue({
      cooldownUntil: extendedUntil,
      extended: true,
      previousCooldownUntil: null,
    });
    await service.tick();
    expect(sharedCooldown!.extendCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredFloorMs: config.riotShared429CooldownMinMs,
        source: 'scheduler',
      }),
    );
    const [, until] = schedulerState.setCooldown.mock.calls[0] as [string, Date];
    expect(until.getTime()).toBe(extendedUntil);
  });

  it('rate-limited via failure code sets cooldown', async () => {
    populationCollector.runOnce.mockResolvedValue(
      runResult({
        status: CollectorRunStatus.PARTIAL,
        counters: {
          ...runResult().counters,
          rateLimitStops: 0,
          failureCode: 'RATE_LIMITED',
        },
      }),
    );
    await service.tick();
    expect(schedulerState.setCooldown).toHaveBeenCalledTimes(1);
  });

  it('non-rate-limited run does not invent cooldown', async () => {
    await service.tick();
    expect(schedulerState.setCooldown).not.toHaveBeenCalled();
  });

  it('owner release on normal path', async () => {
    await service.tick();
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
    const owner = schedulerState.tryAcquireLease.mock.calls[0]?.[0] as string;
    expect(schedulerState.releaseLease).toHaveBeenCalledWith(owner);
  });

  it('release on exceptions after acquire (records FAILED_TO_START)', async () => {
    schedulerState.readState.mockRejectedValue(new Error('db down'));
    const result = await service.tick();
    expect(result).toEqual({
      outcome: 'FAILED_TO_START',
      errorCode: 'RUN_ONCE_START_FAILED',
    });
    expect(schedulerState.recordOutcome).toHaveBeenCalledWith(
      expect.any(String),
      'FAILED_TO_START',
      'RUN_ONCE_START_FAILED',
    );
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('stale owner cannot record terminal result after ownership loss', async () => {
    schedulerState.recordTrigger.mockResolvedValue(false);
    schedulerState.recordOutcome.mockResolvedValue(false);
    const result = await service.tick();
    expect(result).toEqual({
      outcome: 'TRIGGERED',
      collectorRunId: 'run-abc',
      errorCode: 'OWNERSHIP_LOST',
    });
    // Must not attempt setCooldown after ownership loss on trigger.
    expect(schedulerState.setCooldown).not.toHaveBeenCalled();
    expect(schedulerState.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('renewal only uses current owner token', async () => {
    vi.useFakeTimers();
    config = baseConfig({ schedulerLeaseMs: 9_000 });
    service = buildService(config);

    let resolveRun!: (value: CollectorRunOnceResult) => void;
    populationCollector.runOnce.mockImplementation(
      () =>
        new Promise<CollectorRunOnceResult>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const tickPromise = service.tick();
    await Promise.resolve();
    const owner = schedulerState.tryAcquireLease.mock.calls[0]?.[0] as string;

    await vi.advanceTimersByTimeAsync(3_000);
    expect(schedulerState.renewLease).toHaveBeenCalled();
    for (const call of schedulerState.renewLease.mock.calls) {
      expect(call[0]).toBe(owner);
      expect(call[1]).toBe(9_000);
    }

    resolveRun(runResult());
    await tickPromise;
    vi.useRealTimers();
  });

  it('runLoop does not overlap local ticks', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let ticks = 0;
    const tickSpy = vi.spyOn(service, 'tick').mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      ticks += 1;
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return { outcome: 'SKIPPED_DISABLED' };
    });

    const controller = new AbortController();
    const loop = service.runLoop(controller.signal);
    await new Promise((r) => setTimeout(r, 120));
    controller.abort();
    await loop;

    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(maxInFlight).toBe(1);
    tickSpy.mockRestore();
  });

  it('abort stops future ticks', async () => {
    let ticks = 0;
    vi.spyOn(service, 'tick').mockImplementation(async () => {
      ticks += 1;
      return { outcome: 'SKIPPED_DISABLED' };
    });

    const controller = new AbortController();
    const loop = service.runLoop(controller.signal);
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await loop;
    const afterAbort = ticks;
    await new Promise((r) => setTimeout(r, 80));
    expect(ticks).toBe(afterAbort);
  });

  it('long tick does not generate catch-up ticks', async () => {
    config = baseConfig({ scheduleIntervalMs: 20 });
    service = buildService(config);

    const starts: number[] = [];
    vi.spyOn(service, 'tick').mockImplementation(async () => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 60));
      return { outcome: 'SKIPPED_DISABLED' };
    });

    const controller = new AbortController();
    const loop = service.runLoop(controller.signal);
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await loop;

    // With catch-up we would see many more ticks; without, ~200/(60+20) ≈ 2–3.
    expect(starts.length).toBeLessThanOrEqual(4);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(55);
    }
  });

  it('first runLoop tick is immediate', async () => {
    const starts: number[] = [];
    const t0 = Date.now();
    vi.spyOn(service, 'tick').mockImplementation(async () => {
      starts.push(Date.now() - t0);
      return { outcome: 'SKIPPED_DISABLED' };
    });

    const controller = new AbortController();
    const loop = service.runLoop(controller.signal);
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await loop;

    expect(starts[0]).toBeLessThan(20);
  });

  it('re-reads enable flag each tick from process.env', async () => {
    process.env.COLLECTOR_SCHEDULER_ENABLED = 'true';
    await service.tick();
    expect(populationCollector.runOnce).toHaveBeenCalledTimes(1);

    process.env.COLLECTOR_SCHEDULER_ENABLED = 'false';
    const second = await service.tick();
    expect(second.outcome).toBe('SKIPPED_DISABLED');
    expect(populationCollector.runOnce).toHaveBeenCalledTimes(1);
  });
});

describe('abortableSleep', () => {
  it('resolves early on abort', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleep = abortableSleep(5_000, controller.signal);
    controller.abort();
    await sleep;
    expect(Date.now() - started).toBeLessThan(100);
  });
});
