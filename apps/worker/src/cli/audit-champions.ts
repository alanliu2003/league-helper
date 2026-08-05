import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ValidationFailureError } from '@league-helper/shared';
import { loadChampionAggregationWorkerConfig } from '../config.js';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import { parseSharedAggregateCliArgs } from './aggregates/parse-args.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import { runAuditChampions } from './aggregates/audit-champions-core.js';

/**
 * Read-only champion aggregate integrity audit.
 *
 * Exit codes:
 * 0 — success, no integrity findings
 * 1 — command execution failure
 * 2 — integrity findings present
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:audit-champions [options]',
    '',
    'Options:',
    '  --json                        JSON on stdout',
    '  --aggregation-version <v>     Audit a specific aggregation version',
    '  --help',
    '',
    'Exit codes: 0 clean, 1 command failure, 2 integrity findings',
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
      runAuditChampions({
        prisma,
        config,
        aggregationVersion: flags.aggregationVersion,
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      writeTextStdout([
        `ok=${r.ok} passed=${r.passed}`,
        `rowsScanned=${r.rowsScanned} findings=${r.findings.length}`,
        `invalidLatestEligibleMatchAtCount=${r.invalidLatestEligibleMatchAtCount}`,
        ...Object.entries(r.findingCounts).map(([code, count]) => `${code}=${count}`),
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
