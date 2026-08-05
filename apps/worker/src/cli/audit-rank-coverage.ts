import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ValidationFailureError } from '@league-helper/shared';
import { loadChampionAggregationWorkerConfig } from '../config.js';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import { parseSharedAggregateCliArgs } from './aggregates/parse-args.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import { runAuditRankCoverage } from './aggregates/audit-rank-core.js';

/**
 * Read-only rank coverage audit.
 * Primary denominator = ranked queues 420 and 440 only.
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:audit-rank-coverage [options]',
    '',
    'Options:',
    '  --json                     JSON on stdout',
    '  --patch / --platform / --queue  Optional filters',
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

  try {
    const result = await withJsonStdoutGuard(flags.json, () =>
      runAuditRankCoverage({
        prisma,
        config,
        filters: flags.filters,
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      writeTextStdout([
        `ok=${r.ok}`,
        `rankedParticipants=${r.ranked.totalEligibleParticipants} known=${r.ranked.knownRankTier} unknown=${r.ranked.unknownRankTier} coverage=${r.ranked.coveragePercent ?? 'n/a'}%`,
        `nonRankedParticipants=${r.nonRanked.totalEligibleParticipants} (excluded from primary coverage)`,
        ...(r.error ? [`error=${r.error}`] : []),
      ]);
    }
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
  reportCliFailure({ argv: process.argv.slice(2), message });
  process.exit(EXIT_COMMAND_FAILURE);
});
