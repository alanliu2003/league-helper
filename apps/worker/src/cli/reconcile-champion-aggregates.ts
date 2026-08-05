import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  CHAMPION_AGGREGATION_QUEUE_NAME,
  ValidationFailureError,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import { loadChampionAggregationWorkerConfig } from '../config.js';
import { createRedisConnection } from '../queues.js';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import { parseSharedAggregateCliArgs } from './aggregates/parse-args.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import { runReconcileChampionAggregates } from './aggregates/reconcile-core.js';

/**
 * Enqueue missing/failed/pending champion aggregation work.
 *
 * Exit codes: 0 success, 1 failure
 * Dry-run supported. JSON mode writes only the report to stdout.
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:reconcile-champions [options]',
    '',
    'Options:',
    '  --dry-run                  Report actions without enqueueing',
    '  --json                     JSON on stdout (logs on stderr)',
    '  --patch <patch>            Filter',
    '  --queue <queueId>          Filter',
    '  --platform <platformRoute> Filter',
    '  --champion <championId>    Filter',
    '  --help                     Show help',
    '',
    'Exit codes: 0 success, 1 failure',
  ]);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let flags;
  try {
    flags = parseSharedAggregateCliArgs(argv);
  } catch (error: unknown) {
    const message = error instanceof ValidationFailureError ? error.message : 'Invalid arguments';
    reportCliFailure({ argv, message });
    process.exitCode = EXIT_COMMAND_FAILURE;
    return;
  }

  if (flags.help) {
    printHelp();
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  const config = loadChampionAggregationWorkerConfig();
  const prisma = new PrismaClient();
  const connection = createRedisConnection();
  const queue = new Queue<ChampionAggregationJobPayload>(
    config.queueName || CHAMPION_AGGREGATION_QUEUE_NAME,
    { connection },
  );

  try {
    const result = await withJsonStdoutGuard(flags.json, () =>
      runReconcileChampionAggregates({
        prisma,
        queue,
        config,
        dryRun: flags.dryRun,
        filters: flags.filters,
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      writeTextStdout([
        `ok=${r.ok} dryRun=${r.dryRun}`,
        `scanned=${r.scanned} current=${r.current}`,
        `missingMarker=${r.missingMarker} failedMarker=${r.failedMarker} pendingScope=${r.pendingRecalculationScope}`,
        `jobsEnqueued=${r.jobsEnqueued} jobsDeduplicated=${r.jobsDeduplicated} failures=${r.failures}`,
        ...(r.error ? [`error=${r.error}`] : []),
      ]);
    }
    process.exitCode = result.exitCode;
  } finally {
    await Promise.allSettled([queue.close(), connection.quit(), prisma.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
  reportCliFailure({ argv: process.argv.slice(2), message });
  process.exit(EXIT_COMMAND_FAILURE);
});
