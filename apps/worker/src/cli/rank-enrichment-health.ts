import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ValidationFailureError } from '@league-helper/shared';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import { parseSharedAggregateCliArgs } from './aggregates/parse-args.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import { runRankEnrichmentHealth } from './aggregates/rank-enrichment-health-core.js';

/**
 * Read-only participant-rank enrichment health (Phase 3 ops).
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:rank-enrichment-health [options]',
    '',
    'Options:',
    '  --json                     JSON on stdout',
    '  --patch / --platform / --queue  Optional filters',
    '  --help',
    '',
    'Exit codes: 0 success, 1 command failure',
  ]);
}

function formatCoverage(value: number | null): string {
  if (value == null) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(1)}%`;
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

  const prisma = new PrismaClient();

  try {
    const result = await withJsonStdoutGuard(flags.json, () =>
      runRankEnrichmentHealth({
        prisma,
        filters: flags.filters,
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      const c = r.stateCounts;
      writeTextStdout([
        `ok=${r.ok}`,
        `eligibleRankedParticipants=${r.eligibleRankedParticipants}`,
        `PENDING=${c.PENDING} FAILED_RETRYABLE=${c.FAILED_RETRYABLE} FAILED_PERMANENT=${c.FAILED_PERMANENT}`,
        `RESOLVED_RANKED=${c.RESOLVED_RANKED} RESOLVED_UNRANKED=${c.RESOLVED_UNRANKED} NOT_APPLICABLE=${c.NOT_APPLICABLE}`,
        `permanentUnavailableSampleCount=${r.permanentUnavailableSampleCount}`,
        `rankResolutionCoverage=${formatCoverage(r.rankResolutionCoverage)}`,
        `exactRankCoverage=${formatCoverage(r.exactRankCoverage)}`,
        `health=${r.health}`,
        `warning=${r.warning ?? 'none'}`,
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
