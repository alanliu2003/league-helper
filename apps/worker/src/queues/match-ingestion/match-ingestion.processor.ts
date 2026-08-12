import { DelayedError, UnrecoverableError, type Job, type Queue } from 'bullmq';
import {
  ChampionAggregationProcessingStatus,
  IngestionJobStatus,
  MatchIngestionStatus,
  TimelineFetchStatus,
  type PrismaClient,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import { withRiotWorkload, type RiotSharedCooldownStore } from '@league-helper/server-riot';
import type {
  ChampionAggregationJobPayload,
  GameDataProvider,
  ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import {
  MATCH_INGESTION_JOB_NAME,
  MatchIngestionJobPayloadSchema,
  ProviderRateLimitedError,
  buildMatchIngestionIdempotencyKey,
  type MatchIngestionJobPayload,
  ValidationFailureError,
} from '@league-helper/shared';
import type {
  ChampionAggregationWorkerConfig,
  MatchIngestionWorkerConfig,
  ParticipantRankEnrichmentWorkerConfig,
} from '../../config.js';
import { logger } from '../../logger.js';
import { createChampionAggregationRepository } from '../champion-aggregation/champion-aggregation.repository.js';
import { enqueueChampionAggregationAfterCommit } from '../champion-aggregation/enqueue.js';
import type { PreviousParticipantDimensionSnapshot } from '../champion-aggregation/previous-keys.js';
import { enqueueRankEnrichmentForCompletedMatch } from '../participant-rank-enrichment/ingestion-hook.js';
import { classifyIngestionError } from './ingestion-error-classifier.js';
import { invalidatePlayerProfileCaches } from './ingestion-cache-invalidator.js';
import { safeJobId, truncateMatchId } from './log-safe.js';
import { normalizeMatch } from './match-normalizer.js';
import {
  ensurePlayerLinkageForCompletedMatch,
  markDurableJobRunning,
  markDurableJobStatus,
  persistNormalizedMatch,
  persistTimelineAndMetrics,
  resolvePlayerAccountLinks,
} from './match-persistence.js';
import { expandMatchParticipantsSafe } from '../../collector/expand-match-participants-safe.js';
import { extractBuildRelevantTimelineEvents } from './timeline-build-events.js';
import { calculateTimelineMetrics } from './timeline-metrics.service.js';
import { normalizeTimeline } from './timeline-normalizer.js';

export type MatchIngestionProcessorDeps = {
  prisma: PrismaClient;
  provider: GameDataProvider;
  redis: Redis;
  config: MatchIngestionWorkerConfig;
  championAggregationQueue: Queue<ChampionAggregationJobPayload>;
  championAggregationConfig: ChampionAggregationWorkerConfig;
  /** Optional in unit tests; production wires the enrichment queue. */
  participantRankEnrichmentQueue?: Queue<ParticipantRankEnrichmentJobPayload> | null;
  participantRankEnrichmentConfig?: ParticipantRankEnrichmentWorkerConfig | null;
  /** Optional for unit tests; production wires Redis-backed store. */
  sharedCooldown?: RiotSharedCooldownStore | null;
};

async function shouldEnqueueChampionAggregation(input: {
  prisma: PrismaClient;
  matchId: string;
  config: ChampionAggregationWorkerConfig;
}): Promise<boolean> {
  const marker = await input.prisma.championAggregationProcessing.findUnique({
    where: {
      matchId_sourceNormalizationVersion_aggregationVersion: {
        matchId: input.matchId,
        sourceNormalizationVersion: input.config.sourceNormalizationVersion,
        aggregationVersion: input.config.aggregationVersion,
      },
    },
    select: { status: true },
  });
  if (!marker) {
    return true;
  }
  // Re-enqueue when prior attempt failed or scope is pending (absent COMPLETED).
  return marker.status !== ChampionAggregationProcessingStatus.COMPLETED;
}

async function enqueueAggregationSafe(input: {
  deps: MatchIngestionProcessorDeps;
  matchId: string;
  previousSnapshots: PreviousParticipantDimensionSnapshot[];
  correlationId?: string;
}): Promise<void> {
  const repository = createChampionAggregationRepository(input.deps.prisma);
  await enqueueChampionAggregationAfterCommit({
    queue: input.deps.championAggregationQueue,
    repository,
    config: input.deps.championAggregationConfig,
    matchId: input.matchId,
    previousSnapshots: input.previousSnapshots,
    correlationId: input.correlationId,
  });
}

async function enqueueRankEnrichmentSafe(input: {
  deps: MatchIngestionProcessorDeps;
  matchId: string;
  correlationId?: string;
}): Promise<void> {
  try {
    await enqueueRankEnrichmentForCompletedMatch({
      prisma: input.deps.prisma,
      matchId: input.matchId,
      queue: input.deps.participantRankEnrichmentQueue,
      config: input.deps.participantRankEnrichmentConfig,
      correlationId: input.correlationId,
    });
  } catch (error: unknown) {
    logger.warn('participant_rank_enrichment_hook_failed', {
      matchId: input.matchId,
      correlationId: input.correlationId,
      code: 'PARTICIPANT_RANK_ENRICHMENT_HOOK_FAILED',
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
  }
}

function boundDelayMs(retryAfterSeconds: number, config: MatchIngestionWorkerConfig): number {
  const requested = Math.max(0, retryAfterSeconds) * 1000;
  return Math.min(Math.max(requested, config.backoffBaseMs), config.backoffMaxMs);
}

function retryAfterMsFromRateLimited(error: ProviderRateLimitedError): number | null {
  const details = error.details;
  if (
    details === null ||
    typeof details !== 'object' ||
    !('retryAfterSeconds' in details)
  ) {
    return null;
  }
  const seconds = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.round(seconds * 1_000);
}

async function publishSharedCooldownFrom429(input: {
  deps: MatchIngestionProcessorDeps;
  error: ProviderRateLimitedError;
}): Promise<void> {
  if (!input.deps.sharedCooldown) {
    return;
  }
  await input.deps.sharedCooldown.extendCooldown({
    now: Date.now(),
    configuredFloorMs: input.deps.config.riotShared429CooldownMinMs,
    retryAfterMs: retryAfterMsFromRateLimited(input.error),
    source: 'worker',
  });
}

async function delayJobForSharedCooldown(input: {
  job: Job<MatchIngestionJobPayload>;
  token: string | undefined;
  durableJobId: string | undefined;
  deps: MatchIngestionProcessorDeps;
  correlationId?: string;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}): Promise<never> {
  if (input.durableJobId) {
    await markDurableJobStatus({
      prisma: input.deps.prisma,
      durableJobId: input.durableJobId,
      status: IngestionJobStatus.FAILED,
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
    });
  }

  const now = Date.now();
  const bound = boundDelayMs(input.retryAfterSeconds ?? 2, input.deps.config);
  const remainingShared = input.deps.sharedCooldown
    ? await input.deps.sharedCooldown.remainingMs(now)
    : 0;
  const delayMs = Math.max(bound, remainingShared, input.deps.config.backoffBaseMs);

  logger.warn('Delayed rate limit', {
    correlationId: input.correlationId,
    jobId: safeJobId(input.job.id),
    code: input.code,
    delayMs,
    remainingSharedMs: remainingShared,
  });
  if (input.token) {
    await input.job.moveToDelayed(now + delayMs, input.token);
  }
  throw new DelayedError();
}

async function handleClassifiedFailure(input: {
  job: Job<MatchIngestionJobPayload>;
  token: string | undefined;
  durableJobId: string | undefined;
  deps: MatchIngestionProcessorDeps;
  error: unknown;
  correlationId?: string;
  startedAt: number;
}): Promise<never> {
  const classified = classifyIngestionError(input.error);
  const attemptsMade = input.job.attemptsMade + 1;
  const maxAttempts = input.job.opts.attempts ?? input.deps.config.jobAttempts;
  const exhausted = attemptsMade >= maxAttempts && classified.kind !== 'delayed';

  if (classified.kind === 'delayed') {
    // Proactive budget deferrals must NOT publish the emergency 429 cooldown.
    if (input.error instanceof ProviderRateLimitedError) {
      await publishSharedCooldownFrom429({ deps: input.deps, error: input.error });
    }
    await delayJobForSharedCooldown({
      job: input.job,
      token: input.token,
      durableJobId: input.durableJobId,
      deps: input.deps,
      correlationId: input.correlationId,
      code: classified.code,
      message: classified.message,
      retryAfterSeconds: classified.retryAfterSeconds,
    });
  }

  if (classified.kind === 'permanent') {
    if (input.durableJobId) {
      await markDurableJobStatus({
        prisma: input.deps.prisma,
        durableJobId: input.durableJobId,
        status: IngestionJobStatus.DEAD_LETTERED,
        lastErrorCode: classified.code,
        lastErrorMessage: classified.message,
      });
    }
    logger.error('Permanent fail', {
      correlationId: input.correlationId,
      jobId: safeJobId(input.job.id),
      code: classified.code,
      attempt: attemptsMade,
      durationMs: Date.now() - input.startedAt,
      deadLettered: true,
    });
    throw new UnrecoverableError(classified.message);
  }

  // retryable
  const status =
    exhausted || attemptsMade >= maxAttempts
      ? IngestionJobStatus.DEAD_LETTERED
      : IngestionJobStatus.FAILED;
  if (input.durableJobId) {
    await markDurableJobStatus({
      prisma: input.deps.prisma,
      durableJobId: input.durableJobId,
      status,
      lastErrorCode: classified.code,
      lastErrorMessage: classified.message,
    });
  }

  if (status === IngestionJobStatus.DEAD_LETTERED) {
    logger.error('Permanent fail', {
      correlationId: input.correlationId,
      jobId: safeJobId(input.job.id),
      code: classified.code,
      attempt: attemptsMade,
      durationMs: Date.now() - input.startedAt,
      deadLettered: true,
    });
    throw new UnrecoverableError(classified.message);
  }

  logger.warn('Retry scheduled', {
    correlationId: input.correlationId,
    jobId: safeJobId(input.job.id),
    code: classified.code,
    kind: classified.kind,
    attempt: attemptsMade,
    durationMs: Date.now() - input.startedAt,
  });
  throw input.error instanceof Error ? input.error : new Error(classified.message);
}

/**
 * Orchestrate a single INGEST_MATCH job.
 * Does not start during import — call from the BullMQ worker processor only.
 */
export async function processMatchIngestionJob(
  job: Job<MatchIngestionJobPayload>,
  token: string | undefined,
  deps: MatchIngestionProcessorDeps,
): Promise<{ status: 'completed' | 'already_complete' }> {
  const startedAt = Date.now();
  let durableJobId: string | undefined;

  if (job.name !== MATCH_INGESTION_JOB_NAME) {
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const parsed = MatchIngestionJobPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error('Permanent fail', {
      jobId: safeJobId(job.id),
      code: 'VALIDATION_ERROR',
      attempt: job.attemptsMade + 1,
      reason: 'invalid_payload',
    });
    throw new UnrecoverableError('Match ingestion payload failed validation.');
  }

  const payload = parsed.data;
  const correlationId = payload.correlationId;
  const truncatedMatchId = truncateMatchId(payload.externalMatchId);

  logger.info('Job received', {
    correlationId,
    jobId: safeJobId(job.id),
    matchId: truncatedMatchId,
    regionalRoute: payload.regionalRoute,
    attempt: job.attemptsMade + 1,
  });

  const idempotencyKey = buildMatchIngestionIdempotencyKey({
    provider: payload.provider,
    regionalRoute: payload.regionalRoute,
    externalMatchId: payload.externalMatchId,
    normalizationVersion: payload.normalizationVersion,
  });

  try {
    const durable = await markDurableJobRunning({
      prisma: deps.prisma,
      idempotencyKey,
      provider: payload.provider,
      externalMatchId: payload.externalMatchId,
      attemptCount: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? deps.config.jobAttempts,
      metadata: payload,
    });
    durableJobId = durable.id;

    const existing = await deps.prisma.match.findUnique({
      where: {
        provider_externalMatchId: {
          provider: payload.provider,
          externalMatchId: payload.externalMatchId,
        },
      },
      select: {
        id: true,
        ingestionStatus: true,
        normalizationVersion: true,
      },
    });

    // When COMPLETED rows omit the requesting player's PUUID, refetch + force
    // overwrite (persist otherwise short-circuits on complete-or-newer).
    let forcePersistOverwrite = false;
    const existingVersion = existing ? Number(existing.normalizationVersion) : -1;
    if (
      existing &&
      existing.ingestionStatus === MatchIngestionStatus.COMPLETED &&
      Number.isFinite(existingVersion) &&
      existingVersion >= payload.normalizationVersion
    ) {
      // COMPLETED rows whose participants omit the requesting player's PUUID are
      // corrupt/stale vs Riot. Fall through to refetch; do not short-circuit.
      const requestingAccount = await deps.prisma.playerAccount.findUnique({
        where: { id: payload.requestedByPlayerAccountId },
        select: { externalAccountId: true },
      });
      const requestingPuuidPresent =
        requestingAccount?.externalAccountId != null &&
        (await deps.prisma.matchParticipant.findFirst({
          where: {
            matchId: existing.id,
            externalAccountId: requestingAccount.externalAccountId,
          },
          select: { id: true },
        })) != null;

      if (!requestingPuuidPresent) {
        forcePersistOverwrite = true;
        logger.warn('Completed match missing requesting player; refetching', {
          correlationId,
          jobId: safeJobId(job.id),
          matchId: truncatedMatchId,
          regionalRoute: payload.regionalRoute,
        });
      } else {
        logger.info('Match already complete', {
          correlationId,
          jobId: safeJobId(job.id),
          matchId: truncatedMatchId,
          regionalRoute: payload.regionalRoute,
        });

        const linkedIds = await ensurePlayerLinkageForCompletedMatch({
          prisma: deps.prisma,
          provider: payload.provider,
          externalMatchId: payload.externalMatchId,
          requestedByPlayerAccountId: payload.requestedByPlayerAccountId,
        });

        await markDurableJobStatus({
          prisma: deps.prisma,
          durableJobId,
          status: IngestionJobStatus.COMPLETED,
        });

        // Post-commit only: enqueue agg when marker absent/stale (lost enqueue repair).
        if (
          await shouldEnqueueChampionAggregation({
            prisma: deps.prisma,
            matchId: existing.id,
            config: deps.championAggregationConfig,
          })
        ) {
          await enqueueAggregationSafe({
            deps,
            matchId: existing.id,
            previousSnapshots: [],
            correlationId,
          });
        }

        // Post-COMPLETED only; non-fatal. Uses persisted MatchParticipant rows.
        await expandMatchParticipantsSafe({
          prisma: deps.prisma,
          matchId: existing.id,
          requestedByPlayerAccountId: payload.requestedByPlayerAccountId,
          sourceCollectorRunId: payload.sourceCollectorRunId,
          correlationId,
        });

        // Async rank enrichment — never blocks INGEST_MATCH on League-v4.
        await enqueueRankEnrichmentSafe({
          deps,
          matchId: existing.id,
          correlationId,
        });

        await invalidatePlayerProfileCaches({
          prisma: deps.prisma,
          redis: deps.redis,
          playerAccountIds: linkedIds,
          correlationId,
          jobId: safeJobId(job.id),
        });

        logger.info('Completed', {
          correlationId,
          jobId: safeJobId(job.id),
          matchId: truncatedMatchId,
          regionalRoute: payload.regionalRoute,
          attempt: job.attemptsMade + 1,
          durationMs: Date.now() - startedAt,
          alreadyComplete: true,
        });

        return { status: 'already_complete' };
      }
    }

    // Shared Riot cooldown gate — after already_complete short-circuit, before getMatch.
    if (deps.sharedCooldown) {
      const now = Date.now();
      const remainingMs = await deps.sharedCooldown.remainingMs(now);
      if (remainingMs > 0) {
        await delayJobForSharedCooldown({
          job,
          token,
          durableJobId,
          deps,
          correlationId,
          code: 'PROVIDER_RATE_LIMITED',
          message: 'Shared Riot 429 cooldown active; delaying match fetch.',
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        });
      }
    }

    logger.info('Match fetch start', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      regionalRoute: payload.regionalRoute,
    });

    const rawMatch = await withRiotWorkload('match', () =>
      deps.provider.getMatch(payload.externalMatchId, payload.regionalRoute),
    );

    logger.info('Match fetch complete', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      regionalRoute: payload.regionalRoute,
      durationMs: Date.now() - startedAt,
    });

    const normalized = normalizeMatch({
      raw: rawMatch,
      regionalRoute: payload.regionalRoute,
      normalizationVersion: payload.normalizationVersion,
      storeRawPayloads: deps.config.storeRawPayloads,
    });

    if (normalized.externalMatchId !== payload.externalMatchId) {
      throw new ValidationFailureError('Fetched match id does not match job payload.');
    }

    const externalIds = normalized.participants
      .map((participant) => participant.externalAccountId)
      .filter((id): id is string => Boolean(id));
    const accountLinks = await resolvePlayerAccountLinks(
      deps.prisma,
      payload.provider,
      externalIds,
    );

    const persisted = await persistNormalizedMatch(deps.prisma, normalized, accountLinks, {
      forceOverwrite: forcePersistOverwrite,
    });

    logger.info('Persistence committed', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      created: persisted.created,
      skippedComplete: persisted.skippedComplete,
      forceOverwrite: forcePersistOverwrite,
      participantCount: normalized.participants.length,
      teamCount: normalized.teams.length,
    });

    let timelineStatus: TimelineFetchStatus = TimelineFetchStatus.SKIPPED;
    let timelineFailure: string | null = null;
    let metrics: ReturnType<typeof calculateTimelineMetrics> = [];
    let buildEvents: ReturnType<typeof extractBuildRelevantTimelineEvents> | undefined;
    let timelineRaw: Parameters<typeof persistTimelineAndMetrics>[0]['rawPayload'] = null;
    let timelineSchemaVersion = '1';

    if (!deps.config.timelineFetchEnabled) {
      timelineStatus = TimelineFetchStatus.SKIPPED;
    } else {
      const timelineStarted = Date.now();
      logger.info('Timeline fetch start', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: truncatedMatchId,
        regionalRoute: payload.regionalRoute,
      });

      try {
        const rawTimeline = await withRiotWorkload('match', () =>
          deps.provider.getTimeline(payload.externalMatchId, payload.regionalRoute),
        );
        const timeline = normalizeTimeline({
          raw: rawTimeline,
          storeRawPayloads: deps.config.storeRawPayloads,
        });
        timelineRaw = timeline.rawPayload;
        timelineSchemaVersion = timeline.timelineSchemaVersion;
        timelineStatus = TimelineFetchStatus.FETCHED;
        buildEvents = extractBuildRelevantTimelineEvents(timeline.events);
        metrics = calculateTimelineMetrics({
          frames: timeline.frames,
          events: timeline.events,
          participants: normalized.participants.map((participant) => ({
            participantId: participant.participantId,
            teamId: participant.teamId,
            teamPosition: participant.teamPosition,
            kills: participant.kills,
            assists: participant.assists,
          })),
        });

        logger.info('Timeline fetch complete', {
          correlationId,
          jobId: safeJobId(job.id),
          matchId: truncatedMatchId,
          regionalRoute: payload.regionalRoute,
          durationMs: Date.now() - timelineStarted,
        });
      } catch (timelineError: unknown) {
        // Always publish shared cooldown on timeline 429, including soft-fail path.
        if (timelineError instanceof ProviderRateLimitedError) {
          await publishSharedCooldownFrom429({ deps, error: timelineError });
        }
        const classified = classifyIngestionError(timelineError);
        // Missing/failed timeline must not destroy match data.
        if (classified.kind === 'permanent' || classified.code === 'RESOURCE_NOT_FOUND') {
          timelineStatus = TimelineFetchStatus.FAILED;
          timelineFailure = classified.code;
          logger.warn('Timeline fetch complete', {
            correlationId,
            jobId: safeJobId(job.id),
            matchId: truncatedMatchId,
            regionalRoute: payload.regionalRoute,
            failed: true,
            code: classified.code,
          });
        } else if (deps.config.timelineRequiredForComplete) {
          throw timelineError;
        } else {
          timelineStatus = TimelineFetchStatus.FAILED;
          timelineFailure = classified.code;
          logger.warn('Timeline fetch complete', {
            correlationId,
            jobId: safeJobId(job.id),
            matchId: truncatedMatchId,
            regionalRoute: payload.regionalRoute,
            failed: true,
            code: classified.code,
            deferred: true,
          });
        }
      }
    }

    const markCompleted =
      !deps.config.timelineRequiredForComplete ||
      timelineStatus === TimelineFetchStatus.FETCHED ||
      timelineStatus === TimelineFetchStatus.SKIPPED;

    if (deps.config.timelineRequiredForComplete && !markCompleted) {
      await persistTimelineAndMetrics({
        prisma: deps.prisma,
        matchId: persisted.matchId,
        fetchStatus: timelineStatus,
        rawPayload: timelineRaw,
        timelineSchemaVersion,
        failureReason: timelineFailure,
        metrics,
        buildEvents,
        markMatchCompleted: false,
      });
      throw new ValidationFailureError('Timeline is required for match completion.', {
        timelineStatus,
      });
    }

    await persistTimelineAndMetrics({
      prisma: deps.prisma,
      matchId: persisted.matchId,
      fetchStatus: timelineStatus,
      rawPayload: timelineRaw,
      timelineSchemaVersion,
      failureReason: timelineFailure,
      metrics,
      buildEvents,
      markMatchCompleted: true,
    });

    if (metrics.length > 0) {
      logger.info('Metrics persisted', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: truncatedMatchId,
        metricCount: metrics.length,
      });
    }

    await markDurableJobStatus({
      prisma: deps.prisma,
      durableJobId,
      status: IngestionJobStatus.COMPLETED,
    });

    // AFTER COMPLETED commit only — durable previous keys + enqueue; never fail ingest.
    await enqueueAggregationSafe({
      deps,
      matchId: persisted.matchId,
      previousSnapshots: persisted.previousParticipantSnapshots,
      correlationId,
    });

    // Post-COMPLETED only; non-fatal. Never rolls back Match persistence.
    await expandMatchParticipantsSafe({
      prisma: deps.prisma,
      matchId: persisted.matchId,
      requestedByPlayerAccountId: payload.requestedByPlayerAccountId,
      sourceCollectorRunId: payload.sourceCollectorRunId,
      correlationId,
    });

    // Async co-participant rank enrichment — does not await Riot League-v4.
    await enqueueRankEnrichmentSafe({
      deps,
      matchId: persisted.matchId,
      correlationId,
    });

    const linkedAccountIds = [payload.requestedByPlayerAccountId, ...[...accountLinks.values()]];

    await invalidatePlayerProfileCaches({
      prisma: deps.prisma,
      redis: deps.redis,
      playerAccountIds: linkedAccountIds,
      correlationId,
      jobId: safeJobId(job.id),
    });

    logger.info('Completed', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      regionalRoute: payload.regionalRoute,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
    });

    return { status: 'completed' };
  } catch (error: unknown) {
    // Already classified / delayed by this processor — do not re-enter.
    if (error instanceof DelayedError || error instanceof UnrecoverableError) {
      throw error;
    }

    return handleClassifiedFailure({
      job,
      token,
      durableJobId,
      deps,
      error,
      correlationId,
      startedAt,
    });
  }
}
