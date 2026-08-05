import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from 'bullmq';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  resolveBullMqPrefix,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  processChampionAggregationJob,
  type ChampionAggregationJobResult,
  type ChampionAggregationProcessorDeps,
} from './champion-aggregation.processor.js';
import { enqueueChampionAggregationFollowUp } from './enqueue.js';

export type CreateChampionAggregationWorkerOptions = {
  connection: ConnectionOptions;
  deps: ChampionAggregationProcessorDeps;
  config: ChampionAggregationWorkerConfig;
  /** Queue used for follow-up enqueue after concurrent scope upsert (required in production). */
  aggregationQueue?: Queue<ChampionAggregationJobPayload>;
};

/**
 * BullMQ Worker for CHAMPION_AGGREGATION_QUEUE_NAME / RECALCULATE_CHAMPION_AGGREGATES only.
 * Does not process match-ingestion or the smoke default queue.
 *
 * On completed jobs with `scopeRemains`, best-effort re-enqueues so concurrent
 * previous keys are processed (fires after the job leaves LIVE).
 */
export function createChampionAggregationWorker(
  options: CreateChampionAggregationWorkerOptions,
): Worker<ChampionAggregationJobPayload, ChampionAggregationJobResult> {
  const { connection, deps, config } = options;
  const aggregationQueue = options.aggregationQueue ?? deps.aggregationQueue;
  const prefix = resolveBullMqPrefix();

  const worker = new Worker<ChampionAggregationJobPayload, ChampionAggregationJobResult>(
    config.queueName,
    async (job: Job<ChampionAggregationJobPayload>) => {
      if (job.name !== CHAMPION_AGGREGATION_JOB_NAME) {
        logger.warn('Rejecting unsupported champion-aggregation job name', {
          jobId: safeJobId(job.id),
          jobName: job.name,
          expectedJobName: CHAMPION_AGGREGATION_JOB_NAME,
        });
        throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
      }

      return processChampionAggregationJob(job, {
        ...deps,
        aggregationQueue,
      });
    },
    {
      connection,
      concurrency: config.concurrency,
      prefix,
    },
  );

  worker.on('ready', () => {
    logger.info('Worker started', {
      queue: config.queueName,
      supportedJob: CHAMPION_AGGREGATION_JOB_NAME,
      concurrency: config.concurrency,
      bullmqPrefix: prefix,
    });
  });

  worker.on('completed', (job, result) => {
    if (!result?.scopeRemains || !aggregationQueue) {
      return;
    }
    void enqueueChampionAggregationFollowUp({
      queue: aggregationQueue,
      config,
      matchId: result.matchId,
      correlationId: result.correlationId,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Champion-aggregation job failed', {
      jobId: safeJobId(job?.id),
      jobName: job?.name,
      code: error.name,
      error: error.message.slice(0, 240),
      attempt: job?.attemptsMade,
    });
  });

  return worker;
}
