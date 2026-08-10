import type { CollectorRunStatus, CollectorSchedulerState } from '@prisma/client';
import type { CollectorConfig } from './collector.config';
import type {
  CollectorCoverageReport,
  CollectorCoverageSnapshot,
  CollectorRunCounters,
  CollectorRunOnceResult,
  CollectorSchedulerStatusReport,
  CollectorSchedulerTriggerReport,
  SchedulerTickOutcome,
  SchedulerTickResult,
} from './collector.types';

export type CollectorApplyReport = {
  ok: boolean;
  mode: 'apply';
  runId: string;
  status: Exclude<CollectorRunStatus, 'RUNNING'>;
  effectivePlatforms: string[];
  queueId: number;
  batchLimit: number;
  concurrency: number;
  durationMs: number;
  counters: CollectorRunCounters;
  coverage: CollectorCoverageSnapshot;
  coverageWarning?: string;
};

export function resolveCollectorRunExitCode(
  status: Exclude<CollectorRunStatus, 'RUNNING'>,
): 0 | 1 {
  return status === 'COMPLETED' ? 0 : 1;
}

export function buildCollectorApplyReport(
  result: CollectorRunOnceResult,
  coverage: CollectorCoverageSnapshot,
): CollectorApplyReport {
  return {
    ok: result.status === 'COMPLETED',
    mode: 'apply',
    runId: result.runId,
    status: result.status,
    effectivePlatforms: result.effectivePlatforms,
    queueId: result.queueId,
    batchLimit: result.batchLimit,
    concurrency: result.concurrency,
    durationMs: result.durationMs,
    counters: result.counters,
    coverage,
    ...(coverage.status !== 'available'
      ? { coverageWarning: formatCoverageWarningLines(coverage).join(' ') || undefined }
      : {}),
  };
}

export function formatCoverageWarningLines(snapshot: CollectorCoverageSnapshot): string[] {
  if (snapshot.status === 'available') {
    return [];
  }
  const detail = snapshot.warning ? `: ${snapshot.warning}` : '';
  return [`coverage warning (${snapshot.status})${detail}`];
}

export function formatCoverageTextLines(snapshot: CollectorCoverageSnapshot): string[] {
  const lines = [
    `coverage status=${snapshot.status} label=${snapshot.label} queue=${snapshot.queueId} minSample=${snapshot.minimumSample}`,
    `coverage nearFloor=${snapshot.nearFloorBand.min}..${snapshot.nearFloorBand.max} versions=${snapshot.sourceNormalizationVersion}/${snapshot.aggregationVersion}`,
  ];

  for (const platform of snapshot.platforms) {
    lines.push(`coverage platform=${platform.platform} patch=${platform.patch ?? 'none'}`);
    for (const position of platform.positions) {
      lines.push(
        `coverage position=${position.position} maxSample=${position.maxSampleSize} gt0=${position.keysWithSampleGtZero} atFloor=${position.keysAtOrAboveFloor} nearFloor=${position.keysInNearFloorBand}`,
      );
    }
    for (const row of platform.matchCountsByNormalizedPatch) {
      lines.push(`coverage storedMatches patch=${row.patch ?? 'null'} count=${row.count}`);
    }
  }

  lines.push(...formatCoverageWarningLines(snapshot));
  return lines;
}

