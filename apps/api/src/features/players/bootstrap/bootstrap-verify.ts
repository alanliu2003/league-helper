import {
  ALL_POSITION_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
} from '@league-helper/match-analytics';
import { MATCH_INGESTION_JOB_NAME } from '@league-helper/shared';
import type { PrismaClient } from '@prisma/client';

export type WaitSummary = {
  completed: number;
  failed: number;
  skipped: number;
  pending: number;
  timedOut: boolean;
  checkedMatchCount: number;
};

export type MatchIngestionProbe = {
  externalMatchId: string;
  ingestionStatus: string;
};

export type DurableJobProbe = {
  externalResourceId: string | null;
  status: string;
};

export type WaitForMatchIngestionDeps = {
  findMatchesByExternalIds: (
    provider: string,
    externalMatchIds: string[],
  ) => Promise<MatchIngestionProbe[]>;
  findDurableJobsByExternalIds: (
    provider: string,
    externalMatchIds: string[],
  ) => Promise<DurableJobProbe[]>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type AggregateSmokeRow = {
  championId: number;
  teamPosition: string;
  sampleSize: number;
  queueId: number;
};

export type AggregateSmokeLookup = {
  ok: boolean;
  row?: AggregateSmokeRow;
};

export type AggregateSmokeStatus =
  | 'passed'
  | 'failed'
  | 'pending'
  | 'inconclusive'
  | 'skipped';

export type AggregateSmokeResult = {
  status: AggregateSmokeStatus;
  /** false only for definitive smoke failure (exit 1). */
  ok: boolean;
  row?: AggregateSmokeRow;
  message?: string;
};

type TerminalKind = 'completed' | 'failed' | 'skipped' | 'pending';

function classifyMatchStatus(status: string | undefined): TerminalKind | undefined {
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED') return 'failed';
  if (status === 'SKIPPED') return 'skipped';
  if (status === 'PENDING' || status === 'IN_PROGRESS') return 'pending';
  return undefined;
}

function classifyDurableStatus(status: string | undefined): TerminalKind | undefined {
  if (status === 'COMPLETED') return 'completed';
  if (status === 'FAILED' || status === 'DEAD_LETTERED') return 'failed';
  if (status === 'CANCELLED') return 'skipped';
  if (
    status === 'PENDING' ||
    status === 'QUEUED' ||
    status === 'RUNNING'
  ) {
    return 'pending';
  }
  return undefined;
}

function classifyExternalId(
  matchStatus: string | undefined,
  jobStatus: string | undefined,
): TerminalKind {
  const fromMatch = classifyMatchStatus(matchStatus);
  if (fromMatch !== undefined) {
    return fromMatch;
  }
  const fromJob = classifyDurableStatus(jobStatus);
  if (fromJob !== undefined) {
    return fromJob;
  }
  return 'pending';
}

function summarizeStatuses(
  externalMatchIds: string[],
  matches: MatchIngestionProbe[],
  jobs: DurableJobProbe[],
): Omit<WaitSummary, 'timedOut'> {
  const matchById = new Map(matches.map((m) => [m.externalMatchId, m.ingestionStatus]));
  const jobById = new Map(
    jobs
      .filter((j) => j.externalResourceId)
      .map((j) => [j.externalResourceId as string, j.status]),
  );

  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;

  for (const id of externalMatchIds) {
    const kind = classifyExternalId(matchById.get(id), jobById.get(id));
    if (kind === 'completed') completed += 1;
    else if (kind === 'failed') failed += 1;
    else if (kind === 'skipped') skipped += 1;
    else pending += 1;
  }

  return {
    completed,
    failed,
    skipped,
    pending,
    checkedMatchCount: externalMatchIds.length,
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll Match / durable ingestion state for IDs from this bootstrap run only.
 * Bounded by timeoutMs / pollIntervalMs — no new monitoring subsystem.
 */
export async function waitForMatchIngestion(
  deps: WaitForMatchIngestionDeps,
  input: {
    provider: string;
    externalMatchIds: string[];
    timeoutMs: number;
    pollIntervalMs: number;
  },
): Promise<WaitSummary> {
  const ids = [...new Set(input.externalMatchIds)];
  if (ids.length === 0) {
    return {
      completed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      timedOut: false,
      checkedMatchCount: 0,
    };
  }

  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const started = now();
  const timeoutMs = Math.max(0, input.timeoutMs);
  const pollIntervalMs = Math.max(1, input.pollIntervalMs);

  for (;;) {
    const [matches, jobs] = await Promise.all([
      deps.findMatchesByExternalIds(input.provider, ids),
      deps.findDurableJobsByExternalIds(input.provider, ids),
    ]);
    const counts = summarizeStatuses(ids, matches, jobs);
    if (counts.pending === 0) {
      return { ...counts, timedOut: false };
    }

    const elapsed = now() - started;
    if (elapsed >= timeoutMs) {
      return { ...counts, timedOut: true };
    }

    const remaining = timeoutMs - elapsed;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}

/** Prisma-backed adapters for waitForMatchIngestion. */
export function createWaitDepsFromPrisma(prisma: PrismaClient): WaitForMatchIngestionDeps {
  return {
    findMatchesByExternalIds: async (provider, externalMatchIds) => {
      if (externalMatchIds.length === 0) return [];
      const rows = await prisma.match.findMany({
        where: { provider, externalMatchId: { in: externalMatchIds } },
        select: { externalMatchId: true, ingestionStatus: true },
      });
      return rows.map((row) => ({
        externalMatchId: row.externalMatchId,
        ingestionStatus: row.ingestionStatus,
      }));
    },
    findDurableJobsByExternalIds: async (provider, externalMatchIds) => {
      if (externalMatchIds.length === 0) return [];
      const rows = await prisma.ingestionJobRecord.findMany({
        where: {
          jobType: MATCH_INGESTION_JOB_NAME,
          provider,
          externalResourceId: { in: externalMatchIds },
        },
        select: { externalResourceId: true, status: true },
      });
      return rows.map((row) => ({
        externalResourceId: row.externalResourceId,
        status: row.status,
      }));
    },
  };
}

/**
 * Pipeline health smoke: ≥1 ChampionAggregate with queueId=420, known position, sampleSize>0.
 * Independent of the UI minimumSample floor (30).
 */
export async function checkAggregateSmoke(
  prisma: Pick<PrismaClient, 'championAggregate'>,
): Promise<AggregateSmokeLookup> {
  const row = await prisma.championAggregate.findFirst({
    where: {
      queueId: 420,
      sampleSize: { gt: 0 },
      teamPosition: { notIn: [ALL_POSITION_SENTINEL, UNKNOWN_POSITION_SENTINEL, ''] },
    },
    select: {
      championId: true,
      teamPosition: true,
      sampleSize: true,
      queueId: true,
    },
  });
  return { ok: row !== null, row: row ?? undefined };
}

/**
 * Map smoke lookup + wait context into ops-facing status.
 * Wait timeout with pending jobs → inconclusive (not a definitive pipeline failure).
 */
export function resolveAggregateSmokeForRun(input: {
  dryRun: boolean;
  waitEnabled: boolean;
  waitSummary: WaitSummary | undefined;
  smokeLookup: AggregateSmokeLookup;
}): AggregateSmokeResult {
  if (input.dryRun) {
    return {
      status: 'skipped',
      ok: true,
      message: 'Aggregate smoke skipped for dry-run.',
    };
  }

  if (!input.waitEnabled) {
    return {
      status: 'pending',
      ok: true,
      message:
        'Aggregate smoke not yet observed — run with --wait after workers process jobs, or check later.',
    };
  }

  if (input.waitSummary?.timedOut && (input.waitSummary.pending ?? 0) > 0) {
    return {
      status: 'inconclusive',
      ok: true,
      message:
        'Wait timed out with pending ingestion jobs; aggregate smoke is inconclusive (not a definitive failure).',
    };
  }

  if (input.smokeLookup.ok && input.smokeLookup.row) {
    return {
      status: 'passed',
      ok: true,
      row: input.smokeLookup.row,
    };
  }

  return {
    status: 'failed',
    ok: false,
    message:
      'No ChampionAggregate sample yet (queueId=420, known position, sampleSize>0) — ensure worker ran / aggregates:reconcile.',
  };
}
