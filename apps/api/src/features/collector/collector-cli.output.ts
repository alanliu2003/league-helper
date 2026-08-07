import type { CollectorRunStatus } from '@prisma/client';
import type {
  CollectorCoverageSnapshot,
  CollectorRunCounters,
  CollectorRunOnceResult,
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
