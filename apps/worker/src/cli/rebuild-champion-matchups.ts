import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ValidationFailureError } from '@league-helper/shared';
import { loadChampionAggregationWorkerConfig } from '../config.js';
import { createRedisConnection } from '../queues.js';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import {
  DEFAULT_MATCHUP_AGGREGATION_VERSION,
  runRebuildChampionMatchups,
} from '../queues/champion-matchup-aggregation/rebuild-core.js';

function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:rebuild-champion-matchups [options]',
    '',
    'Rebuild champion matchup aggregates from persisted MatchParticipant source only.',
    'No Riot calls.',
    '',
    'Options:',
    '  --dry-run              Report pairing/depth; no writes / no cache generation INCR',
    '  --confirm              Allow mutating apply (or AGGREGATES_REBUILD_MATCHUPS_CONFIRM=YES)',
    '  --json                 Machine-readable JSON on stdout',
    '  --patch <patch>        Required normalized patch (e.g. 16.15)',
    '  --platform <route>     Required platform (e.g. na1)',
    '  --queue <queueId>      Required queue id (e.g. 420)',
    '  --champion <id>        Optional subject championId filter',
    '  --position <role>      Optional TOP|JUNGLE|MIDDLE|BOTTOM|SUPPORT',
    '  --batch-size <n>       Max matches to scan (default 2000)',
    '  --offset <n>           Skip N matches for resume',
    '  --aggregation-version <v>',
    '  --source-normalization-version <v>',
    '  --help',
  ]);
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ValidationFailureError(`${flag} requires a value.`);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  let patch: string | undefined;
  let platformRoute: string | undefined;
  let queueId: number | undefined;
  let championId: number | undefined;
  let position: string | undefined;
  let batchSize = 2000;
  let offset = 0;
  let dryRun = false;
  let confirm = false;
  let json = false;
  let aggregationVersion = DEFAULT_MATCHUP_AGGREGATION_VERSION;
  let sourceNormalizationVersion: string | undefined;

  try {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i]!;
      switch (arg) {
        case '--dry-run':
          dryRun = true;
          break;
        case '--confirm':
          confirm = true;
          break;
        case '--json':
          json = true;
          break;
        case '--patch':
          patch = readValue(argv, i, '--patch');
          i += 1;
          break;
        case '--platform':
          platformRoute = readValue(argv, i, '--platform').toLowerCase();
          i += 1;
          break;
        case '--queue':
          queueId = Number(readValue(argv, i, '--queue'));
          i += 1;
          break;
        case '--champion':
          championId = Number(readValue(argv, i, '--champion'));
          i += 1;
          break;
        case '--position':
          position = readValue(argv, i, '--position').trim().toUpperCase();
          i += 1;
          break;
        case '--batch-size':
          batchSize = Number(readValue(argv, i, '--batch-size'));
          i += 1;
          break;
        case '--offset':
          offset = Number(readValue(argv, i, '--offset'));
          i += 1;
          break;
        case '--aggregation-version':
          aggregationVersion = readValue(argv, i, '--aggregation-version');
          i += 1;
          break;
        case '--source-normalization-version':
          sourceNormalizationVersion = readValue(argv, i, '--source-normalization-version');
          i += 1;
          break;
        default:
          throw new ValidationFailureError(`Unknown argument: ${arg}`);
      }
    }

    if (!patch || !platformRoute || queueId === undefined) {
      throw new ValidationFailureError('--patch, --platform, and --queue are required.');
    }
    if (!Number.isInteger(queueId) || queueId < 0) {
      throw new ValidationFailureError('--queue must be a non-negative integer.');
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new ValidationFailureError('--batch-size must be a positive integer.');
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationFailureError('--offset must be a non-negative integer.');
    }
    if (championId !== undefined && (!Number.isInteger(championId) || championId < 1)) {
      throw new ValidationFailureError('--champion must be a positive integer.');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid arguments';
    reportCliFailure({ argv, message });
    process.exitCode = EXIT_COMMAND_FAILURE;
    return;
  }

  const config = loadChampionAggregationWorkerConfig();
  const prisma = new PrismaClient();
  const redis = createRedisConnection();
  try {
    const result = await runRebuildChampionMatchups({
      prisma,
      redis,
      dryRun,
      confirmed: confirm || process.env.AGGREGATES_REBUILD_MATCHUPS_CONFIRM === 'YES',
      batchSize,
      offset,
      sourceNormalizationVersion: sourceNormalizationVersion ?? config.sourceNormalizationVersion,
      aggregationVersion,
      filters: {
        patch,
        platformRoute,
        queueId,
        championId,
        position,
      },
    });
    if (json) {
      writeJsonStdout(result.report);
    } else {
      writeTextStdout([
        `ok=${result.report.ok} dryRun=${result.report.dryRun}`,
        `matches=${result.report.matchesScanned} eligible=${result.report.eligibleMatches} allFive=${result.report.matchesWithAllFivePairs}`,
        `directional=${result.report.directionalObservations} rows=${result.report.uniqueRows}`,
        `upserts=${result.report.upsertsApplied} deletions=${result.report.deletionsApplied}`,
        `skips=${JSON.stringify(result.report.skips)}`,
        ...(result.report.error ? [`error=${result.report.error}`] : []),
      ]);
    }
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}

main().catch((error: unknown) => {
  reportCliFailure({
    argv: process.argv,
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = EXIT_COMMAND_FAILURE;
});
