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
import { parseSharedAggregateCliArgs, resolveMinSample } from './aggregates/parse-args.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import { runStatusChampionAggregates } from './aggregates/status-core.js';

/**
 * Read-only champion aggregation status.
 * Exit nonzero only when the command itself fails — not because failed jobs exist.
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:status-champions [options]',
    '',
    'Options:',
    '  --json                     JSON on stdout',
    '  --patch / --queue / --platform  Optional eligibility filters',
    '  --help',
    '',
    'Exit codes: 0 success, 1 command failure',
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
      runStatusChampionAggregates({
        prisma,
        queue,
        config,
        minSample: resolveMinSample(),
        filters: flags.filters,
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      writeTextStdout([
        `ok=${r.ok}`,
        `versions source=${r.sourceNormalizationVersion} aggregation=${r.aggregationVersion}`,
        `eligibleMatches=${r.eligibleMatches} eligibleParticipants=${r.eligibleParticipants}`,
        `aggregateRows current=${r.aggregateRowCountCurrentVersions} older=${r.aggregateRowCountOlderVersions}`,
        `rowsBelowMinSample=${r.rowsBelowMinimumSample} (min=${r.minimumSample})`,
        `markers completed=${r.processingMarkers.completed} failed=${r.processingMarkers.failed}`,
        `pendingScopes=${r.pendingRecalculationScopes}`,
        `queue waiting=${r.queue.waiting} active=${r.queue.active} delayed=${r.queue.delayed} completed=${r.queue.completed} failed=${r.queue.failed}`,
        `workerCount=${r.workerCount ?? 'n/a'}`,
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
