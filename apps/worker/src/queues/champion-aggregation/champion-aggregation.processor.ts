import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  ChampionAggregationJobPayloadSchema,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  createChampionAggregationRepository,
  type ChampionAggregationRepository,
} from './champion-aggregation.repository.js';
import { recalculateForMatch } from './champion-aggregation.service.js';
import {
  recalculateMatchupsForMatch,
  type RecalculateMatchupsForMatchInput,
} from '../champion-matchup-aggregation/rebuild-core.js';

export type ChampionAggregationProcessorDeps = {
  prisma: PrismaClient;
  redis: Redis;
  config: ChampionAggregationWorkerConfig;
  repository?: ChampionAggregationRepository;
  /** Used for best-effort follow-up enqueue when scope remains after concurrent upsert. */
  aggregationQueue?: Queue<ChampionAggregationJobPayload>;
  /** Override for tests. Defaults to source-derived matchup recompute. */
  recalculateMatchups?: (input: RecalculateMatchupsForMatchInput) => Promise<{
    upserts: number;
    deletions: number;
  }>;
};

export type ChampionAggregationJobResult = {
  status: string;
  reason?: string;
  scopeRemains: boolean;
  matchId: string;
  correlationId?: string;
};

function truncateUuid(matchId: string): string {
  if (matchId.length <= 20) {
    return matchId;
  }
  return `${matchId.slice(0, 16)}…`;
}

/**
 * Orchestrate a single RECALCULATE_CHAMPION_AGGREGATES job.
 * Aggregation path uses PostgreSQL only — no provider fetches.
 */
export async function processChampionAggregationJob(
  job: Job<ChampionAggregationJobPayload>,
  deps: ChampionAggregationProcessorDeps,
): Promise<ChampionAggregationJobResult> {
  const startedAt = Date.now();

  if (job.name !== CHAMPION_AGGREGATION_JOB_NAME) {
    logger.error('champion_aggregation_job_failed', {
      jobId: safeJobId(job.id),
      code: 'UNSUPPORTED_JOB_NAME',
      jobName: job.name,
    });
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const parsed = ChampionAggregationJobPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error('champion_aggregation_job_failed', {
      jobId: safeJobId(job.id),
      code: 'VALIDATION_ERROR',
      reason: 'invalid_payload',
    });
    throw new UnrecoverableError('Champion aggregation payload failed validation.');
  }

  const payload = parsed.data;
  const matchIdLog = truncateUuid(payload.matchId);
  const repository =
    deps.repository ?? createChampionAggregationRepository(deps.prisma);

  logger.info('champion_aggregation_job_received', {
    jobId: safeJobId(job.id),
    matchId: matchIdLog,
    correlationId: payload.correlationId,
    sourceNormalizationVersion: payload.sourceNormalizationVersion,
    aggregationVersion: payload.aggregationVersion,
    attempt: job.attemptsMade + 1,
  });

  try {
    const result = await recalculateForMatch(
      payload.matchId,
      {
        sourceNormalizationVersion: payload.sourceNormalizationVersion,
        aggregationVersion: payload.aggregationVersion,
      },
      {
        repository,
        redis: deps.redis,
        config: deps.config,
      },
      { correlationId: payload.correlationId },
    );

    if (result.outcome === 'completed') {
      const recalculateMatchups = deps.recalculateMatchups ?? recalculateMatchupsForMatch;
      await recalculateMatchups({
        prisma: deps.prisma,
        redis: deps.redis,
        matchId: payload.matchId,
        sourceNormalizationVersion: payload.sourceNormalizationVersion,
        aggregationVersion: deps.config.matchupAggregationVersion,
      });
    }

    logger.info('champion_aggregation_job_finished', {
      jobId: safeJobId(job.id),
      matchId: matchIdLog,
      correlationId: payload.correlationId,
      outcome: result.outcome,
      scopeRemains: result.scopeRemains,
      durationMs: Date.now() - startedAt,
      ...(result.outcome === 'completed'
        ? {
            keysRecalculated: result.keysRecalculated,
            rowsUpserted: result.rowsUpserted,
            rowsDeleted: result.rowsDeleted,
          }
        : { reason: result.reason }),
    });

    return {
      status: result.outcome,
      scopeRemains: result.scopeRemains,
      matchId: payload.matchId,
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
      ...(result.outcome !== 'completed' ? { reason: result.reason } : {}),
    };
  } catch (error: unknown) {
    const code = error instanceof Error ? error.name : 'UNKNOWN';
    const message = error instanceof Error ? error.message : 'unknown';
    const attemptsMade = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? deps.config.jobAttempts;
    const exhausted = attemptsMade >= maxAttempts;
    const unrecoverable =
      error instanceof UnrecoverableError ||
      code === 'VALIDATION_ERROR' ||
      message.includes('invalid');

    if (exhausted || unrecoverable) {
      try {
        await repository.markProcessingFailed({
          matchId: payload.matchId,
          sourceNormalizationVersion: payload.sourceNormalizationVersion,
          aggregationVersion: payload.aggregationVersion,
          lastErrorCode: code.slice(0, 64),
        });
      } catch (markerError: unknown) {
        logger.warn('champion_aggregation_failed_marker_write_failed', {
          jobId: safeJobId(job.id),
          matchId: matchIdLog,
          correlationId: payload.correlationId,
          error:
            markerError instanceof Error ? markerError.message.slice(0, 200) : 'unknown',
        });
      }
    }

    logger.error('champion_aggregation_job_failed', {
      jobId: safeJobId(job.id),
      matchId: matchIdLog,
      correlationId: payload.correlationId,
      code,
      attempt: attemptsMade,
      exhausted,
      durationMs: Date.now() - startedAt,
      error: message.slice(0, 240),
    });

    if (unrecoverable && !(error instanceof UnrecoverableError)) {
      throw new UnrecoverableError(message);
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