export function formatCoverageReportText(report: CollectorCoverageReport): string[] {
  const pop = report.trackedPlayers;
  const caps = report.capUsage;
  const lines = [
    'collector:coverage (read-only population / champion coverage observability)',
    `generatedAt=${report.generatedAt}`,
    `queue=${report.queueId} platforms=${report.effectivePlatforms.join(',') || 'none'}`,
    '',
    '## Tracked players',
    `total=${pop.total}`,
    `byEnrollmentSource=${JSON.stringify(pop.byEnrollmentSource)}`,
    `byPlatformRoute=${JSON.stringify(pop.byPlatformRoute)}`,
    `byDiscoveryDepth=${JSON.stringify(pop.byDiscoveryDepth)}`,
    `byStatus=${JSON.stringify(pop.byStatus)}`,
    '',
    '## Cap usage',
    `matchParticipant=${caps.matchParticipant.used}/${caps.matchParticipant.cap} remaining=${caps.matchParticipant.remaining}`,
    `ladder=${caps.ladder.used}/${caps.ladder.cap} remaining=${caps.ladder.remaining}`,
    `totalTracked=${caps.totalTracked.used}/${caps.totalTracked.cap} remaining=${caps.totalTracked.remaining}`,
    '',
    '## Activity signals (partial)',
    `activePlayers=${report.activitySignals.activePlayers}`,
    `neverSuccessfulRefresh=${report.activitySignals.neverSuccessfulRefresh}`,
    `zeroNewStreakAtOrAboveCold=${report.activitySignals.zeroNewStreakAtOrAboveCold} (coldAfter=${report.activitySignals.coldAfterZeroNewRuns})`,
    `byConsecutiveZeroNewMatchRuns=${JSON.stringify(report.activitySignals.byConsecutiveZeroNewMatchRuns)}`,
    `note=${report.activitySignals.note}`,
    '',
    '## Champion coverage',
    `densityThresholds=${JSON.stringify(report.championCoverage.densityThresholds)}`,
    `minimumSampleRankingFloor=${report.championCoverage.minimumSampleRankingFloor}`,
    `versions=${report.championCoverage.sourceNormalizationVersion}/${report.championCoverage.aggregationVersion}`,
    `positions=${report.championCoverage.positions.join(',')}`,
  ];

  for (const platform of report.championCoverage.platforms) {
    lines.push('');
    lines.push(`### platform=${platform.platform} semanticPatch=${platform.semanticPatch ?? 'none'}`);
    lines.push(
      `matches queueTotal=${platform.matchCounts.queueTotal} currentPatchNormalized=${platform.matchCounts.currentPatchNormalized ?? 'n/a'}`,
    );
    lines.push(
      `density gte1=${platform.density.championPositionKeysGte1} gte30=${platform.density.championPositionKeysGte30} gte100=${platform.density.championPositionKeysGte100}`,
    );
    for (const position of platform.byPosition) {
      lines.push(
        `position=${position.position} gte1=${position.gte1} gte30=${position.gte30} gte100=${position.gte100} maxSample=${position.maxSampleSize}`,
      );
    }
    lines.push(`sampleSizeHistogram=${JSON.stringify(platform.sampleSizeHistogram)}`);
    lines.push(
      `classicZero status=${platform.classicZero.status} roster=${platform.classicZero.totalRosterChampions ?? 'n/a'} zeroCoverage=${platform.classicZero.championsWithZeroQualifyingCoverage ?? 'n/a'} staticPatch=${platform.classicZero.staticDataPatchVersion ?? 'n/a'}`,
    );
    lines.push(`classicZeroNote=${platform.classicZero.rosterNote}`);

    const ladder = platform.ladderRepresentation;
    lines.push(`ladderRepresentation status=${ladder.status}`);
    lines.push(`ladderPlayersByTier=${JSON.stringify(ladder.ladderPlayersByTier)}`);
    lines.push(
      `ladderPlayersMissingRankSnapshot=${ladder.ladderPlayersMissingRankSnapshot ?? 'n/a'}`,
    );
    lines.push(
      `participantObservationsByTier=${JSON.stringify(ladder.currentPatchQueueParticipantObservationsByTier)}`,
    );
    lines.push(
      `matchesByTier=${ladder.currentPatchQueueMatchesByTier.status}: ${ladder.currentPatchQueueMatchesByTier.reason}`,
    );
    lines.push(
      `exactTierAggregateKeysGte1=${JSON.stringify(ladder.championPositionKeysByExactTierGte1)}`,
    );
    for (const flag of ladder.reviewFlags) {
      lines.push(`ladderReviewFlag ${flag}`);
    }
  }

  if (report.reviewFlags.length > 0) {
    lines.push('', '## Review flags');
    for (const flag of report.reviewFlags) {
      lines.push(`reviewFlag ${flag}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings');
    for (const warning of report.warnings) {
      lines.push(`warning ${warning}`);
    }
  }

  lines.push('', '## Legacy density snapshot');
  lines.push(...formatCoverageTextLines(report.densitySnapshot));
  return lines;
}

/**
 * Exit codes for collector:scheduler-trigger (user-locked).
 * Skips (including disabled/overlap/backpressure/cooldown) → 0.
 * FAILED_TO_START → 1.
 */
export function resolveSchedulerTriggerExitCode(outcome: SchedulerTickOutcome): 0 | 1 {
  return outcome === 'FAILED_TO_START' ? 1 : 0;
}

export function buildSchedulerTriggerReport(
  result: SchedulerTickResult,
): CollectorSchedulerTriggerReport {
  return {
    ok: result.outcome !== 'FAILED_TO_START',
    mode: 'scheduler-trigger',
    outcome: result.outcome,
    ...(result.collectorRunId !== undefined
      ? { collectorRunId: result.collectorRunId }
      : {}),
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
  };
}

export function isSchedulerLeaseOwnerPresent(
  leaseOwner: string | null | undefined,
): boolean {
  return typeof leaseOwner === 'string' && leaseOwner.length > 0;
}

export function isSchedulerCooldownActive(
  cooldownUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return cooldownUntil != null && cooldownUntil.getTime() > now.getTime();
}

export function buildCollectorSchedulerStatusReport(input: {
  config: CollectorConfig;
  /** Prefer re-read via readCollectorSchedulerEnabled(process.env). */
  enabled: boolean;
  state: CollectorSchedulerState | null;
  now?: Date;
}): CollectorSchedulerStatusReport {
  const now = input.now ?? new Date();
  const state = input.state;
  return {
    ok: true,
    mode: 'scheduler-status',
    generatedAt: now.toISOString(),
    enabled: input.enabled,
    scheduleIntervalMs: input.config.scheduleIntervalMs,
    scheduleQueueId: input.config.scheduleQueueId,
    schedulePlatform: input.config.schedulePlatform,
    scheduleBatchSize: input.config.scheduleBatchSize,
    scheduleConcurrency: input.config.scheduleConcurrency,
    maxPendingIngestionJobs: input.config.maxPendingIngestionJobs,
    schedulerLeaseMs: input.config.schedulerLeaseMs,
    leaseOwnerPresent: isSchedulerLeaseOwnerPresent(state?.leaseOwner),
    leaseExpiresAt: state?.leaseExpiresAt?.toISOString() ?? null,
    lastTriggerAt: state?.lastTriggerAt?.toISOString() ?? null,
    lastOutcome: state?.lastOutcome ?? null,
    lastCollectorRunId: state?.lastCollectorRunId ?? null,
    lastErrorCode: state?.lastErrorCode ?? null,
    cooldownUntil: state?.cooldownUntil?.toISOString() ?? null,
    cooldownActive: isSchedulerCooldownActive(state?.cooldownUntil, now),
  };
}

export function formatSchedulerStatusText(report: CollectorSchedulerStatusReport): string[] {
  return [
    'collector:scheduler-status (read-only scheduler config + singleton state)',
    `generatedAt=${report.generatedAt}`,
    `enabled=${report.enabled} (from config; not inferred from lastOutcome)`,
    `scheduleIntervalMs=${report.scheduleIntervalMs}`,
    `scheduleQueueId=${report.scheduleQueueId}`,
    `schedulePlatform=${report.schedulePlatform ?? 'null'}`,
    `scheduleBatchSize=${report.scheduleBatchSize}`,
    `scheduleConcurrency=${report.scheduleConcurrency}`,
    `maxPendingIngestionJobs=${report.maxPendingIngestionJobs}`,
    `schedulerLeaseMs=${report.schedulerLeaseMs}`,
    `leaseOwner=${report.leaseOwnerPresent ? 'PRESENT' : 'ABSENT'}`,
    `leaseExpiresAt=${report.leaseExpiresAt ?? 'null'}`,
    `lastTriggerAt=${report.lastTriggerAt ?? 'null'}`,
    `lastOutcome=${report.lastOutcome ?? 'null'}`,
    `lastCollectorRunId=${report.lastCollectorRunId ?? 'null'}`,
    `lastErrorCode=${report.lastErrorCode ?? 'null'}`,
    `cooldownUntil=${report.cooldownUntil ?? 'null'}`,
    `cooldownActive=${report.cooldownActive}`,
  ];
}
