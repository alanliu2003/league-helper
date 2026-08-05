import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  MATCH_INGESTION_JOB_NAME,
  resolveBullMqPrefix,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import type { MatchIngestionWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from './log-safe.js';
import {
  processMatchIngestionJob,
  type MatchIngestionProcessorDeps,
} from './match-ingestion.processor.js';

export type CreateMatchIngestionWorkerOptions = {
  connection: ConnectionOptions;
  deps: MatchIngestionProcessorDeps;
  config: MatchIngestionWorkerConfig;
};

/**
 * BullMQ Worker for MATCH_INGESTION_QUEUE_NAME / INGEST_MATCH only.
 * Does not process the default smoke queue.
 */
export function createMatchIngestionWorker(
  options: CreateMatchIngestionWorkerOptions,
): Worker<MatchIngestionJobPayload> {
  const { connection, deps, config } = options;
  const prefix = resolveBullMqPrefix();

  const worker = new Worker<MatchIngestionJobPayload>(
    config.queueName,
    async (job: Job<MatchIngestionJobPayload>, token?: string) => {
      if (job.name !== MATCH_INGESTION_JOB_NAME) {
        logger.warn('Rejecting unsupported match-ingestion job name', {
          jobId: safeJobId(job.id),
          jobName: job.name,
          expectedJobName: MATCH_INGESTION_JOB_NAME,
        });
        throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
      }

      logger.info('Job received', {
        jobId: safeJobId(job.id),
        jobName: job.name,
        attempt: job.attemptsMade + 1,
        regionalRoute: job.data?.regionalRoute,
        stage: 'received',
      });

      return processMatchIngestionJob(job, token, deps);
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
      supportedJob: MATCH_INGESTION_JOB_NAME,
      concurrency: config.concurrency,
      bullmqPrefix: prefix,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Match-ingestion job failed', {
      jobId: safeJobId(job?.id),
      jobName: job?.name,
      code: error.name,
      error: error.message.slice(0, 240),
      attempt: job?.attemptsMade,
    });
  });

  return worker;
}
