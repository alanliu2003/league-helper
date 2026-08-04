import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
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
  return new Queue<PingJobData>(QUEUE_NAME, { connection });
}

export function createDefaultWorker(connection: ConnectionOptions): Worker<PingJobData> {
  return new Worker<PingJobData>(
    QUEUE_NAME,
    async (job: Job<PingJobData>) => {
      logger.info('Processed job', {
        jobId: job.id ?? 'unknown',
        requestedAt: job.data.requestedAt,
      });
      return { processedAt: new Date().toISOString() };
    },
    { connection },
  );
}
