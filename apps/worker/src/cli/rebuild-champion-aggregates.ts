import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ValidationFailureError } from '@league-helper/shared';
import { loadChampionAggregationWorkerConfig } from '../config.js';
import { createRedisConnection } from '../queues.js';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import {
  hasNonDefaultRollupFlags,
  isRebuildConfirmed,
  parseSharedAggregateCliArgs,
  resolveBatchSize,
  toRollupPolicy,
} from './aggregates/parse-args.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import { runRebuildChampionAggregates } from './aggregates/rebuild-core.js';

/**
 * Mutating rebuild of champion aggregates.
 *
 * Exit codes:
 * 0 — success (including dry-run)
 * 1 — command failure (missing confirm, bad args, batch failure, rollup guard)
 *
 * Confirmation: --confirm or AGGREGATES_REBUILD_CHAMPIONS_CONFIRM=YES
 * Dry-run never writes or increments cache generation.
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:rebuild-champions [options]',
    '',
    'Options:',
    '  --dry-run                         Report only; no writes / no cache generation INCR',
    '  --confirm                         Allow mutating apply (or set AGGREGATES_REBUILD_CHAMPIONS_CONFIRM=YES)',
    '  --json                            Machine-readable JSON on stdout (logs on stderr)',
    '  --patch <patch>                   Filter by normalized patch (match-complete; markers OK)',
    '  --queue <queueId>                 Filter by queue id (match-complete; markers OK)',
    '  --platform <platformRoute>        Filter by platform route (match-complete; markers OK)',
    '  --champion <championId>           Participant-level filter (see WARNING below)',
    '  --batch-size <n>                  Keys per batch (or CHAMPION_AGGREGATION_BATCH_SIZE)',
    '  --aggregation-version <v>         Target aggregation version (default: config)',
    '  --source-normalization-version <v>',
    '  --include-all-tiers-and-position  Non-default ALL×ALL (dry-run or alt aggregation-version)',
    '  --include-all-platform            Reserved; dry-run only',
    '  --include-all-regional-route      Reserved; dry-run only',
    '  --include-all-queue               Reserved; dry-run only',
    '  --help                            Show help',
    '',
    'Notes:',
    '  Processing markers / recalc-scope clear run only for match-complete rebuilds',
    '  (no --champion). Champion-filtered rebuilds leave markers untouched.',
    '',
    'WARNING:',
    '  --champion rebuilds do NOT update ChampionAggregationProcessing markers and will',
    '  NOT make reconcile treat the match as current. Other champions on that match may',
    '  still be stale/missing until a match-complete rebuild or per-match job runs.',
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
  const redis = createRedisConnection();

  try {
    const result = await withJsonStdoutGuard(flags.json, () =>
      runRebuildChampionAggregates({
        prisma,
        redis,
        config,
        dryRun: flags.dryRun,
        confirmed: isRebuildConfirmed(flags),
        batchSize: resolveBatchSize(flags.batchSize),
        filters: flags.filters,
        rollupPolicy: toRollupPolicy(flags.rollup),
        sourceNormalizationVersion:
          flags.sourceNormalizationVersion ?? config.sourceNormalizationVersion,
        aggregationVersion: flags.aggregationVersion ?? config.aggregationVersion,
        currentIncrementalAggregationVersion: config.aggregationVersion,
        nonDefaultRollupRequested: hasNonDefaultRollupFlags(flags.rollup),
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      writeTextStdout([
        `ok=${r.ok} dryRun=${r.dryRun}`,
        `versions source=${r.sourceNormalizationVersion} aggregation=${r.aggregationVersion}`,
        `eligibleMatches=${r.eligibleMatches} eligibleParticipants=${r.eligibleParticipants}`,
        `affectedKeys=${r.affectedAggregateKeys} expectedUpserts=${r.expectedUpserts} expectedDeletions=${r.expectedDeletions}`,
        `upsertsApplied=${r.upsertsApplied} deletionsApplied=${r.deletionsApplied} cacheGenIncr=${r.cacheGenerationsIncremented}`,
        `markersUpdated=${r.markersUpdated} scopesCleared=${r.scopesCleared}`,
        ...(r.markersSkippedReason ? [`markersSkippedReason=${r.markersSkippedReason}`] : []),
        ...(r.error ? [`error=${r.error}`] : []),
      ]);
    }
    process.exitCode = result.exitCode;
  } finally {
    await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
  reportCliFailure({ argv: process.argv.slice(2), message });
  process.exit(EXIT_COMMAND_FAILURE);
});
