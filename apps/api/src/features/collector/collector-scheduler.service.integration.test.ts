import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CollectorSchedulerOutcome,
  CollectorRunStatus,
  PrismaClient,
  type CollectorSchedulerState,
} from '@prisma/client';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { CollectorSchedulerService } from './collector-scheduler.service';
import { CollectorSchedulerStateRepository } from './collector-scheduler-state.repository';
import type { PopulationCollectorService } from './population-collector.service';
import type { MatchIngestionProducer } from '../../queues/match-ingestion.producer';
import type { CollectorRunOnceResult, SchedulerTickResult } from './collector.types';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://league:league@localhost:5432/league_helper_m12v2?schema=league_helper_test';

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } },
});

const SINGLETON_ID = 'singleton';
const WINNER_RUN_ID = 'run-winner-replica';

function baseConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return {
    ...loadCollectorConfig({}),
    schedulerLeaseMs: 60 * 60_000,
    scheduleIntervalMs: 50,
    maxPendingIngestionJobs: 500,
    schedulerRateLimitCooldownMs: 15 * 60_000,
    ...overrides,
  };
}

function runResult(overrides: Partial<CollectorRunOnceResult> = {}): CollectorRunOnceResult {
  return {
    runId: WINNER_RUN_ID,
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

async function resetSchedulerState(): Promise<void> {
  const repo = new CollectorSchedulerStateRepository(prisma as never);
  await repo.ensureSingleton();
  await prisma.$executeRawUnsafe(
    `
    UPDATE "CollectorSchedulerState"
    SET
      "leaseOwner" = NULL,
      "leaseExpiresAt" = NULL,
      "lastTriggerAt" = NULL,
      "lastOutcome" = NULL,
      "lastCollectorRunId" = NULL,
      "lastErrorCode" = NULL,
      "cooldownUntil" = NULL,
      "updatedAt" = now()
    WHERE id = $1::text
    `,
    SINGLETON_ID,
  );
}

async function readRaw(): Promise<CollectorSchedulerState> {
  return prisma.collectorSchedulerState.findUniqueOrThrow({
    where: { id: SINGLETON_ID },
  });
}

function buildService(input: {
  config: CollectorConfig;
  schedulerState: CollectorSchedulerStateRepository;
  runOnce: PopulationCollectorService['runOnce'];
  getQueueCounts: MatchIngestionProducer['getQueueCounts'];
}): CollectorSchedulerService {
  return new CollectorSchedulerService(
    input.schedulerState,
    { runOnce: input.runOnce } as unknown as PopulationCollectorService,
    { getQueueCounts: input.getQueueCounts } as unknown as MatchIngestionProducer,
    input.config,
  );
}

describe('CollectorSchedulerService multi-replica tick (PostgreSQL)', () => {
  const originalEnabled = process.env.COLLECTOR_SCHEDULER_ENABLED;

  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  beforeEach(async () => {
    process.env.COLLECTOR_SCHEDULER_ENABLED = 'true';
    await resetSchedulerState();
  });

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.COLLECTOR_SCHEDULER_ENABLED;
    } else {
      process.env.COLLECTOR_SCHEDULER_ENABLED = originalEnabled;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('two concurrent ticks: exactly one TRIGGERED, one SKIPPED_OVERLAP; single runOnce; winner-only queue probe', async () => {
    const config = baseConfig();
    // Separate repository instances (replicas), shared PostgreSQL via same Prisma client.
    const repoA = new CollectorSchedulerStateRepository(prisma as never);
    const repoB = new CollectorSchedulerStateRepository(prisma as never);

    let releaseRunOnce!: (value: CollectorRunOnceResult) => void;
    let signalRunOnceEntered!: () => void;
    const runOnceEntered = new Promise<void>((resolve) => {
      signalRunOnceEntered = resolve;
    });
    const runOnceHeld = new Promise<CollectorRunOnceResult>((resolve) => {
      releaseRunOnce = resolve;
    });

    const runOnce = vi.fn(async () => {
      signalRunOnceEntered();
      return runOnceHeld;
    });
    const getQueueCounts = vi.fn(async () => ({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
    }));

    const serviceA = buildService({
      config,
      schedulerState: repoA,
      runOnce: runOnce as unknown as PopulationCollectorService['runOnce'],
      getQueueCounts: getQueueCounts as unknown as MatchIngestionProducer['getQueueCounts'],
    });
    const serviceB = buildService({
      config,
      schedulerState: repoB,
      runOnce: runOnce as unknown as PopulationCollectorService['runOnce'],
      getQueueCounts: getQueueCounts as unknown as MatchIngestionProducer['getQueueCounts'],
    });

    const tickA = serviceA.tick();
    const tickB = serviceB.tick();

    // Wait until the winning replica has entered runOnce (lease held).
    await runOnceEntered;

    // Mid-hold: lease must be owned; loser may still be racing or already finished OVERLAP.
    const mid = await readRaw();
    expect(mid.leaseOwner).not.toBeNull();
    expect(mid.leaseExpiresAt).not.toBeNull();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(getQueueCounts).toHaveBeenCalledTimes(1);

    // First settled tick while winner still holds runOnce must be the overlap loser.
    const firstSettled = await Promise.race([
      tickA.then((result): { label: 'A'; result: SchedulerTickResult } => ({
        label: 'A',
        result,
      })),
      tickB.then((result): { label: 'B'; result: SchedulerTickResult } => ({
        label: 'B',
        result,
      })),
    ]);
    expect(firstSettled.result).toEqual({ outcome: 'SKIPPED_OVERLAP' });

    // Stale loser must not have written shared outcome while winner still owns.
    const duringHold = await readRaw();
    expect(duringHold.leaseOwner).not.toBeNull();
    expect(duringHold.lastOutcome).toBeNull();
    expect(duringHold.lastCollectorRunId).toBeNull();

    // Complete winner runOnce.
    releaseRunOnce(runResult());
    const [resultA, resultB] = await Promise.all([tickA, tickB]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(['SKIPPED_OVERLAP', 'TRIGGERED']);

    const triggered = resultA.outcome === 'TRIGGERED' ? resultA : resultB;
    const overlap = resultA.outcome === 'SKIPPED_OVERLAP' ? resultA : resultB;
    expect(triggered).toEqual({
      outcome: 'TRIGGERED',
      collectorRunId: WINNER_RUN_ID,
    });
    expect(overlap).toEqual({ outcome: 'SKIPPED_OVERLAP' });

    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(getQueueCounts).toHaveBeenCalledTimes(1);

    const finalState = await readRaw();
    expect(finalState.lastOutcome).toBe(CollectorSchedulerOutcome.TRIGGERED);
    expect(finalState.lastCollectorRunId).toBe(WINNER_RUN_ID);
    expect(finalState.lastTriggerAt).not.toBeNull();
    expect(finalState.lastErrorCode).toBeNull();
    expect(finalState.leaseOwner).toBeNull();
    expect(finalState.leaseExpiresAt).toBeNull();
  });

  it('ownership lost during runOnce: local TRIGGERED+OWNERSHIP_LOST; stale writes/release are no-ops', async () => {
    const config = baseConfig();
    const repoWinner = new CollectorSchedulerStateRepository(prisma as never);
    const repoTaker = new CollectorSchedulerStateRepository(prisma as never);

    let releaseRunOnce!: (value: CollectorRunOnceResult) => void;
    let signalRunOnceEntered!: () => void;
    const runOnceEntered = new Promise<void>((resolve) => {
      signalRunOnceEntered = resolve;
    });
    const runOnceHeld = new Promise<CollectorRunOnceResult>((resolve) => {
      releaseRunOnce = resolve;
    });

    const runOnce = vi.fn(async () => {
      signalRunOnceEntered();
      return runOnceHeld;
    });
    const getQueueCounts = vi.fn(async () => ({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
    }));

    const winnerService = buildService({
      config,
      schedulerState: repoWinner,
      runOnce: runOnce as unknown as PopulationCollectorService['runOnce'],
      getQueueCounts: getQueueCounts as unknown as MatchIngestionProducer['getQueueCounts'],
    });

    const tickPromise = winnerService.tick();
    await runOnceEntered;

    const held = await readRaw();
    expect(held.leaseOwner).not.toBeNull();
    const staleOwner = held.leaseOwner!;

    // Force expiry + takeover by another replica while runOnce is in flight.
    await prisma.collectorSchedulerState.update({
      where: { id: SINGLETON_ID },
      data: { leaseExpiresAt: new Date(Date.now() - 5_000) },
    });
    expect(await repoTaker.tryAcquireLease('owner-takeover', config.schedulerLeaseMs)).toBe(
      true,
    );
    expect(
      await repoTaker.recordOutcome(
        'owner-takeover',
        CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE,
        'TAKEN_OVER',
      ),
    ).toBe(true);

    const afterTakeover = await readRaw();
    expect(afterTakeover.leaseOwner).toBe('owner-takeover');
    expect(afterTakeover.lastOutcome).toBe(CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE);
    expect(afterTakeover.lastErrorCode).toBe('TAKEN_OVER');
    expect(afterTakeover.lastCollectorRunId).toBeNull();

    releaseRunOnce(runResult({ runId: 'run-stale-should-not-write' }));
    const localResult = await tickPromise;

    expect(localResult).toEqual({
      outcome: 'TRIGGERED',
      collectorRunId: 'run-stale-should-not-write',
      errorCode: 'OWNERSHIP_LOST',
    });

    // Stale owner-protected mutations must not clobber takeover state.
    expect(await repoWinner.recordTrigger(staleOwner, 'run-stale-should-not-write')).toBe(
      false,
    );
    expect(
      await repoWinner.recordOutcome(staleOwner, CollectorSchedulerOutcome.TRIGGERED),
    ).toBe(false);
    expect(
      await repoWinner.setCooldown(staleOwner, new Date(Date.now() + 60_000)),
    ).toBe(false);
    expect(await repoWinner.releaseLease(staleOwner)).toBe(false);

    const finalState = await readRaw();
    expect(finalState.leaseOwner).toBe('owner-takeover');
    expect(finalState.leaseExpiresAt).not.toBeNull();
    expect(finalState.lastOutcome).toBe(CollectorSchedulerOutcome.SKIPPED_BACKPRESSURE);
    expect(finalState.lastErrorCode).toBe('TAKEN_OVER');
    expect(finalState.lastCollectorRunId).toBeNull();
    expect(finalState.cooldownUntil).toBeNull();

    // Cleanup: current owner releases so later tests start clean.
    expect(await repoTaker.releaseLease('owner-takeover')).toBe(true);
  });
});
