import { describe, expect, it } from 'vitest';
import type { CollectorSchedulerState } from '@prisma/client';
import { loadCollectorConfig } from './collector.config';
import type {
  CollectorCoverageReport,
  CollectorCoverageSnapshot,
  CollectorRunOnceResult,
  CoverageSnapshotStatus,
  SchedulerTickOutcome,
} from './collector.types';
import {
  buildCollectorApplyReport,
  buildCollectorSchedulerStatusReport,
  buildSchedulerTriggerReport,
  formatCoverageReportText,
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

describe('formatCoverageReportText', () => {
  function coverageReport(): CollectorCoverageReport {
    return {
      ok: true,
      mode: 'coverage',
      generatedAt: '2026-08-10T00:00:00.000Z',
      label: 'population_coverage_observability',
      queueId: 420,
      effectivePlatforms: ['na1'],
      trackedPlayers: {
        total: 5,
        byEnrollmentSource: {
          ADMIN_SEED: 2,
          PRODUCT_SEARCH: 0,
          BOOTSTRAP: 0,
          LADDER: 0,
          MATCH_PARTICIPANT: 3,
        },
        byPlatformRoute: { na1: 5 },
        byDiscoveryDepth: { '0': 2, '1': 3 },
        byStatus: { ACTIVE: 5 },
      },
      capUsage: {
        matchParticipant: { used: 3, cap: 500, remaining: 497 },
        ladder: { used: 0, cap: 1500, remaining: 1500 },
        totalTracked: { used: 5, cap: 5000, remaining: 4995 },
      },
      activitySignals: {
        status: 'partial',
        note: 'test note',
        coldAfterZeroNewRuns: 3,
        activePlayers: 5,
        neverSuccessfulRefresh: 1,
        zeroNewStreakAtOrAboveCold: 0,
        byConsecutiveZeroNewMatchRuns: { '0': 4, '1': 1 },
      },
      championCoverage: {
        densityThresholds: { gte1: 1, gte30: 30, gte100: 100 },
        minimumSampleRankingFloor: 30,
        nearFloorBand: { min: 20, max: 29 },
        sourceNormalizationVersion: 'norm-v1',
        aggregationVersion: 'agg-v1',
        positions: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'],
        platforms: [
          {
            platform: 'na1',
            semanticPatch: '15.14',
            matchCounts: { queueTotal: 10, currentPatchNormalized: 2 },
            density: {
              championPositionKeysGte1: 19,
              championPositionKeysGte30: 0,
              championPositionKeysGte100: 0,
            },
            byPosition: [
              { position: 'TOP', gte1: 4, gte30: 0, gte100: 0, maxSampleSize: 6 },
              { position: 'JUNGLE', gte1: 4, gte30: 0, gte100: 0, maxSampleSize: 5 },
              { position: 'MIDDLE', gte1: 4, gte30: 0, gte100: 0, maxSampleSize: 7 },
              { position: 'BOTTOM', gte1: 4, gte30: 0, gte100: 0, maxSampleSize: 4 },
              { position: 'SUPPORT', gte1: 3, gte30: 0, gte100: 0, maxSampleSize: 3 },
            ],
            sampleSizeHistogram: [
              { bucket: '1-2', count: 10 },
              { bucket: '3-9', count: 9 },
              { bucket: '10-29', count: 0 },
              { bucket: '30-99', count: 0 },
              { bucket: '100+', count: 0 },
            ],
            classicZero: {
              rosterSource: 'ChampionStaticData_public',
              rosterNote: 'public roster',
              status: 'available',
              staticDataPatchVersion: '15.14.1',
              totalRosterChampions: 170,
              championsWithZeroQualifyingCoverage: 151,
            },
            ladderRepresentation: {
              status: 'partial',
              ladderPlayersByTier: {},
              ladderPlayersMissingRankSnapshot: 0,
              currentPatchQueueParticipantObservationsByTier: null,
              currentPatchQueueMatchesByTier: {
                status: 'unavailable',
                reason: 'ambiguous',
              },
              championPositionKeysByExactTierGte1: null,
              reviewFlags: [],
            },
          },
        ],
      },
      densitySnapshot: coverageSnapshot('available'),
      reviewFlags: [],
      warnings: [],
    };
  }

  it('renders human-readable coverage lines and round-trips JSON shape', () => {
    const report = coverageReport();
    const json = JSON.parse(JSON.stringify(report)) as CollectorCoverageReport;
    expect(json.mode).toBe('coverage');
    expect(json.trackedPlayers.total).toBe(5);
    expect(json.championCoverage.platforms[0]?.density.championPositionKeysGte1).toBe(19);

    const text = formatCoverageReportText(report).join('\n');
    expect(text).toContain('collector:coverage');
    expect(text).toContain('density gte1=19 gte30=0 gte100=0');
    expect(text).toContain('byEnrollmentSource=');
    expect(text).not.toMatch(/puuid/i);
    expect(text).not.toContain('RIOT_API_KEY');
  });
});
