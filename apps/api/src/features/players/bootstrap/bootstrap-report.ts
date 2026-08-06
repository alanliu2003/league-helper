import type { BootstrapRunResult } from './bootstrap-player.types';
import type { AggregateSmokeResult, WaitSummary } from './bootstrap-verify';

export type BootstrapCliReport = BootstrapRunResult & {
  waitSummary?: WaitSummary;
  aggregateSmoke?: AggregateSmokeResult;
};

/**
 * Exit 1 for: player failures, definitive smoke failure, or wait that finished
 * with ingestion failures. Wait timeout with pending jobs alone is exit 0
 * (reported as timedOut + inconclusive smoke) so ops can retry/wait longer.
 */
export function resolveBootstrapExitCode(report: BootstrapCliReport): 0 | 1 {
  if (!report.ok) {
    return 1;
  }
  if (report.totals.playersFailed > 0) {
    return 1;
  }
  if (report.aggregateSmoke?.status === 'failed') {
    return 1;
  }
  if (
    report.waitSummary &&
    !report.waitSummary.timedOut &&
    report.waitSummary.failed > 0
  ) {
    return 1;
  }
  return 0;
}

/** Attach wait/smoke and recompute rollup ok for CLI reporting. */
export function finalizeBootstrapReport(input: {
  run: BootstrapRunResult;
  waitSummary?: WaitSummary;
  aggregateSmoke?: AggregateSmokeResult;
}): BootstrapCliReport {
  const smokeFailed = input.aggregateSmoke?.status === 'failed';
  const waitFailed =
    input.waitSummary !== undefined &&
    !input.waitSummary.timedOut &&
    input.waitSummary.failed > 0;

  return {
    ...input.run,
    waitSummary: input.waitSummary,
    aggregateSmoke: input.aggregateSmoke,
    ok: input.run.ok && !smokeFailed && !waitFailed,
  };
}

export function formatBootstrapTextReport(report: BootstrapCliReport): string[] {
  const lines: string[] = [
    `ok=${report.ok} dryRun=${report.dryRun}`,
    `players=${report.totals.players} playersFailed=${report.totals.playersFailed}`,
    `discovered=${report.totals.discoveredMatchCount} enqueued=${report.totals.enqueuedCount}`,
  ];

  for (const player of report.players) {
    const parts = [
      `player=${player.gameName}#${player.tagLine}@${player.platform}`,
      `ok=${player.ok}`,
      `discovered=${player.discoveredMatchCount}`,
    ];
    if (player.dryRun) {
      parts.push(
        `wouldEnqueueEstimate=${player.wouldEnqueueCount ?? player.discoveredMatchCount}`,
      );
    } else {
      parts.push(`enqueued=${player.enqueuedCount}`);
      parts.push(`skippedAlreadyComplete=${player.skippedAlreadyCompleteCount}`);
    }
    if (player.error) {
      parts.push(`error=${player.error}`);
    }
    lines.push(parts.join(' '));
  }

  if (report.waitSummary) {
    const w = report.waitSummary;
    lines.push(
      `wait completed=${w.completed} failed=${w.failed} skipped=${w.skipped} pending=${w.pending} timedOut=${w.timedOut} checked=${w.checkedMatchCount}`,
    );
  }

  if (report.aggregateSmoke) {
    const s = report.aggregateSmoke;
    const rowBit = s.row
      ? ` championId=${s.row.championId} teamPosition=${s.row.teamPosition} sampleSize=${s.row.sampleSize} queueId=${s.row.queueId}`
      : '';
    lines.push(
      `aggregateSmoke status=${s.status} ok=${s.ok}${rowBit}${s.message ? ` message=${s.message}` : ''}`,
    );
  }

  if (report.error) {
    lines.push(`error=${report.error}`);
  }

  return lines;
}
