import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createBullMqConnectionOptions, resolveBullMqPrefix } from '@league-helper/shared';
import { QUEUE_NAME, getRedisUrl } from './config.js';
import { logger } from './logger.js';

export type PingJobData = {
  requestedAt: string;
};

export function createRedisConnection(): Redis {
  return new Redis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });
}

export function createDefaultQueue(connection: ConnectionOptions): Queue<PingJobData> {
  return new Queue<PingJobData>(QUEUE_NAME, {
    connection,
    prefix: resolveBullMqPrefix(),
  });
}

/**
 * Processes only the default smoke-test queue (`league-helper-default`).
 * Used exclusively by `pnpm worker:smoke`, never by `pnpm dev:worker`.
 */
export function createDefaultWorker(connection: ConnectionOptions): Worker<PingJobData> {
  return new Worker<PingJobData>(
    QUEUE_NAME,
    async (job: Job<PingJobData>) => {
      logger.info('Processed smoke job', {
        jobId: job.id ?? 'unknown',
        requestedAt: job.data.requestedAt,
      });
      return { processedAt: new Date().toISOString() };
    },
    {
      connection,
      prefix: resolveBullMqPrefix(),
    },
  );
}

export function getSharedBullMqConnectionOptions(): ReturnType<
  typeof createBullMqConnectionOptions
> {
  return createBullMqConnectionOptions(getRedisUrl());
}
