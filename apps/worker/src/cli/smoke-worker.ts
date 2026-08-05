import 'dotenv/config';
import { createHealthResponse } from '@league-helper/shared';
import { logger } from '../logger.js';
import { createDefaultQueue, createDefaultWorker, createRedisConnection } from '../queues.js';

/**
 * Optional legacy smoke-test for queue `league-helper-default`.
 * Not started by `pnpm dev:worker`.
 */
async function main(): Promise<void> {
  const connection = createRedisConnection();
  const queue = createDefaultQueue(connection);
  const worker = createDefaultWorker(connection);

  worker.on('ready', () => {
    logger.info('Smoke worker ready', {
      queue: 'league-helper-default',
      health: createHealthResponse('worker').status,
    });
  });

  await queue.add(
    'startup-ping',
    { requestedAt: new Date().toISOString() },
    { removeOnComplete: 100, removeOnFail: 100 },
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Shutting down smoke worker', { signal });
    await Promise.allSettled([worker.close(), queue.close(), connection.quit()]);
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
  const message = error instanceof Error ? error.message : 'Unknown smoke worker error';
  logger.error('Smoke worker failed to start', { error: message });
  process.exit(1);
});
