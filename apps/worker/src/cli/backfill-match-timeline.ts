import 'dotenv/config';
import { Queue } from 'bullmq';
import { MatchIngestionStatus, PrismaClient, TimelineProductCoverage } from '@prisma/client';
import {
  MATCH_TIMELINE_JOB_NAME,
  MATCH_TIMELINE_QUEUE_NAME,
  MatchTimelineJobPayloadSchema,
  ValidationFailureError,
  buildMatchTimelineBullMqJobId,
  resolveBullMqPrefix,
  type MatchTimelineJobPayload,
} from '@league-helper/shared';
import { loadMatchTimelineWorkerConfig } from '../config.js';
import { createRedisConnection } from '../queues.js';
import {
  MAX_BACKFILL_MATCH_TIMELINE_LIMIT,
  parseBackfillMatchTimelineArgs,
  type BackfillMatchTimelineFlags,
} from './backfill-match-timeline-args.js';

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

/**
 * Bounded ops CLI to enqueue ENRICH_MATCH_TIMELINE for completed matches
 * missing product timeline. Always available (not gated by search backfill).
 * Does not call Riot or getMatch.
 */
function printHelp(): void {
  console.log(
    [
      'Usage: pnpm jobs:backfill-match-timeline -- --limit <n> [options]',
      '',
      'Enqueue ENRICH_MATCH_TIMELINE for COMPLETED matches missing product timeline',
      '(timeline null or productCoverage != STORED). Newest first.',
      'Does not call Riot or getMatch. Not gated by MATCH_TIMELINE_SEARCH_BACKFILL_ENABLED.',
      '',
      'Options:',
      `  --limit <n>              Required. Max ${MAX_BACKFILL_MATCH_TIMELINE_LIMIT}.`,
      '  --since <iso-date>       Optional. Filter gameCreation >= since',
      '  --dry-run                Print counts only; do not enqueue',
      '  --include-ineligible     Include matches without a linked participant (default off)',
      '  --help',
    ].join('\n'),
  );
}

function fail(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

async function selectCandidateMatchIds(
  prisma: PrismaClient,
  flags: Extract<BackfillMatchTimelineFlags, { help: false }>,
): Promise<string[]> {
  const rows = await prisma.match.findMany({
    where: {
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      ...(flags.since ? { gameCreation: { gte: flags.since } } : {}),
      ...(flags.includeIneligible
        ? {}
        : { participants: { some: { playerAccountId: { not: null } } } }),
      OR: [
        { timeline: null },
        { timeline: { productCoverage: { not: TimelineProductCoverage.STORED } } },
      ],
    },
    orderBy: [{ gameCreation: 'desc' }, { id: 'desc' }],
    take: flags.limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function enqueueMatchTimelineJob(input: {
  queue: Queue<MatchTimelineJobPayload>;
  matchId: string;
  includeIneligible: boolean;
  jobAttempts: number;
  backoffBaseMs: number;
}): Promise<'published' | 'alreadyQueued'> {
  const payload = MatchTimelineJobPayloadSchema.parse({
    matchId: input.matchId,
    ...(input.includeIneligible ? { includeIneligible: true } : {}),
  });
  const jobId = buildMatchTimelineBullMqJobId({ matchId: payload.matchId });

  const existing = await input.queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (LIVE_STATES.has(state)) {
      return 'alreadyQueued';
    }
    await existing.remove();
  }

  await input.queue.add(MATCH_TIMELINE_JOB_NAME, payload, {
    jobId,
    attempts: input.jobAttempts,
    backoff: {
      type: 'exponential',
      delay: input.backoffBaseMs,
    },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
  return 'published';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let flags: BackfillMatchTimelineFlags;
  try {
    flags = parseBackfillMatchTimelineArgs(argv);
  } catch (error: unknown) {
    const message = error instanceof ValidationFailureError ? error.message : 'Invalid arguments';
    fail(message);
  }

  if (flags.help) {
    printHelp();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail('DATABASE_URL is required.');
  }

  const prisma = new PrismaClient();
  let connection: ReturnType<typeof createRedisConnection> | null = null;
  let queue: Queue<MatchTimelineJobPayload> | null = null;

  const summary = {
    ok: true,
    dryRun: flags.dryRun,
    selected: 0,
    published: 0,
    alreadyQueued: 0,
    failed: 0,
    limit: flags.limit,
    includeIneligible: flags.includeIneligible,
    since: flags.since?.toISOString() ?? null,
  };

  try {
    const matchIds = await selectCandidateMatchIds(prisma, flags);
    summary.selected = matchIds.length;

    if (flags.dryRun) {
      console.log(JSON.stringify(summary));
      return;
    }

    const config = loadMatchTimelineWorkerConfig();
    connection = createRedisConnection();
    queue = new Queue<MatchTimelineJobPayload>(config.queueName || MATCH_TIMELINE_QUEUE_NAME, {
      connection,
      prefix: resolveBullMqPrefix(),
    });

    for (const matchId of matchIds) {
      try {
        const result = await enqueueMatchTimelineJob({
          queue,
          matchId,
          includeIneligible: flags.includeIneligible,
          jobAttempts: config.jobAttempts,
          backoffBaseMs: config.backoffBaseMs,
        });
        if (result === 'alreadyQueued') {
          summary.alreadyQueued += 1;
        } else {
          summary.published += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }

    summary.ok = summary.failed === 0;
    console.log(JSON.stringify(summary));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled([queue?.close(), connection?.quit(), prisma.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : 'unknown');
});
