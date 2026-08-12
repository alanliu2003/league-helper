import type { PrismaClient } from '@prisma/client';
import { MatchIngestionStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  ValidationFailureError,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import type { ParticipantRankEnrichmentWorkerConfig } from '../../config.js';
import { enqueueParticipantRankEnrichment } from '../../queues/participant-rank-enrichment/enqueue.js';
import { rankedQueueTypeForQueueId } from '../../queues/participant-rank-enrichment/queue-type.js';
import { runRankEnrichmentHealth, type RankEnrichmentHealthReport } from './rank-enrichment-health-core.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

const EXPECTED_DB = 'league_helper_m12v2';
const DEFAULT_MAX_PARTICIPANTS = 200;
const DEFAULT_MAX_RIOT_CALLS = 100;
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_POLL_MS = 1_000;

/** Statuses backfill may target. Never FAILED_PERMANENT / RESOLVED_* by default. */
export const BACKFILL_TARGET_STATUSES = ['PENDING', 'FAILED_RETRYABLE'] as const;
export type BackfillTargetStatus = (typeof BACKFILL_TARGET_STATUSES)[number];

export type BackfillParticipantRanksFlags = {
  help: boolean;
  json: boolean;
  dryRun: boolean;
  confirm: boolean;
  wait: boolean;
  platformRoute: string;
  queueId: number;
  patch?: string;
  maxParticipants: number;
  maxRiotCalls: number;
  afterParticipantId?: string;
  waitTimeoutMs: number;
  correlationId?: string;
};

export type BackfillCandidateRow = {
  id: string;
  matchId: string;
  externalAccountId: string;
  rankResolutionStatus: BackfillTargetStatus;
  match: {
    platformRoute: string;
    queueId: number;
  };
};

export type BackfillIdentity = {
  platformRoute: string;
  externalAccountId: string;
  queueType: ParticipantRankEnrichmentJobPayload['queueType'];
  matchId: string;
  participantIds: string[];
  statuses: BackfillTargetStatus[];
};

export type BackfillSelectionResult = {
  identities: BackfillIdentity[];
  participantsSelected: number;
  uniquePuuids: number;
  nextCursor: string | null;
  truncatedByParticipants: boolean;
  truncatedByRiotCalls: boolean;
  pendingRowsSeen: number;
  failedRetryableRowsSeen: number;
};

export type BackfillCostMetrics = {
  participantsAttempted: number;
  uniquePuuids: number;
  jobsPublished: number;
  jobsAlreadyLive: number;
  observationsCreated: number;
  riotCallsEstimated: number;
  cacheHitsEstimated: number;
  observationsReusedEstimated: number;
  resolvedRankedDelta: number;
  resolvedUnrankedDelta: number;
  failedRetryableAfter: number;
  failedPermanentAfter: number;
  pendingAfter: number;
  resolutionYield: number | null;
  riotCallsPerResolvedParticipant: number | null;
  cooldownEventsEstimated: number;
  http429Observations: number;
};

export type BackfillParticipantRanksReport = {
  ok: boolean;
  mode: 'dry-run' | 'enqueue' | 'blocked';
  database: string | null;
  bounds: {
    maxParticipants: number;
    maxRiotCalls: number;
    platformRoute: string;
    queueId: number;
    patch: string | null;
    afterParticipantId: string | null;
  };
  selection: BackfillSelectionResult;
  enqueue?: {
    published: number;
    alreadyLive: number;
    failed: number;
  };
  baselineHealth: RankEnrichmentHealthReport | null;
  afterHealth: RankEnrichmentHealthReport | null;
  cost: BackfillCostMetrics | null;
  waitedMs: number | null;
  error?: string;
};

export type BackfillParticipantRanksResult = {
  exitCode: number;
  report: BackfillParticipantRanksReport;
};

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ValidationFailureError(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(raw: string, name: string, max?: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationFailureError(`${name} must be a positive integer.`, { received: raw });
  }
  if (max !== undefined && value > max) {
    throw new ValidationFailureError(`${name} must be <= ${max}.`, { received: raw });
  }
  return value;
}

export function dbNameFromUrl(url: string | undefined): string | null {
  if (!url?.trim()) {
    return null;
  }
  try {
    return new URL(url).pathname.replace(/^\//, '').split('?')[0] || null;
  } catch {
    return null;
  }
}

function envPositiveInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  return parsePositiveInt(raw, name, max);
}

/**
 * Parse Phase 4 backfill CLI flags.
 * Defaults are developer-key conservative (hundreds, not thousands).
 */
export function parseBackfillParticipantRanksArgs(argv: string[]): BackfillParticipantRanksFlags {
  const flags: BackfillParticipantRanksFlags = {
    help: false,
    json: false,
    dryRun: false,
    confirm: false,
    wait: false,
    platformRoute: 'na1',
    queueId: RANKED_SOLO_QUEUE_ID,
    maxParticipants: envPositiveInt(
      'PARTICIPANT_RANK_BACKFILL_MAX_PARTICIPANTS',
      DEFAULT_MAX_PARTICIPANTS,
      500,
    ),
    maxRiotCalls: envPositiveInt(
      'PARTICIPANT_RANK_BACKFILL_MAX_RIOT_CALLS',
      DEFAULT_MAX_RIOT_CALLS,
      500,
    ),
    waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        flags.help = true;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      case '--confirm':
        flags.confirm = true;
        break;
      case '--wait':
        flags.wait = true;
        break;
      case '--platform': {
        flags.platformRoute = readFlagValue(argv, i, '--platform').trim().toLowerCase();
        i += 1;
        break;
      }
      case '--queue': {
        flags.queueId = parsePositiveInt(readFlagValue(argv, i, '--queue'), '--queue');
        i += 1;
        break;
      }
      case '--patch': {
        flags.patch = readFlagValue(argv, i, '--patch').trim();
        i += 1;
        break;
      }
      case '--max-participants': {
        flags.maxParticipants = parsePositiveInt(
          readFlagValue(argv, i, '--max-participants'),
          '--max-participants',
          500,
        );
        i += 1;
        break;
      }
      case '--max-riot-calls': {
        flags.maxRiotCalls = parsePositiveInt(
          readFlagValue(argv, i, '--max-riot-calls'),
          '--max-riot-calls',
          500,
        );
        i += 1;
        break;
      }
      case '--after-participant-id': {
        flags.afterParticipantId = readFlagValue(argv, i, '--after-participant-id').trim();
        i += 1;
        break;
      }
      case '--wait-timeout-ms': {
        flags.waitTimeoutMs = parsePositiveInt(
          readFlagValue(argv, i, '--wait-timeout-ms'),
          '--wait-timeout-ms',
          3_600_000,
        );
        i += 1;
        break;
      }
      case '--correlation-id': {
        flags.correlationId = readFlagValue(argv, i, '--correlation-id').trim();
        i += 1;
        break;
      }
      default:
        throw new ValidationFailureError(`Unknown argument: ${arg}`);
    }
  }

  if (flags.queueId !== RANKED_SOLO_QUEUE_ID && flags.queueId !== RANKED_FLEX_QUEUE_ID) {
    throw new ValidationFailureError('--queue must be 420 or 440 for rank backfill.');
  }

  return flags;
}

