import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectorRunStatus, type CollectorRun } from '@prisma/client';
import type { CollectorConfig } from './collector.config';
import { CollectorAuditService } from './collector-audit.service';
import type { CollectorRunRepository } from './collector-run.repository';
import type { PrismaService } from '../../prisma/prisma.service';

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

function finalizedRun(overrides: Partial<CollectorRun> = {}): CollectorRun {
  return {
    id: 'run-ok',
    ownerToken: 'owner-token-aaaaaaaa',
    status: CollectorRunStatus.COMPLETED,
    startedAt: new Date('2026-08-01T00:00:00.000Z'),
    finishedAt: new Date('2026-08-01T00:10:00.000Z'),
    platformFilter: null,
    effectivePlatforms: ['na1'],
    queueId: 420,
    batchLimit: 10,
    concurrency: 2,
    playersClaimed: 2,
    playersAttempted: 2,
    playersSucceeded: 1,
    playersFailed: 1,
    ownershipLost: 0,
    matchIdsDiscovered: 10,
    matchesEnqueued: 4,
    matchesSkippedComplete: 6,
    rateLimitStops: 0,
    budgetExhausted: false,
    failureCode: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:10:00.000Z'),
    ...overrides,
  };
}

describe('CollectorAuditService', () => {
  let prisma: {
    trackedPlayer: {
      groupBy: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    collectorRun: {
      findMany: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let runs: { findStaleRunning: ReturnType<typeof vi.fn> };
  let service: CollectorAuditService;

  function wireCleanMocks(): void {
    prisma.trackedPlayer.groupBy.mockResolvedValue([]);
    prisma.trackedPlayer.findMany.mockResolvedValue([]);
    prisma.collectorRun.findMany.mockImplementation(
      async (args: { where?: { status?: unknown } }) => {
        if (
          args?.where &&
          typeof args.where === 'object' &&
          'status' in args.where &&
          args.where.status === 'RUNNING'
        ) {
          return [];
        }
        return [finalizedRun()];
      },
    );
    prisma.$queryRaw.mockResolvedValue([]);
    runs.findStaleRunning.mockResolvedValue([]);
  }

  beforeEach(() => {
    prisma = {
      trackedPlayer: {
        groupBy: vi.fn(),
        findMany: vi.fn(),
      },
      collectorRun: {
        findMany: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };
    runs = {
      findStaleRunning: vi.fn(),
    };
    wireCleanMocks();
    service = CollectorAuditService.create({
      prisma: prisma as unknown as PrismaService,
      runs: runs as unknown as CollectorRunRepository,
      config: baseConfig(),
    });
  });

  it('returns clean audit with no findings', async () => {
    const report = await service.audit();

    expect(report.ok).toBe(true);
    expect(report.mode).toBe('audit');
    expect(report.findingCount).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it('flags finalized counter inequality', async () => {
    prisma.collectorRun.findMany.mockImplementation(
      async (args: { where?: { status?: unknown } }) => {
        if (
          args?.where &&
          typeof args.where === 'object' &&
          'status' in args.where &&
          args.where.status === 'RUNNING'
        ) {
          return [];
        }
        return [
          finalizedRun({
            id: 'run-bad-counters',
            playersAttempted: 5,
            playersSucceeded: 1,
            playersFailed: 1,
            ownershipLost: 0,
          }),
        ];
      },
    );

    const report = await service.audit();
    const codes = report.findings.map((f) => f.code);

    expect(report.ok).toBe(false);
    expect(codes).toContain('FINALIZED_COUNTER_MISMATCH');
    expect(report.findings.find((f) => f.code === 'FINALIZED_COUNTER_MISMATCH')).toMatchObject({
      severity: 'error',
      safeId: 'run-bad-counters',
    });
  });

  it('uses staleRunAfterMs not leaseDurationMs for stale RUNNING findings', async () => {
    const config = baseConfig({
      staleRunAfterMs: 7_200_000,
      leaseDurationMs: 900_000,
    });
    runs.findStaleRunning.mockResolvedValue([
      finalizedRun({
        id: 'run-stale',
        status: CollectorRunStatus.RUNNING,
        finishedAt: null,
        ownerToken: 'running-token-bbbbbbbb',
      }),
    ]);
    service = CollectorAuditService.create({
      prisma: prisma as unknown as PrismaService,
      runs: runs as unknown as CollectorRunRepository,
      config,
    });

    const report = await service.audit();

    expect(runs.findStaleRunning).toHaveBeenCalledWith(7_200_000);
    expect(runs.findStaleRunning).not.toHaveBeenCalledWith(900_000);
    expect(report.findings.some((f) => f.code === 'STALE_RUNNING_COLLECTOR_RUN')).toBe(true);
    expect(
      report.findings.find((f) => f.code === 'STALE_RUNNING_COLLECTOR_RUN')?.message,
    ).toContain('staleRunAfterMs=7200000');
    expect(
      report.findings.find((f) => f.code === 'STALE_RUNNING_COLLECTOR_RUN')?.message,
    ).toContain('not leaseDurationMs');
  });

  it('flags orphan active leases and leftover leases owned by finalized runs', async () => {
    const future = new Date(Date.now() + 60_000);
    prisma.trackedPlayer.findMany.mockResolvedValue([
      {
        id: 'tp-orphan',
        leaseOwner: 'orphan-token-cccccccc',
        leaseExpiresAt: future,
        platformRoute: 'na1',
      },
      {
        id: 'tp-leftover',
        leaseOwner: 'owner-token-aaaaaaaa',
        leaseExpiresAt: future,
        platformRoute: 'na1',
      },
    ]);
    prisma.collectorRun.findMany.mockImplementation(
      async (args: { where?: { status?: unknown } }) => {
        if (
          args?.where &&
          typeof args.where === 'object' &&
          'status' in args.where &&
          args.where.status === 'RUNNING'
        ) {
          return [{ id: 'run-live', ownerToken: 'different-running-token' }];
        }
        return [finalizedRun({ id: 'run-final', ownerToken: 'owner-token-aaaaaaaa' })];
      },
    );

    const report = await service.audit();
    const byCode = Object.fromEntries(report.findings.map((f) => [f.code, f]));

    expect(byCode.ORPHAN_LEASE_OWNER).toMatchObject({
      safeId: 'tp-orphan',
      severity: 'error',
    });
    expect(byCode.LEFTOVER_LEASE_FINALIZED_OWNER).toMatchObject({
      safeId: 'tp-leftover',
      severity: 'error',
    });
    expect(byCode.ORPHAN_LEASE_OWNER.message).toContain('prefix=orphan-t');
    expect(JSON.stringify(report)).not.toMatch(/puuid/i);
  });

  it('emits safe finding fields without puuid and reports unsafe timing config', async () => {
    service = CollectorAuditService.create({
      prisma: prisma as unknown as PrismaService,
      runs: runs as unknown as CollectorRunRepository,
      config: baseConfig({
        playerTimeoutMs: 10 * 60_000,
        leaseDurationMs: 10 * 60_000,
        staleRunAfterMs: 10 * 60_000,
      }),
    });

    const report = await service.audit();
    const serialized = JSON.stringify(report);

    expect(report.findings.some((f) => f.code === 'UNSAFE_TIMING_CONFIG')).toBe(true);
    for (const finding of report.findings) {
      expect(finding).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          severity: expect.stringMatching(/^(error|warning|info)$/),
          safeId: expect.any(String),
          message: expect.any(String),
        }),
      );
      expect(finding).not.toHaveProperty('puuid');
      expect(finding.safeId).not.toMatch(/puuid/i);
      expect(finding.message).not.toMatch(/puuid/i);
    }
    expect(serialized).not.toMatch(/puuid/i);
  });

  it('flags playersAttempted > claimed and match counter overshoots', async () => {
    prisma.collectorRun.findMany.mockImplementation(
      async (args: { where?: { status?: unknown } }) => {
        if (
          args?.where &&
          typeof args.where === 'object' &&
          'status' in args.where &&
          args.where.status === 'RUNNING'
        ) {
          return [];
        }
        return [
          finalizedRun({
            id: 'run-overshoot',
            playersClaimed: 1,
            playersAttempted: 2,
            playersSucceeded: 1,
            playersFailed: 1,
            ownershipLost: 0,
            matchIdsDiscovered: 2,
            matchesEnqueued: 5,
            matchesSkippedComplete: 4,
          }),
        ];
      },
    );

    const report = await service.audit();
    const codes = new Set(report.findings.map((f) => f.code));

    expect(codes.has('PLAYERS_ATTEMPTED_EXCEEDS_CLAIMED')).toBe(true);
    expect(codes.has('MATCHES_ENQUEUED_EXCEEDS_DISCOVERED')).toBe(true);
    expect(codes.has('MATCHES_SKIPPED_COMPLETE_EXCEEDS_DISCOVERED')).toBe(true);
  });
});
