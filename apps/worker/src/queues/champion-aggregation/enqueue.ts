import { Queue, type JobsOptions } from 'bullmq';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  ChampionAggregationJobPayloadSchema,
  buildChampionAggregationBullMqJobId,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import type { ChampionAggregationRepository } from './champion-aggregation.repository.js';
import {
  expandPreviousDimensionKeys,
  type PreviousParticipantDimensionSnapshot,
} from './previous-keys.js';

export const CHAMPION_AGGREGATION_REMOVE_ON_COMPLETE = { age: 3600, count: 1000 } as const;
export const CHAMPION_AGGREGATION_REMOVE_ON_FAIL = { age: 86400, count: 5000 } as const;

const LIVE_STATES = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

export type EnqueueChampionAggregationInput = {
  queue: Queue<ChampionAggregationJobPayload>;
  repository: ChampionAggregationRepository;
  config: ChampionAggregationWorkerConfig;
  matchId: string;
  /** Structured snapshots captured before overwrite; expanded with configured versions. */
  previousSnapshots: PreviousParticipantDimensionSnapshot[];
  correlationId?: string;
};

export type EnqueueChampionAggregationResult = {
  published: boolean;
  jobId: string;
  previousKeyCount: number;
};

export function buildChampionAggregationJobOptions(
  jobId: string,
  attempts: number,
): JobsOptions {
  return {
    jobId,
    attempts,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: { ...CHAMPION_AGGREGATION_REMOVE_ON_COMPLETE },
    removeOnFail: { ...CHAMPION_AGGREGATION_REMOVE_ON_FAIL },
  };
}

/**
 * Durably store previous materialized keys, then enqueue RECALCULATE_CHAMPION_AGGREGATES.
 * Must be called only AFTER match COMPLETED commit.
 * Redis/enqueue failures are caught by the caller — this throws so callers can warn.
 */
export async function storeScopeAndEnqueueChampionAggregation(
  input: EnqueueChampionAggregationInput,
): Promise<EnqueueChampionAggregationResult> {
  const versions = {
    sourceNormalizationVersion: input.config.sourceNormalizationVersion,
    aggregationVersion: input.config.aggregationVersion,
  };
  const previousDimensionKeys = expandPreviousDimensionKeys(input.previousSnapshots, versions);

  await input.repository.upsertRecalcScope({
    matchId: input.matchId,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
    previousDimensionKeys,
  });

  const payload = ChampionAggregationJobPayloadSchema.parse({
    matchId: input.matchId,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  });

  const jobId = buildChampionAggregationBullMqJobId({
    matchId: payload.matchId,
    sourceNormalizationVersion: payload.sourceNormalizationVersion,
    aggregationVersion: payload.aggregationVersion,
  });

  const existing = await input.queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (LIVE_STATES.has(state)) {
      return {
        published: true,
        jobId,
        previousKeyCount: previousDimensionKeys.length,
      };
    }
    // completed / failed retained — remove so retention re-enqueue works
    await existing.remove();
  }

  await input.queue.add(
    CHAMPION_AGGREGATION_JOB_NAME,
    payload,
    buildChampionAggregationJobOptions(jobId, input.config.jobAttempts),
  );

  return {
    published: true,
    jobId,
    previousKeyCount: previousDimensionKeys.length,
  };
}

/**
 * Best-effort post-commit enqueue. Never throws to the ingestion caller.
 */
export async function enqueueChampionAggregationAfterCommit(
  input: EnqueueChampionAggregationInput,
): Promise<EnqueueChampionAggregationResult | null> {
  try {
    const result = await storeScopeAndEnqueueChampionAggregation(input);
    logger.info('champion_aggregation_enqueued', {
      matchId: input.matchId,
      correlationId: input.correlationId,
      jobId: result.jobId,
      previousKeyCount: result.previousKeyCount,
      sourceNormalizationVersion: input.config.sourceNormalizationVersion,
      aggregationVersion: input.config.aggregationVersion,
    });
    return result;
  } catch (error: unknown) {
    logger.warn('champion_aggregation_enqueue_failed', {
      matchId: input.matchId,
      correlationId: input.correlationId,
      code: 'CHAMPION_AGGREGATION_ENQUEUE_FAILED',
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return null;
  }
}

export type EnqueueChampionAggregationFollowUpInput = {
  queue: Queue<ChampionAggregationJobPayload>;
  config: ChampionAggregationWorkerConfig;
  matchId: string;
  correlationId?: string;
};

/**
 * Best-effort re-enqueue when a concurrent scope upsert left pending previous keys.
 * Does not modify scope (keys already durable). Safe after the prior job leaves LIVE.
 */
export async function enqueueChampionAggregationFollowUp(
  input: EnqueueChampionAggregationFollowUpInput,
): Promise<EnqueueChampionAggregationResult | null> {
  try {
    const payload = ChampionAggregationJobPayloadSchema.parse({
      matchId: input.matchId,
      sourceNormalizationVersion: input.config.sourceNormalizationVersion,
      aggregationVersion: input.config.aggregationVersion,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    });
    const jobId = buildChampionAggregationBullMqJobId({
      matchId: payload.matchId,
      sourceNormalizationVersion: payload.sourceNormalizationVersion,
      aggregationVersion: payload.aggregationVersion,
    });

    const existing = await input.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (LIVE_STATES.has(state)) {
        logger.info('champion_aggregation_follow_up_deferred', {
          matchId: input.matchId,
          correlationId: input.correlationId,
          jobId,
          state,
          code: 'FOLLOW_UP_JOB_ALREADY_LIVE',
        });
        return { published: true, jobId, previousKeyCount: 0 };
      }
      await existing.remove();
    }

    await input.queue.add(
      CHAMPION_AGGREGATION_JOB_NAME,
      payload,
      buildChampionAggregationJobOptions(jobId, input.config.jobAttempts),
    );

    logger.info('champion_aggregation_follow_up_enqueued', {
      matchId: input.matchId,
      correlationId: input.correlationId,
      jobId,
      sourceNormalizationVersion: input.config.sourceNormalizationVersion,
      aggregationVersion: input.config.aggregationVersion,
      code: 'SCOPE_REMAINS_REENQUEUE',
    });

    return { published: true, jobId, previousKeyCount: 0 };
  } catch (error: unknown) {
    logger.warn('champion_aggregation_enqueue_failed', {
      matchId: input.matchId,
      correlationId: input.correlationId,
      code: 'CHAMPION_AGGREGATION_FOLLOW_UP_ENQUEUE_FAILED',
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return null;
  }
}