/**
 * Pure selection: PENDING first, then FAILED_RETRYABLE; skip resolved rows.
 * Bounds by max participants and max unique PUUIDs (Riot-call upper bound).
 */
export function selectBackfillIdentities(input: {
  rows: BackfillCandidateRow[];
  maxParticipants: number;
  maxRiotCalls: number;
}): BackfillSelectionResult {
  const pending = input.rows
    .filter((row) => row.rankResolutionStatus === 'PENDING')
    .sort((a, b) => a.id.localeCompare(b.id));
  const retryable = input.rows
    .filter((row) => row.rankResolutionStatus === 'FAILED_RETRYABLE')
    .sort((a, b) => a.id.localeCompare(b.id));
  const ordered = [...pending, ...retryable];

  const identitiesByKey = new Map<string, BackfillIdentity>();
  let participantsSelected = 0;
  let truncatedByParticipants = false;
  let truncatedByRiotCalls = false;
  let lastId: string | null = null;

  for (const row of ordered) {
    const puuid = row.externalAccountId.trim();
    if (!puuid) {
      continue;
    }
    const platformRoute = row.match.platformRoute;
    const queueType = rankedQueueTypeForQueueId(row.match.queueId);
    if (!queueType) {
      continue;
    }

    const key = `${platformRoute}\0${puuid}\0${queueType}`;
    const existing = identitiesByKey.get(key);
    if (!existing && identitiesByKey.size >= input.maxRiotCalls) {
      truncatedByRiotCalls = true;
      break;
    }
    if (participantsSelected >= input.maxParticipants) {
      truncatedByParticipants = true;
      break;
    }

    if (!existing) {
      identitiesByKey.set(key, {
        platformRoute,
        externalAccountId: puuid,
        queueType,
        matchId: row.matchId,
        participantIds: [row.id],
        statuses: [row.rankResolutionStatus],
      });
    } else {
      existing.participantIds.push(row.id);
      if (!existing.statuses.includes(row.rankResolutionStatus)) {
        existing.statuses.push(row.rankResolutionStatus);
      }
    }

    participantsSelected += 1;
    lastId = row.id;
  }

  return {
    identities: [...identitiesByKey.values()],
    participantsSelected,
    uniquePuuids: identitiesByKey.size,
    nextCursor: lastId,
    truncatedByParticipants,
    truncatedByRiotCalls,
    pendingRowsSeen: pending.length,
    failedRetryableRowsSeen: retryable.length,
  };
}

