import { describe, expect, it } from 'vitest';
import type {
  CollectorCoverageSnapshot,
  CollectorRunOnceResult,
  CoverageSnapshotStatus,
} from './collector.types';
import {
  buildCollectorApplyReport,
  resolveCollectorRunExitCode,
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
