import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorRunStatus, type CollectorRun } from '@prisma/client';
import type { CollectorConfig } from './collector.config';
import type { CollectorCoverageService } from './collector-coverage.service';
import type { CollectorRunRepository } from './collector-run.repository';
import { CollectorStatusService } from './collector-status.service';
import type { TrackedPlayerRepository } from './tracked-player.repository';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CollectorCoverageSnapshot } from './collector.types';

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

function runRow(overrides: Partial<CollectorRun> = {}): CollectorRun {
  return {
    id: 'run-1',
    ownerToken: 'secret-owner-token-should-not-leak',
    status: CollectorRunStatus.RUNNING,
    startedAt: new Date('2026-08-01T00:00:00.000Z'),
    finishedAt: null,
    platformFilter: null,
    effectivePlatforms: ['na1'],
    queueId: 420,
    batchLimit: 10,
    concurrency: 2,
    playersClaimed: 1,
    playersAttempted: 1,
    playersSucceeded: 1,
    playersFailed: 0,
    ownershipLost: 0,
    matchIdsDiscovered: 5,
    matchesEnqueued: 3,
    matchesSkippedComplete: 2,
    rateLimitStops: 0,
    budgetExhausted: false,
    failureCode: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

function coverageSnapshot(
  overrides: Partial<CollectorCoverageSnapshot> = {},
): CollectorCoverageSnapshot {
  return {
    status: 'available',
    label: 'db_snapshot',
    queueId: 420,
    sourceNormalizationVersion: 'norm-v1',
    aggregationVersion: 'agg-v1',
    minimumSample: 30,
    nearFloorBand: { min: 20, max: 29 },
    platforms: [],
    ...overrides,
  };
}

describe('CollectorStatusService', () => {
  let prisma: {
    collectorRun: { findMany: ReturnType<typeof vi.fn> };
    trackedPlayer: {
      groupBy: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
    };
  };
  let runs: { findStaleRunning: ReturnType<typeof vi.fn> };
  let trackedPlayers: { countEligible: ReturnType<typeof vi.fn> };
  let coverage: { snapshotSafe: ReturnType<typeof vi.fn> };
  let service: CollectorStatusService;

  beforeEach(() => {
    prisma = {
      collectorRun: {
        findMany: vi.fn().mockImplementation(async (args: { where?: { status?: unknown } }) => {
          if (args?.where && 'status' in (args.where ?? {}) && args.where.status === 'RUNNING') {
            return [runRow()];
          }
          return [
            runRow({
              id: 'run-final',
              status: CollectorRunStatus.COMPLETED,
              finishedAt: new Date('2026-08-01T01:00:00.000Z'),
              ownerToken: 'final-token',
            }),
          ];
        }),
      },
      trackedPlayer: {
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([{ status: 'ACTIVE', _count: { _all: 3 } }])
          .mockResolvedValueOnce([{ platformRoute: 'na1', _count: { _all: 3 } }])
          .mockResolvedValueOnce([{ enrollmentSource: 'ADMIN_SEED', _count: { _all: 3 } }])
          .mockResolvedValueOnce([{ lastFailureCode: 'RIOT_RATE_LIMITED', _count: { _all: 1 } }]),
        count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
        aggregate: vi.fn().mockResolvedValue({
          _min: { nextEligibleAt: new Date('2026-08-07T00:00:00.000Z') },
        }),
      },
    };
    runs = {
      findStaleRunning: vi.fn().mockResolvedValue([
        runRow({
          id: 'run-stale',
          startedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      ]),
    };
    trackedPlayers = {
      countEligible: vi.fn().mockResolvedValue(2),
    };
    coverage = {
      snapshotSafe: vi.fn().mockResolvedValue(coverageSnapshot()),
    };
    service = CollectorStatusService.create({
      prisma: prisma as unknown as PrismaService,
      runs: runs as unknown as CollectorRunRepository,
      trackedPlayers: trackedPlayers as unknown as TrackedPlayerRepository,
      coverage: coverage as unknown as CollectorCoverageService,
      config: baseConfig(),
    });
  });

  it('builds status report structure with run/population/coverage sections', async () => {
    const report = await service.report({ queueId: 420 });

    expect(report.ok).toBe(true);
    expect(report.mode).toBe('status');
    expect(report.label).toBe('discovery_enqueue_orchestration');
    expect(report.runState.activeRunning).toHaveLength(1);
    expect(report.runState.staleRunning).toHaveLength(1);
    expect(report.runState.recentFinalized).toHaveLength(1);
    expect(report.runState.activeRunning[0]).toMatchObject({
      runId: 'run-1',
      status: 'RUNNING',
      startedAt: '2026-08-01T00:00:00.000Z',
      finishedAt: null,
      queueId: 420,
    });
    expect(report.trackedPopulation).toMatchObject({
      byStatus: { ACTIVE: 3 },
      byPlatform: { na1: 3 },
      byEnrollmentSource: { ADMIN_SEED: 3 },
      eligibleNow: 2,
      activelyLeased: 1,
      expiredLeases: 0,
      nextEligibleAt: '2026-08-07T00:00:00.000Z',
      recentFailureCodes: [{ code: 'RIOT_RATE_LIMITED', count: 1 }],
    });
    expect(report.coverage?.status).toBe('available');
    expect(report.warnings.some((w) => w.includes('staleRunAfterMs'))).toBe(true);
  });

  it('uses staleRunAfterMs not leaseDurationMs for stale RUNNING detection', async () => {
    const config = baseConfig({
      staleRunAfterMs: 7_200_000,
      leaseDurationMs: 900_000,
    });
    service = CollectorStatusService.create({
      prisma: prisma as unknown as PrismaService,
      runs: runs as unknown as CollectorRunRepository,
      trackedPlayers: trackedPlayers as unknown as TrackedPlayerRepository,
      coverage: coverage as unknown as CollectorCoverageService,
      config,
    });

    await service.report();

    expect(runs.findStaleRunning).toHaveBeenCalledTimes(1);
    expect(runs.findStaleRunning).toHaveBeenCalledWith(7_200_000);
    expect(runs.findStaleRunning).not.toHaveBeenCalledWith(900_000);
  });

  it('treats coverage failures as warnings only and never exposes ownerToken/puuid', async () => {
    coverage.snapshotSafe.mockResolvedValue(
      coverageSnapshot({
        status: 'unavailable',
        warning: 'aggregate read failed',
      }),
    );

    const report = await service.report();
    const serialized = JSON.stringify(report);

    expect(report.coverage?.status).toBe('unavailable');
    expect(report.warnings.some((w) => w.includes('coverage'))).toBe(true);
    expect(serialized).not.toMatch(/puuid/i);
    expect(serialized).not.toContain('secret-owner-token-should-not-leak');
    expect(serialized).not.toContain('ownerToken');
  });

  it('skips coverage when includeCoverage is false', async () => {
    const report = await service.report({ includeCoverage: false });
    expect(report.coverage).toBeNull();
    expect(coverage.snapshotSafe).not.toHaveBeenCalled();
  });
});
