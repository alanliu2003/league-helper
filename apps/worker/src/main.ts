import 'dotenv/config';
import { createHealthResponse } from '@league-helper/shared';
import { createDefaultQueue, createDefaultWorker, createRedisConnection } from './queues.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const connection = createRedisConnection();
  const queue = createDefaultQueue(connection);
  const worker = createDefaultWorker(connection);

  worker.on('ready', () => {
    logger.info('Worker ready', { health: createHealthResponse('worker').status });
  });

  worker.on('failed', (job, error) => {
    logger.error('Job failed', {
      jobId: job?.id ?? 'unknown',
      error: error.message,
    });
  });

  await queue.add(
    'startup-ping',
    { requestedAt: new Date().toISOString() },
    { removeOnComplete: 100, removeOnFail: 100 },
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutting down worker', { signal });
    await worker.close();
    await queue.close();
    await connection.quit();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown worker startup error';
  logger.error('Worker failed to start', { error: message });
  process.exit(1);
});
