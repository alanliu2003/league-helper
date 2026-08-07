import 'dotenv/config';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import {
  cliLog,
  reportCliFailure,
  writeJsonStdout,
  writeTextStdout,
} from '../../players/bootstrap/cli-output';
import { parseCollectorStatusArgs } from '../collector.args';
import { loadCollectorConfig } from '../collector.config';
import { formatCoverageTextLines } from '../collector-cli.output';
import { CollectorStatusService } from '../collector-status.service';
import type { CollectorStatusReport } from '../collector.types';

class StderrConsoleLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal',
    writeStreamType?: 'stdout' | 'stderr',
  ): void {
    super.printMessages(messages, context, logLevel, writeStreamType ?? 'stderr');
  }
}

const HELP_LINES = [
  'collector:status — read-only discovery/enqueue orchestration snapshot',
  '',
  'Usage:',
  '  pnpm collector:status [--platform <route>] [--queue <id>] [--json]',
  '',
  'Options:',
  '  --platform   Limit coverage/eligibility platforms (must be in allowlist)',
  '  --queue      Queue id for coverage snapshot (default 420)',
  '  --json       Emit JSON on stdout',
  '  --help       Show this help',
  '',
  'Exit codes: 0 when report produced; 1 only when report cannot be produced.',
  'Does not mutate runs, leases, players, or enqueue work.',
];

function formatRunLine(
  label: string,
  run: CollectorStatusReport['runState']['activeRunning'][number],
): string {
  const counters = run.counters;
  return [
    `${label} runId=${run.runId} status=${run.status}`,
    `started=${run.startedAt}`,
    `finished=${run.finishedAt ?? 'null'}`,
    `platforms=${run.effectivePlatforms.join(',') || 'none'}`,
    `queue=${run.queueId}`,
    `claimed=${counters.playersClaimed}`,
    `attempted=${counters.playersAttempted}`,
    `succeeded=${counters.playersSucceeded}`,
    `failed=${counters.playersFailed}`,
    `ownershipLost=${counters.ownershipLost}`,
    `discovered=${counters.matchIdsDiscovered}`,
    `enqueued=${counters.matchesEnqueued}`,
    `skippedComplete=${counters.matchesSkippedComplete}`,
    ...(run.failureCode ? [`failureCode=${run.failureCode}`] : []),
  ].join(' ');
}

function formatStatusText(report: CollectorStatusReport): string[] {
  const pop = report.trackedPopulation;
  const lines = [
    'collector:status (read-only discovery/enqueue orchestration snapshot)',
    `generatedAt=${report.generatedAt}`,
    `config staleRunAfterMs=${report.config.staleRunAfterMs} leaseDurationMs=${report.config.leaseDurationMs} platforms=${report.config.platformAllowlist.join(',')}`,
    '',
    '## Run state',
    `activeRunning=${report.runState.activeRunning.length}`,
    ...report.runState.activeRunning.map((run) => formatRunLine('active', run)),
    `staleRunning=${report.runState.staleRunning.length} (threshold=staleRunAfterMs, not leaseDurationMs)`,
    ...report.runState.staleRunning.map((run) => formatRunLine('stale', run)),
    `recentFinalized=${report.runState.recentFinalized.length}`,
    ...report.runState.recentFinalized.map((run) => formatRunLine('finalized', run)),
    '',
    '## Tracked population',
    `byStatus=${JSON.stringify(pop.byStatus)}`,
    `byPlatform=${JSON.stringify(pop.byPlatform)}`,
    `byEnrollmentSource=${JSON.stringify(pop.byEnrollmentSource)}`,
    `eligibleNow=${pop.eligibleNow} activelyLeased=${pop.activelyLeased} expiredLeases=${pop.expiredLeases}`,
    `nextEligibleAt=${pop.nextEligibleAt ?? 'null'}`,
    `recentFailureCodes=${JSON.stringify(pop.recentFailureCodes)}`,
    '',
    '## Coverage',
  ];

  if (report.coverage) {
    lines.push(...formatCoverageTextLines(report.coverage));
  } else {
    lines.push('coverage skipped');
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Warnings');
    for (const warning of report.warnings) {
      lines.push(`warning ${warning}`);
    }
  }

  return lines;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const config = loadCollectorConfig(process.env);
    const args = parseCollectorStatusArgs(argv, config);

    if (args.help) {
      writeTextStdout(HELP_LINES);
      process.exitCode = 0;
      return;
    }

    app = await NestFactory.createApplicationContext(AppModule, {
      logger: new StderrConsoleLogger('CollectorStatusCli'),
    });

    const statusService = app.get(CollectorStatusService);
    const report = await statusService.report({
      platformFilter: args.platformFilter,
      queueId: args.queueId,
    });

    if (args.json) {
      writeJsonStdout(report);
    } else {
      writeTextStdout(formatStatusText(report));
    }
    process.exitCode = 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    reportCliFailure({ argv, message });
    process.exitCode = 1;
  } finally {
    if (app) {
      await Promise.race([
        app.close(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1_500);
        }),
      ]);
    }
  }

  process.exit(process.exitCode ?? 1);
}

void main().catch((error: unknown) => {
  cliLog(error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});
