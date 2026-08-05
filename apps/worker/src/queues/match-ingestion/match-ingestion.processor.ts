import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import {
  IngestionJobStatus,
  MatchIngestionStatus,
  TimelineFetchStatus,
  type PrismaClient,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import type { GameDataProvider } from '@league-helper/shared';
import {
  MATCH_INGESTION_JOB_NAME,
  MatchIngestionJobPayloadSchema,
  buildMatchIngestionIdempotencyKey,
  type MatchIngestionJobPayload,
  ValidationFailureError,
} from '@league-helper/shared';
import type { MatchIngestionWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
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
import { calculateTimelineMetrics } from './timeline-metrics.service.js';
import { normalizeTimeline } from './timeline-normalizer.js';

export type MatchIngestionProcessorDeps = {
  prisma: PrismaClient;
  provider: GameDataProvider;
  redis: Redis;
  config: MatchIngestionWorkerConfig;
};

function boundDelayMs(retryAfterSeconds: number, config: MatchIngestionWorkerConfig): number {
  const requested = Math.max(0, retryAfterSeconds) * 1000;
  return Math.min(Math.max(requested, config.backoffBaseMs), config.backoffMaxMs);
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
    if (input.durableJobId) {
      await markDurableJobStatus({
        prisma: input.deps.prisma,
        durableJobId: input.durableJobId,
        status: IngestionJobStatus.FAILED,
        lastErrorCode: classified.code,
        lastErrorMessage: classified.message,
      });
    }
    const delayMs = boundDelayMs(classified.retryAfterSeconds ?? 2, input.deps.config);
    logger.warn('Delayed rate limit', {
      correlationId: input.correlationId,
      jobId: safeJobId(input.job.id),
      code: classified.code,
      delayMs,
      attempt: attemptsMade,
    });
    if (input.token) {
      await input.job.moveToDelayed(Date.now() + delayMs, input.token);
    }
    throw new DelayedError();
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

    const existingVersion = existing ? Number(existing.normalizationVersion) : -1;
    if (
      existing &&
      existing.ingestionStatus === MatchIngestionStatus.COMPLETED &&
      Number.isFinite(existingVersion) &&
      existingVersion >= payload.normalizationVersion
    ) {
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

    logger.info('Match fetch start', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      regionalRoute: payload.regionalRoute,
    });

    const rawMatch = await deps.provider.getMatch(payload.externalMatchId, payload.regionalRoute);

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

    const persisted = await persistNormalizedMatch(deps.prisma, normalized, accountLinks);

    logger.info('Persistence committed', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      created: persisted.created,
      participantCount: normalized.participants.length,
      teamCount: normalized.teams.length,
    });

    let timelineStatus: TimelineFetchStatus = TimelineFetchStatus.SKIPPED;
    let timelineFailure: string | null = null;
    let metrics: ReturnType<typeof calculateTimelineMetrics> = [];
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
        const rawTimeline = await deps.provider.getTimeline(
          payload.externalMatchId,
          payload.regionalRoute,
        );
        const timeline = normalizeTimeline({
          raw: rawTimeline,
          storeRawPayloads: deps.config.storeRawPayloads,
        });
        timelineRaw = timeline.rawPayload;
        timelineSchemaVersion = timeline.timelineSchemaVersion;
        timelineStatus = TimelineFetchStatus.FETCHED;
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
