import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  MATCH_TIMELINE_JOB_NAME,
  resolveBullMqPrefix,
  type MatchTimelineJobPayload,
} from '@league-helper/shared';
import type { MatchTimelineWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  processMatchTimelineJob,
  type MatchTimelineJobResult,
  type MatchTimelineProcessorDeps,
} from './match-timeline.processor.js';

export type CreateMatchTimelineWorkerOptions = {
  connection: ConnectionOptions;
  deps: MatchTimelineProcessorDeps;
  config: MatchTimelineWorkerConfig;
};

/**
 * BullMQ Worker for MATCH_TIMELINE_QUEUE_NAME / ENRICH_MATCH_TIMELINE only.
 * Default concurrency is 1 (stricter than match-ingestion).
 */
export function createMatchTimelineWorker(
  options: CreateMatchTimelineWorkerOptions,
): Worker<MatchTimelineJobPayload, MatchTimelineJobResult> {
  const { connection, deps, config } = options;
  const prefix = resolveBullMqPrefix();

  const worker = new Worker<MatchTimelineJobPayload, MatchTimelineJobResult>(
    config.queueName,
    async (job: Job<MatchTimelineJobPayload>, token?: string) => {
      if (job.name !== MATCH_TIMELINE_JOB_NAME) {
        logger.warn('Rejecting unsupported match-timeline job name', {
          jobId: safeJobId(job.id),
          jobName: job.name,
          expectedJobName: MATCH_TIMELINE_JOB_NAME,
        });
        throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
      }

      logger.info('Job received', {
        jobId: safeJobId(job.id),
        jobName: job.name,
        attempt: job.attemptsMade + 1,
        matchId: job.data?.matchId,
        stage: 'received',
      });

      return processMatchTimelineJob(job, token, deps);
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
      supportedJob: MATCH_TIMELINE_JOB_NAME,
      concurrency: config.concurrency,
      bullmqPrefix: prefix,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Match-timeline job failed', {
      jobId: safeJobId(job?.id),
      jobName: job?.name,
      code: error.name,
      error: error.message.slice(0, 240),
      attempt: job?.attemptsMade,
    });
  });

  return worker;
}
