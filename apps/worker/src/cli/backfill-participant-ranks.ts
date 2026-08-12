import 'dotenv/config';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import {
  PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME,
  ValidationFailureError,
  resolveBullMqPrefix,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import {
  loadParticipantRankEnrichmentWorkerConfig,
  getDatabaseUrl,
} from '../config.js';
import { createRedisConnection } from '../queues.js';
import { reportCliFailure, writeJsonStdout, writeTextStdout } from './aggregates/cli-output.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './aggregates/exit-codes.js';
import { withJsonStdoutGuard } from './aggregates/json-stdout-guard.js';
import {
  parseBackfillParticipantRanksArgs,
  runBackfillParticipantRanks,
} from './aggregates/backfill-participant-ranks-core.js';

/**
 * Bounded current-patch participant-rank backfill (M12-v2 Phase 4).
 * Enqueues into the existing participant-rank-enrichment pipeline — no direct Riot calls.
 */
function printHelp(): void {
  writeTextStdout([
    'Usage: pnpm aggregates:backfill-participant-ranks [options]',
    '',
    'Bounded, resumable backfill of PENDING / FAILED_RETRYABLE ranked participants',
    'via the participant-rank-enrichment queue (reason=BACKFILL).',
    '',
    'Options:',
    '  --dry-run                      Count/select candidates; no enqueue / no Riot',
    '  --confirm                      Required for mutating enqueue',
    '  --wait                         Wait for enrichment queue idle after enqueue',
    '  --wait-timeout-ms <ms>         Default 120000',
    '  --platform <route>             Default na1',
    '  --queue <id>                   420 or 440 (default 420)',
    '  --patch <patch>                Optional current-patch filter',
    '  --max-participants <n>         Default 200 (max 500)',
    '  --max-riot-calls <n>           Max unique PUUIDs / Riot-call upper bound (default 100, max 500)',
    '  --after-participant-id <id>    Resume cursor',
    '  --correlation-id <id>          Optional ops correlation',
    '  --json                         JSON on stdout',
    '  --help',
    '',
    'Safety: refuses DATABASE_URL unless DB name is league_helper_m12v2.',
    'Does not retry FAILED_PERMANENT. Does not target fresh RESOLVED_*.',
    'Exit codes: 0 success, 1 command failure',
  ]);
}

function formatCoverage(value: number | null | undefined): string {
  if (value == null) {
    return 'n/a';
  }
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let flags;
  try {
    flags = parseBackfillParticipantRanksArgs(argv);
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
  let connection: ReturnType<typeof createRedisConnection> | null = null;
  let queue: Queue<ParticipantRankEnrichmentJobPayload> | null = null;

  try {
    const mutating = !flags.dryRun && flags.confirm;
    if (mutating) {
      connection = createRedisConnection();
      const config = loadParticipantRankEnrichmentWorkerConfig();
      queue = new Queue<ParticipantRankEnrichmentJobPayload>(
        config.queueName || PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME,
        {
          connection,
          prefix: resolveBullMqPrefix(),
        },
      );
    }

    const enrichmentConfig = mutating ? loadParticipantRankEnrichmentWorkerConfig() : null;

    const result = await withJsonStdoutGuard(flags.json, () =>
      runBackfillParticipantRanks({
        prisma,
        flags,
        databaseUrl: getDatabaseUrl(),
        enrichmentQueue: queue,
        enrichmentConfig,
      }),
    );

    if (flags.json) {
      writeJsonStdout(result.report);
    } else {
      const r = result.report;
      const lines = [
        `ok=${r.ok}`,
        `mode=${r.mode}`,
        `database=${r.database ?? 'unknown'}`,
        `participantsSelected=${r.selection.participantsSelected}`,
        `uniquePuuids=${r.selection.uniquePuuids}`,
        `pendingRowsSeen=${r.selection.pendingRowsSeen}`,
        `failedRetryableRowsSeen=${r.selection.failedRetryableRowsSeen}`,
        `nextCursor=${r.selection.nextCursor ?? 'none'}`,
        `truncatedByParticipants=${r.selection.truncatedByParticipants}`,
        `truncatedByRiotCalls=${r.selection.truncatedByRiotCalls}`,
      ];
      if (r.enqueue) {
        lines.push(
          `published=${r.enqueue.published}`,
          `alreadyLive=${r.enqueue.alreadyLive}`,
          `enqueueFailed=${r.enqueue.failed}`,
        );
      }
      if (r.baselineHealth) {
        lines.push(
          `baseline.exactRankCoverage=${formatCoverage(r.baselineHealth.exactRankCoverage)}`,
          `baseline.rankResolutionCoverage=${formatCoverage(r.baselineHealth.rankResolutionCoverage)}`,
          `baseline.health=${r.baselineHealth.health}`,
          `baseline.warning=${r.baselineHealth.warning ?? 'none'}`,
        );
      }
      if (r.afterHealth) {
        lines.push(
          `after.exactRankCoverage=${formatCoverage(r.afterHealth.exactRankCoverage)}`,
          `after.rankResolutionCoverage=${formatCoverage(r.afterHealth.rankResolutionCoverage)}`,
          `after.health=${r.afterHealth.health}`,
          `after.warning=${r.afterHealth.warning ?? 'none'}`,
        );
      }
      if (r.cost) {
        lines.push(
          `cost.riotCallsEstimated=${r.cost.riotCallsEstimated}`,
          `cost.cacheHitsEstimated=${r.cost.cacheHitsEstimated}`,
          `cost.resolutionYield=${formatCoverage(r.cost.resolutionYield)}`,
          `cost.riotCallsPerResolved=${r.cost.riotCallsPerResolvedParticipant ?? 'n/a'}`,
          `cost.http429=${r.cost.http429Observations}`,
          `cost.cooldownEvents=${r.cost.cooldownEventsEstimated}`,
        );
      }
      if (r.waitedMs != null) {
        lines.push(`waitedMs=${r.waitedMs}`);
      }
      if (r.error) {
        lines.push(`error=${r.error}`);
      }
      writeTextStdout(lines);
    }

    process.exitCode = result.exitCode;
  } finally {
    await Promise.allSettled([
      queue?.close(),
      connection?.quit(),
      prisma.$disconnect(),
    ]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.slice(0, 200) : 'unknown';
  reportCliFailure({ argv: process.argv.slice(2), message });
  process.exit(EXIT_COMMAND_FAILURE);
});
