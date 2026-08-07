import { describe, expect, it } from 'vitest';
import type { CollectorSchedulerState } from '@prisma/client';
import { loadCollectorConfig } from './collector.config';
import type {
  CollectorCoverageSnapshot,
  CollectorRunOnceResult,
  CoverageSnapshotStatus,
  SchedulerTickOutcome,
} from './collector.types';
import {
  buildCollectorApplyReport,
  buildCollectorSchedulerStatusReport,
  buildSchedulerTriggerReport,
  formatSchedulerStatusText,
  isSchedulerCooldownActive,
  isSchedulerLeaseOwnerPresent,
  resolveCollectorRunExitCode,
  resolveSchedulerTriggerExitCode,
} from './collector-cli.output';

function zeroCounters(): CollectorRunOnceResult['counters'] {
  return {
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
  };
}

function runResult(
  status: Exclude<CollectorRunOnceResult['status'], never>,
): CollectorRunOnceResult {
  return {
    runId: 'run-1',
    ownerToken: 'token-1',
    status,
    effectivePlatforms: ['na1'],
    queueId: 420,
    batchLimit: 10,
    concurrency: 2,
    durationMs: 100,
    counters: zeroCounters(),
  };
}

function coverageSnapshot(status: CoverageSnapshotStatus): CollectorCoverageSnapshot {
  return {
    status,
    label: 'db_snapshot',
    queueId: 420,
    sourceNormalizationVersion: 'norm-v1',
    aggregationVersion: 'agg-v1',
    minimumSample: 30,
    nearFloorBand: { min: 20, max: 29 },
    platforms: [],
    ...(status !== 'available' ? { warning: `${status} coverage` } : {}),
  };
}

describe('resolveCollectorRunExitCode', () => {
  it('returns 0 only for COMPLETED', () => {
    expect(resolveCollectorRunExitCode('COMPLETED')).toBe(0);
    expect(resolveCollectorRunExitCode('PARTIAL')).toBe(1);
    expect(resolveCollectorRunExitCode('FAILED')).toBe(1);
  });
});

describe('buildCollectorApplyReport', () => {
  it('keeps COMPLETED run success when coverage is unavailable', () => {
    const result = runResult('COMPLETED');
    const coverage = coverageSnapshot('unavailable');
    const report = buildCollectorApplyReport(result, coverage);

    expect(resolveCollectorRunExitCode(report.status)).toBe(0);
    expect(report.status).toBe('COMPLETED');
    expect(report.ok).toBe(true);
    expect(report.coverage.status).toBe('unavailable');
    expect(report.coverageWarning).toMatch(/unavailable/i);
  });

  it('keeps COMPLETED run success when coverage is partial', () => {
    const result = runResult('COMPLETED');
    const coverage = coverageSnapshot('partial');
    const report = buildCollectorApplyReport(result, coverage);

    expect(resolveCollectorRunExitCode(report.status)).toBe(0);
    expect(report.status).toBe('COMPLETED');
    expect(report.ok).toBe(true);
    expect(report.coverage.status).toBe('partial');
    expect(report.coverageWarning).toMatch(/partial/i);
  });

  it('keeps PARTIAL run failure when coverage is available', () => {
    const result = runResult('PARTIAL');
    const coverage = coverageSnapshot('available');
    const report = buildCollectorApplyReport(result, coverage);

    expect(resolveCollectorRunExitCode(report.status)).toBe(1);
    expect(report.status).toBe('PARTIAL');
    expect(report.ok).toBe(false);
    expect(report.coverage.status).toBe('available');
    expect(report.coverageWarning).toBeUndefined();
  });
});

describe('resolveSchedulerTriggerExitCode', () => {
  it('maps skip/trigger outcomes to 0 and FAILED_TO_START to 1', () => {
    const zeroOutcomes: SchedulerTickOutcome[] = [
      'TRIGGERED',
      'SKIPPED_DISABLED',
      'SKIPPED_OVERLAP',
      'SKIPPED_BACKPRESSURE',
      'SKIPPED_COOLDOWN',
    ];
    for (const outcome of zeroOutcomes) {
      expect(resolveSchedulerTriggerExitCode(outcome)).toBe(0);
    }
    expect(resolveSchedulerTriggerExitCode('FAILED_TO_START')).toBe(1);
  });
});

