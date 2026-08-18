import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import {
  TimelineFetchStatus,
  TimelineProductCoverage,
  type PrismaClient,
} from '@prisma/client';
import { withRiotWorkload, type RiotSharedCooldownStore } from '@league-helper/server-riot';
import {
  MATCH_TIMELINE_JOB_NAME,
  MatchTimelineJobPayloadSchema,
  ProviderRateLimitedError,
  RegionalRouteSchema,
  TeamPositionSchema,
  type GameDataProvider,
  type MatchTimelineJobPayload,
  type RegionalRoute,
  type TeamPosition,
} from '@league-helper/shared';
import type { MatchTimelineWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { classifyIngestionError } from '../match-ingestion/ingestion-error-classifier.js';
import { safeJobId, truncateMatchId } from '../match-ingestion/log-safe.js';
import {
  isProductTimelineEligible,
  persistTimelineAndMetrics,
} from '../match-ingestion/match-persistence.js';
import { BUILD_RELEVANT_TIMELINE_EVENT_TYPES } from '../match-ingestion/timeline-build-events.js';
import { extractTimelineFrames } from '../match-ingestion/timeline-frames.js';
import { calculateTimelineMetrics } from '../match-ingestion/timeline-metrics.service.js';
import { normalizeTimeline } from '../match-ingestion/timeline-normalizer.js';
import { extractPersistedTimelineEvents } from '../match-ingestion/timeline-product-events.js';

const MATCH_TIMELINE_SELECT = {
  id: true,
  externalMatchId: true,
  regionalRoute: true,
  ingestionStatus: true,
  timeline: { select: { productCoverage: true, fetchStatus: true } },
  participants: {
    select: {
      participantId: true,
      teamId: true,
      teamPosition: true,
      kills: true,
      assists: true,
      playerAccountId: true,
    },
  },
} as const;

export type MatchTimelineProcessorDeps = {
  prisma: PrismaClient;
  provider: Pick<GameDataProvider, 'getTimeline'>;
  config: MatchTimelineWorkerConfig;
  sharedCooldown?: RiotSharedCooldownStore | null;
};

export type MatchTimelineJobResult = {
  status: 'completed' | 'skipped';
};

function boundDelayMs(retryAfterSeconds: number, config: MatchTimelineWorkerConfig): number {
  const requested = Math.max(0, retryAfterSeconds) * 1000;
  return Math.min(Math.max(requested, config.backoffBaseMs), config.backoffMaxMs);
}

function retryAfterMsFromRateLimited(error: ProviderRateLimitedError): number | null {
  const details = error.details;
  if (details === null || typeof details !== 'object' || !('retryAfterSeconds' in details)) {
    return null;
  }
  const seconds = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return Math.round(seconds * 1_000);
}

async function publishSharedCooldownFrom429(input: {
  deps: MatchTimelineProcessorDeps;
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
  job: Job<MatchTimelineJobPayload>;
  token: string | undefined;
  deps: MatchTimelineProcessorDeps;
  correlationId?: string;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}): Promise<never> {
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

function toTeamPosition(raw: string): TeamPosition {
  const parsed = TeamPositionSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'INVALID';
}

function toRegionalRoute(raw: string): RegionalRoute | null {
  const parsed = RegionalRouteSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Enrich a stored match with product timeline events/frames.
 * Does not call getMatch or rewrite Match.ingestionStatus / participant identity.
 */
export async function processMatchTimelineJob(
  job: Job<MatchTimelineJobPayload>,
  token: string | undefined,
  deps: MatchTimelineProcessorDeps,
): Promise<MatchTimelineJobResult> {
  const startedAt = Date.now();

  if (job.name !== MATCH_TIMELINE_JOB_NAME) {
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const parsed = MatchTimelineJobPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error('Permanent fail', {
      jobId: safeJobId(job.id),
      code: 'VALIDATION_ERROR',
      attempt: job.attemptsMade + 1,
      reason: 'invalid_payload',
    });
    throw new UnrecoverableError('Match timeline payload failed validation.');
  }

  const payload = parsed.data;
  const correlationId = payload.correlationId;
  const includeIneligible = payload.includeIneligible === true;

  try {
    const match = await deps.prisma.match.findUnique({
      where: { id: payload.matchId },
      select: MATCH_TIMELINE_SELECT,
    });

    if (!match) {
      logger.error('Permanent fail', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: payload.matchId,
        code: 'RESOURCE_NOT_FOUND',
        reason: 'unknown_match',
      });
      throw new UnrecoverableError('Match not found for timeline enrichment.');
    }

    const truncatedMatchId = truncateMatchId(match.externalMatchId);

    if (match.timeline?.productCoverage === TimelineProductCoverage.STORED) {
      logger.info('Match timeline already stored', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: payload.matchId,
      });
      return { status: 'skipped' };
    }

    const eligible = isProductTimelineEligible(match.participants);
    if (!eligible && !includeIneligible) {
      logger.info('Match timeline skipped ineligible', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: payload.matchId,
      });
      return { status: 'skipped' };
    }

    const regionalRoute = toRegionalRoute(match.regionalRoute);
    if (!regionalRoute) {
      throw new UnrecoverableError('Match regional route is invalid for timeline enrichment.');
    }

    if (deps.sharedCooldown) {
      const now = Date.now();
      const remainingMs = await deps.sharedCooldown.remainingMs(now);
      if (remainingMs > 0) {
        await delayJobForSharedCooldown({
          job,
          token,
          deps,
          correlationId,
          code: 'PROVIDER_RATE_LIMITED',
          message: 'Shared Riot 429 cooldown active; delaying timeline fetch.',
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        });
      }
    }

    logger.info('Timeline fetch start', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      regionalRoute,
    });

    let rawTimeline: unknown;
    try {
      rawTimeline = await withRiotWorkload('match', () =>
        deps.provider.getTimeline(match.externalMatchId, regionalRoute),
      );
    } catch (timelineError: unknown) {
      if (timelineError instanceof DelayedError || timelineError instanceof UnrecoverableError) {
        throw timelineError;
      }

      if (timelineError instanceof ProviderRateLimitedError) {
        await publishSharedCooldownFrom429({ deps, error: timelineError });
      }

      const classified = classifyIngestionError(timelineError);
      if (classified.kind === 'delayed') {
        await delayJobForSharedCooldown({
          job,
          token,
          deps,
          correlationId,
          code: classified.code,
          message: classified.message,
          retryAfterSeconds: classified.retryAfterSeconds,
        });
      }

      if (classified.kind === 'permanent' || classified.code === 'RESOURCE_NOT_FOUND') {
        await persistTimelineAndMetrics({
          prisma: deps.prisma,
          matchId: match.id,
          fetchStatus: TimelineFetchStatus.FAILED,
          rawPayload: null,
          timelineSchemaVersion: '1',
          failureReason: classified.code,
          metrics: [],
          productCoverage: TimelineProductCoverage.NONE,
          markMatchCompleted: false,
        });
        logger.warn('Timeline fetch complete', {
          correlationId,
          jobId: safeJobId(job.id),
          matchId: truncatedMatchId,
          regionalRoute,
          failed: true,
          code: classified.code,
        });
        throw new UnrecoverableError(classified.message);
      }

      logger.warn('Timeline fetch complete', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: truncatedMatchId,
        regionalRoute,
        failed: true,
        code: classified.code,
        deferred: true,
      });
      throw timelineError instanceof Error ? timelineError : new Error(classified.message);
    }

    const timeline = normalizeTimeline({
      raw: rawTimeline,
      storeRawPayloads: deps.config.storeRawPayloads,
    });
    const persistProduct = eligible || includeIneligible;
    const persistedEvents = extractPersistedTimelineEvents(timeline.events);
    const buildEvents = persistProduct
      ? persistedEvents
      : persistedEvents.filter((event) =>
          (BUILD_RELEVANT_TIMELINE_EVENT_TYPES as readonly string[]).includes(event.type),
        );
    const framesToStore = persistProduct ? extractTimelineFrames(timeline.frames) : [];
    const productCoverage = persistProduct
      ? TimelineProductCoverage.STORED
      : TimelineProductCoverage.INELIGIBLE;

    let metrics: ReturnType<typeof calculateTimelineMetrics> = [];
    try {
      metrics = calculateTimelineMetrics({
        frames: timeline.frames,
        events: timeline.events,
        participants: match.participants.map((participant) => ({
          participantId: participant.participantId,
          teamId: participant.teamId,
          teamPosition: toTeamPosition(participant.teamPosition),
          kills: participant.kills,
          assists: participant.assists,
        })),
      });
    } catch (metricsError: unknown) {
      logger.warn('Timeline metrics calculation skipped', {
        correlationId,
        jobId: safeJobId(job.id),
        matchId: payload.matchId,
        error: metricsError instanceof Error ? metricsError.message.slice(0, 200) : 'unknown',
      });
    }

    await persistTimelineAndMetrics({
      prisma: deps.prisma,
      matchId: match.id,
      fetchStatus: TimelineFetchStatus.FETCHED,
      rawPayload: timeline.rawPayload,
      timelineSchemaVersion: timeline.timelineSchemaVersion,
      failureReason: null,
      metrics,
      buildEvents,
      frames: framesToStore,
      productCoverage,
      frameIntervalMs: timeline.frameIntervalMs,
      markMatchCompleted: false,
    });

    logger.info('Completed', {
      correlationId,
      jobId: safeJobId(job.id),
      matchId: truncatedMatchId,
      regionalRoute,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
      productCoverage,
    });

    return { status: 'completed' };
  } catch (error: unknown) {
    if (error instanceof DelayedError || error instanceof UnrecoverableError) {
      throw error;
    }

    const classified = classifyIngestionError(error);
    if (classified.kind === 'delayed') {
      if (error instanceof ProviderRateLimitedError) {
        await publishSharedCooldownFrom429({ deps, error });
      }
      await delayJobForSharedCooldown({
        job,
        token,
        deps,
        correlationId,
        code: classified.code,
        message: classified.message,
        retryAfterSeconds: classified.retryAfterSeconds,
      });
    }

    if (classified.kind === 'permanent') {
      logger.error('Permanent fail', {
        correlationId,
        jobId: safeJobId(job.id),
        code: classified.code,
        attempt: job.attemptsMade + 1,
        durationMs: Date.now() - startedAt,
      });
      throw new UnrecoverableError(classified.message);
    }

    logger.warn('Retry scheduled', {
      correlationId,
      jobId: safeJobId(job.id),
      code: classified.code,
      kind: classified.kind,
      attempt: job.attemptsMade + 1,
      durationMs: Date.now() - startedAt,
    });
    throw error instanceof Error ? error : new Error(classified.message);
  }
}
