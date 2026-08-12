import { DelayedError, UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { RiotSharedCooldownStore } from '@league-helper/server-riot';
import {
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  ParticipantRankEnrichmentJobPayloadSchema,
  type ChampionAggregationJobPayload,
  type GameDataProvider,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import type {
  ChampionAggregationWorkerConfig,
  ParticipantRankEnrichmentWorkerConfig,
} from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  enrichParticipantRank,
  type ParticipantRankEnrichmentResult,
} from './participant-rank-enrichment.service.js';

export type ParticipantRankEnrichmentProcessorDeps = {
  prisma: PrismaClient;
  provider: Pick<GameDataProvider, 'getRankedEntries'>;
  redis: Redis;
  config: ParticipantRankEnrichmentWorkerConfig;
  championAggregationQueue: Queue<ChampionAggregationJobPayload>;
  championAggregationConfig: ChampionAggregationWorkerConfig;
  sharedCooldown?: RiotSharedCooldownStore | null;
};

export type ParticipantRankEnrichmentJobResult = ParticipantRankEnrichmentResult & {
  correlationId?: string;
};

/**
 * Process a single ENRICH_PARTICIPANT_RANK job.
 */
export async function processParticipantRankEnrichmentJob(
  job: Job<ParticipantRankEnrichmentJobPayload>,
  token: string | undefined,
  deps: ParticipantRankEnrichmentProcessorDeps,
): Promise<ParticipantRankEnrichmentJobResult> {
  if (job.name !== PARTICIPANT_RANK_ENRICHMENT_JOB_NAME) {
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const parsed = ParticipantRankEnrichmentJobPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    throw new UnrecoverableError('Participant rank enrichment payload failed validation.');
  }
  const payload = parsed.data;
  const correlationId = payload.correlationId;
  const startedAt = Date.now();

  const result = await enrichParticipantRank(
    {
      prisma: deps.prisma,
      provider: deps.provider,
      sharedCooldown: deps.sharedCooldown ?? null,
      config: deps.config,
      championAggregationQueue: deps.championAggregationQueue,
      championAggregationConfig: deps.championAggregationConfig,
    },
    payload,
  );

  if (result.failClosed) {
    logger.error('participant_rank_enrichment_fail_closed', {
      jobId: safeJobId(job.id),
      correlationId,
      providerResultCode: result.providerResultCode ?? undefined,
      platformRoute: payload.platformRoute,
      queueType: payload.queueType,
      durationMs: Date.now() - startedAt,
    });
    throw new UnrecoverableError(
      `Participant rank enrichment fail-closed: ${result.providerResultCode ?? 'AUTH'}`,
    );
  }

  if (result.status === 'retryable') {
    const delayMs = result.delayMs ?? deps.config.backoffBaseMs;
    logger.warn('participant_rank_enrichment_deferred', {
      jobId: safeJobId(job.id),
      correlationId,
      providerResultCode: result.providerResultCode ?? undefined,
      delayMs,
      riotCalled: result.riotCalled,
      platformRoute: payload.platformRoute,
      queueType: payload.queueType,
    });
    await job.moveToDelayed(Date.now() + delayMs, token);
    throw new DelayedError();
  }

  if (result.status === 'permanent') {
    // Permanent outcomes are durable on the participant; do not retry the job.
    logger.warn('participant_rank_enrichment_permanent', {
      jobId: safeJobId(job.id),
      correlationId,
      providerResultCode: result.providerResultCode ?? undefined,
      updatedParticipantCount: result.updatedParticipantCount,
    });
    return { ...result, correlationId };
  }

  logger.info('participant_rank_enrichment_completed', {
    jobId: safeJobId(job.id),
    correlationId,
    status: result.status,
    resolutionStatus: result.resolutionStatus,
    riotCalled: result.riotCalled,
    cacheHit: result.cacheHit,
    updatedParticipantCount: result.updatedParticipantCount,
    affectedMatchCount: result.affectedMatchIds.length,
    providerResultCode: result.providerResultCode ?? undefined,
    durationMs: Date.now() - startedAt,
  });

  return { ...result, correlationId };
}