describe('buildSchedulerTriggerReport', () => {
  it('marks FAILED_TO_START as not ok', () => {
    expect(buildSchedulerTriggerReport({ outcome: 'TRIGGERED', collectorRunId: 'run-1' })).toEqual(
      {
        ok: true,
        mode: 'scheduler-trigger',
        outcome: 'TRIGGERED',
        collectorRunId: 'run-1',
      },
    );
    expect(
      buildSchedulerTriggerReport({
        outcome: 'FAILED_TO_START',
        errorCode: 'RUN_ONCE_START_FAILED',
      }),
    ).toEqual({
      ok: false,
      mode: 'scheduler-trigger',
      outcome: 'FAILED_TO_START',
      errorCode: 'RUN_ONCE_START_FAILED',
    });
  });
});

describe('scheduler status formatting helpers', () => {
  it('treats empty/null lease owner as ABSENT', () => {
    expect(isSchedulerLeaseOwnerPresent(null)).toBe(false);
    expect(isSchedulerLeaseOwnerPresent(undefined)).toBe(false);
    expect(isSchedulerLeaseOwnerPresent('')).toBe(false);
    expect(isSchedulerLeaseOwnerPresent('owner-uuid')).toBe(true);
  });

  it('computes cooldownActive against now', () => {
    const now = new Date('2026-08-07T12:00:00.000Z');
    expect(isSchedulerCooldownActive(null, now)).toBe(false);
    expect(isSchedulerCooldownActive(new Date('2026-08-07T11:59:59.000Z'), now)).toBe(false);
    expect(isSchedulerCooldownActive(new Date('2026-08-07T12:00:01.000Z'), now)).toBe(true);
  });

  it('builds status with PRESENT/ABSENT and no raw owner UUID', () => {
    const now = new Date('2026-08-07T12:00:00.000Z');
    const config = loadCollectorConfig({});
    const state = {
      id: 'singleton',
      leaseOwner: 'secret-owner-uuid',
      leaseExpiresAt: new Date('2026-08-07T13:00:00.000Z'),
      lastTriggerAt: new Date('2026-08-07T11:00:00.000Z'),
      lastOutcome: 'TRIGGERED',
      lastCollectorRunId: 'run-abc',
      lastErrorCode: null,
      cooldownUntil: new Date('2026-08-07T12:30:00.000Z'),
      createdAt: now,
      updatedAt: now,
    } as CollectorSchedulerState;

    const report = buildCollectorSchedulerStatusReport({
      config,
      enabled: false,
      state,
      now,
    });

    expect(report.enabled).toBe(false);
    expect(report.leaseOwnerPresent).toBe(true);
    expect(report.cooldownActive).toBe(true);
    expect(report.lastOutcome).toBe('TRIGGERED');
    expect(JSON.stringify(report)).not.toContain('secret-owner-uuid');

    const lines = formatSchedulerStatusText(report);
    expect(lines.some((line) => line.includes('leaseOwner=PRESENT'))).toBe(true);
    expect(lines.some((line) => line.includes('cooldownActive=true'))).toBe(true);
    expect(lines.join('\n')).not.toContain('secret-owner-uuid');
  });

  it('formats ABSENT when lease owner missing', () => {
    const report = buildCollectorSchedulerStatusReport({
      config: loadCollectorConfig({}),
      enabled: true,
      state: null,
      now: new Date('2026-08-07T12:00:00.000Z'),
    });
    expect(report.leaseOwnerPresent).toBe(false);
    expect(report.cooldownActive).toBe(false);
    expect(formatSchedulerStatusText(report).join('\n')).toContain('leaseOwner=ABSENT');
  });
});