async function loadRowsForStatus(input: {
  prisma: PrismaClient;
  platformRoute: string;
  queueId: number;
  patch?: string;
  afterParticipantId?: string;
  status: BackfillTargetStatus;
  take: number;
}): Promise<BackfillCandidateRow[]> {
  const rows = await input.prisma.matchParticipant.findMany({
    where: {
      rankResolutionStatus: input.status,
      externalAccountId: { not: null },
      ...(input.afterParticipantId ? { id: { gt: input.afterParticipantId } } : {}),
      match: {
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        remake: false,
        platformRoute: input.platformRoute,
        queueId: input.queueId,
        ...(input.patch ? { normalizedPatch: input.patch } : {}),
      },
    },
    select: {
      id: true,
      matchId: true,
      externalAccountId: true,
      rankResolutionStatus: true,
      match: {
        select: {
          platformRoute: true,
          queueId: true,
        },
      },
    },
    orderBy: { id: 'asc' },
    take: input.take,
  });

  return rows
    .filter((row) => typeof row.externalAccountId === 'string' && row.externalAccountId.trim() !== '')
    .map((row) => ({
      id: row.id,
      matchId: row.matchId,
      externalAccountId: row.externalAccountId as string,
      rankResolutionStatus: row.rankResolutionStatus as BackfillTargetStatus,
      match: {
        platformRoute: row.match.platformRoute as string,
        queueId: row.match.queueId,
      },
    }));
}

/**
 * Load PENDING first, then FAILED_RETRYABLE, so priority is not starved by id order.
 */
export async function loadBackfillCandidateRows(input: {
  prisma: PrismaClient;
  platformRoute: string;
  queueId: number;
  patch?: string;
  afterParticipantId?: string;
  /** Per-status fetch headroom. */
  fetchLimit: number;
}): Promise<BackfillCandidateRow[]> {
  const pending = await loadRowsForStatus({ ...input, status: 'PENDING', take: input.fetchLimit });
  const retryable = await loadRowsForStatus({
    ...input,
    status: 'FAILED_RETRYABLE',
    take: input.fetchLimit,
  });
  return [...pending, ...retryable];
}

function emptyCost(participantsAttempted: number, uniquePuuids: number): BackfillCostMetrics {
  return {
    participantsAttempted,
    uniquePuuids,
    jobsPublished: 0,
    jobsAlreadyLive: 0,
    observationsCreated: 0,
    riotCallsEstimated: 0,
    cacheHitsEstimated: 0,
    observationsReusedEstimated: 0,
    resolvedRankedDelta: 0,
    resolvedUnrankedDelta: 0,
    failedRetryableAfter: 0,
    failedPermanentAfter: 0,
    pendingAfter: 0,
    resolutionYield: null,
    riotCallsPerResolvedParticipant: null,
    cooldownEventsEstimated: 0,
    http429Observations: 0,
  };
}

function isRiotCallObservationCode(code: string | null | undefined): boolean {
  if (!code) {
    return false;
  }
  const normalized = code.toUpperCase();
  if (normalized === 'SHARED_COOLDOWN_ACTIVE' || normalized === 'MISSING_PUUID') {
    return false;
  }
  return (
    normalized.startsWith('HTTP_') ||
    normalized === 'PROVIDER_ERROR' ||
    normalized.startsWith('HTTP_5XX')
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForEnrichmentQueueIdle(input: {
  queue: Queue;
  timeoutMs: number;
  pollMs?: number;
}): Promise<{ idle: boolean; waitedMs: number }> {
  const pollMs = input.pollMs ?? DEFAULT_WAIT_POLL_MS;
  const started = Date.now();
  while (Date.now() - started < input.timeoutMs) {
    const counts = await input.queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
    const live =
      (counts.waiting ?? 0) +
      (counts.active ?? 0) +
      (counts.delayed ?? 0) +
      (counts.prioritized ?? 0);
    if (live === 0) {
      return { idle: true, waitedMs: Date.now() - started };
    }
    await sleep(pollMs);
  }
  return { idle: false, waitedMs: Date.now() - started };
}

export type RunBackfillParticipantRanksInput = {
  prisma: PrismaClient;
  flags: BackfillParticipantRanksFlags;
  databaseUrl?: string;
  allowAnyDatabase?: boolean;
  enrichmentQueue?: Queue<ParticipantRankEnrichmentJobPayload> | null;
  enrichmentConfig?: ParticipantRankEnrichmentWorkerConfig | null;
  now?: () => Date;
};

/**
 * Bounded, resumable, idempotent backfill via the existing enrichment queue.
 * Does not call Riot directly — the participant-rank-enrichment worker does.
 */
export async function runBackfillParticipantRanks(
  input: RunBackfillParticipantRanksInput,
): Promise<BackfillParticipantRanksResult> {
  const dbName = dbNameFromUrl(input.databaseUrl);
  if (!input.allowAnyDatabase && dbName !== EXPECTED_DB) {
    const abandoned = dbName === 'league_helper';
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        mode: 'blocked',
        database: dbName,
        bounds: {
          maxParticipants: input.flags.maxParticipants,
          maxRiotCalls: input.flags.maxRiotCalls,
          platformRoute: input.flags.platformRoute,
          queueId: input.flags.queueId,
          patch: input.flags.patch ?? null,
          afterParticipantId: input.flags.afterParticipantId ?? null,
        },
        selection: {
          identities: [],
          participantsSelected: 0,
          uniquePuuids: 0,
          nextCursor: null,
          truncatedByParticipants: false,
          truncatedByRiotCalls: false,
          pendingRowsSeen: 0,
          failedRetryableRowsSeen: 0,
        },
        baselineHealth: null,
        afterHealth: null,
        cost: null,
        waitedMs: null,
        error: abandoned
          ? 'Refusing to touch abandoned DB league_helper.'
          : `Refusing to run: DATABASE must be ${EXPECTED_DB} (got ${dbName ?? 'unknown'}).`,
      },
    };
  }

  if (!input.flags.dryRun && !input.flags.confirm) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        mode: 'blocked',
        database: dbName,
        bounds: {
          maxParticipants: input.flags.maxParticipants,
          maxRiotCalls: input.flags.maxRiotCalls,
          platformRoute: input.flags.platformRoute,
          queueId: input.flags.queueId,
          patch: input.flags.patch ?? null,
          afterParticipantId: input.flags.afterParticipantId ?? null,
        },
        selection: {
          identities: [],
          participantsSelected: 0,
          uniquePuuids: 0,
          nextCursor: null,
          truncatedByParticipants: false,
          truncatedByRiotCalls: false,
          pendingRowsSeen: 0,
          failedRetryableRowsSeen: 0,
        },
        baselineHealth: null,
        afterHealth: null,
        cost: null,
        waitedMs: null,
        error: 'Mutating backfill requires --confirm (or use --dry-run).',
      },
    };
  }

  const healthFilters = {
    platformRoute: input.flags.platformRoute,
    queueId: input.flags.queueId,
    ...(input.flags.patch ? { patch: input.flags.patch } : {}),
  };

  const baselineHealth = await runRankEnrichmentHealth({
    prisma: input.prisma,
    filters: healthFilters,
  });

  const fetchLimit = Math.max(input.flags.maxParticipants * 3, input.flags.maxRiotCalls * 3, 50);
  const rows = await loadBackfillCandidateRows({
    prisma: input.prisma,
    platformRoute: input.flags.platformRoute,
    queueId: input.flags.queueId,
    patch: input.flags.patch,
    afterParticipantId: input.flags.afterParticipantId,
    fetchLimit,
  });

  const selection = selectBackfillIdentities({
    rows,
    maxParticipants: input.flags.maxParticipants,
    maxRiotCalls: input.flags.maxRiotCalls,
  });

  const bounds = {
    maxParticipants: input.flags.maxParticipants,
    maxRiotCalls: input.flags.maxRiotCalls,
    platformRoute: input.flags.platformRoute,
    queueId: input.flags.queueId,
    patch: input.flags.patch ?? null,
    afterParticipantId: input.flags.afterParticipantId ?? null,
  };

  if (input.flags.dryRun) {
    return {
      exitCode: EXIT_SUCCESS,
      report: {
        ok: true,
        mode: 'dry-run',
        database: dbName,
        bounds,
        selection,
        baselineHealth: baselineHealth.report,
        afterHealth: null,
        cost: emptyCost(selection.participantsSelected, selection.uniquePuuids),
        waitedMs: null,
      },
    };
  }

  if (!input.enrichmentQueue || !input.enrichmentConfig) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        mode: 'blocked',
        database: dbName,
        bounds,
        selection,
        baselineHealth: baselineHealth.report,
        afterHealth: null,
        cost: null,
        waitedMs: null,
        error: 'Enrichment queue/config required for mutating backfill.',
      },
    };
  }

  const observationCutoff = (input.now?.() ?? new Date()).toISOString();
  let published = 0;
  let alreadyLive = 0;
  let failed = 0;

  for (const identity of selection.identities) {
    try {
      const result = await enqueueParticipantRankEnrichment({
        queue: input.enrichmentQueue,
        config: input.enrichmentConfig,
        payload: {
          platformRoute: identity.platformRoute as ParticipantRankEnrichmentJobPayload['platformRoute'],
          externalAccountId: identity.externalAccountId,
          queueType: identity.queueType,
          reason: 'BACKFILL',
          matchId: identity.matchId,
          ...(input.flags.correlationId
            ? { correlationId: input.flags.correlationId }
            : {}),
        },
      });
      if (result.alreadyLive) {
        alreadyLive += 1;
      } else {
        published += 1;
      }
    } catch {
      failed += 1;
    }
  }

  let waitedMs: number | null = null;
  if (input.flags.wait && selection.identities.length > 0) {
    const waitResult = await waitForEnrichmentQueueIdle({
      queue: input.enrichmentQueue,
      timeoutMs: input.flags.waitTimeoutMs,
    });
    waitedMs = waitResult.waitedMs;
  }

  const afterHealth = await runRankEnrichmentHealth({
    prisma: input.prisma,
    filters: healthFilters,
  });

  const newObservations = await input.prisma.participantRankObservation.findMany({
    where: {
      observedAt: { gte: new Date(observationCutoff) },
    },
    select: {
      resolutionStatus: true,
      providerResultCode: true,
      externalAccountId: true,
    },
  });

  const attemptedIds = selection.identities.flatMap((identity) => identity.participantIds);
  const attemptedAfter =
    attemptedIds.length === 0
      ? []
      : await input.prisma.matchParticipant.findMany({
          where: { id: { in: attemptedIds } },
          select: { id: true, rankResolutionStatus: true },
        });
  const statusById = new Map(
    attemptedAfter.map((row) => [row.id, row.rankResolutionStatus] as const),
  );

  const resolvedAfter = attemptedAfter.filter(
    (row) =>
      row.rankResolutionStatus === 'RESOLVED_RANKED' ||
      row.rankResolutionStatus === 'RESOLVED_UNRANKED',
  ).length;
  const resolvedRankedDelta = attemptedAfter.filter(
    (row) => row.rankResolutionStatus === 'RESOLVED_RANKED',
  ).length;
  const resolvedUnrankedDelta = attemptedAfter.filter(
    (row) => row.rankResolutionStatus === 'RESOLVED_UNRANKED',
  ).length;

  const riotCallsEstimated = newObservations.filter((obs) =>
    isRiotCallObservationCode(obs.providerResultCode),
  ).length;
  const http429Observations = newObservations.filter(
    (obs) => (obs.providerResultCode ?? '').toUpperCase() === 'HTTP_429',
  ).length;
  const cooldownEventsEstimated = newObservations.filter(
    (obs) => (obs.providerResultCode ?? '').toUpperCase() === 'SHARED_COOLDOWN_ACTIVE',
  ).length;

  // Identities that ended resolved without a new observation ≈ cache / reuse.
  const observedPuuids = new Set(newObservations.map((obs) => obs.externalAccountId));
  const cacheHitsEstimated = selection.identities.filter((identity) => {
    if (observedPuuids.has(identity.externalAccountId)) {
      return false;
    }
    return identity.participantIds.every((id) => {
      const status = statusById.get(id);
      return status === 'RESOLVED_RANKED' || status === 'RESOLVED_UNRANKED';
    });
  }).length;

  const participantsAttempted = selection.participantsSelected;
  const resolutionYield =
    participantsAttempted > 0 ? resolvedAfter / participantsAttempted : null;
  const riotCallsPerResolvedParticipant =
    resolvedAfter > 0 ? riotCallsEstimated / resolvedAfter : null;

  const cost: BackfillCostMetrics = {
    participantsAttempted,
    uniquePuuids: selection.uniquePuuids,
    jobsPublished: published,
    jobsAlreadyLive: alreadyLive,
    observationsCreated: newObservations.length,
    riotCallsEstimated,
    cacheHitsEstimated,
    observationsReusedEstimated: cacheHitsEstimated,
    resolvedRankedDelta,
    resolvedUnrankedDelta,
    failedRetryableAfter: attemptedAfter.filter(
      (row) => row.rankResolutionStatus === 'FAILED_RETRYABLE',
    ).length,
    failedPermanentAfter: attemptedAfter.filter(
      (row) => row.rankResolutionStatus === 'FAILED_PERMANENT',
    ).length,
    pendingAfter: attemptedAfter.filter((row) => row.rankResolutionStatus === 'PENDING').length,
    resolutionYield,
    riotCallsPerResolvedParticipant,
    cooldownEventsEstimated,
    http429Observations,
  };

  return {
    exitCode: failed > 0 ? EXIT_COMMAND_FAILURE : EXIT_SUCCESS,
    report: {
      ok: failed === 0,
      mode: 'enqueue',
      database: dbName,
      bounds,
      selection,
      enqueue: { published, alreadyLive, failed },
      baselineHealth: baselineHealth.report,
      afterHealth: afterHealth.report,
      cost,
      waitedMs,
    },
  };
}

export {
  DEFAULT_MAX_PARTICIPANTS,
  DEFAULT_MAX_RIOT_CALLS,
  DEFAULT_WAIT_TIMEOUT_MS,
  EXPECTED_DB,
};
