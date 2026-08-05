import 'dotenv/config';
import {
  MATCH_INGESTION_JOB_NAME,
  createHealthResponse,
  parseBullMqRedisConnectionInfo,
  resolveBullMqPrefix,
} from '@league-helper/shared';
import { loadMatchIngestionWorkerConfig, getRedisUrl } from './config.js';
import { logger } from './logger.js';
import { disconnectPrisma, getPrismaClient } from './prisma.js';
import { createGameDataProvider } from './provider.js';
import { createRedisConnection } from './queues.js';
import { createMatchIngestionWorker } from './queues/match-ingestion/match-ingestion.worker.js';

async function main(): Promise<void> {
  const redisUrl = getRedisUrl();
  const connectionInfo = parseBullMqRedisConnectionInfo(redisUrl, resolveBullMqPrefix());
  const matchIngestionConfig = loadMatchIngestionWorkerConfig();
  const connection = createRedisConnection();
  const prisma = getPrismaClient();
  await prisma.$connect();
  const providerHandle = createGameDataProvider();
  const riotConfig = providerHandle.config;

  logger.info('Match-ingestion worker starting', {
    queue: matchIngestionConfig.queueName,
    supportedJob: MATCH_INGESTION_JOB_NAME,
    concurrency: matchIngestionConfig.concurrency,
    providerMode: riotConfig.providerMode,
    providerConfigured: riotConfig.providerMode === 'mock' || Boolean(riotConfig.apiKey),
    redisDatabase: connectionInfo.database,
    bullmqPrefix: connectionInfo.prefix,
    redisConnectionReady: connection.status === 'ready' || connection.status === 'connecting',
    prismaConnectionReady: true,
    health: createHealthResponse('worker').status,
  });

  const matchIngestionWorker = createMatchIngestionWorker({
    connection,
    config: matchIngestionConfig,
    deps: {
      prisma,
      provider: providerHandle.provider,
      redis: connection,
      config: matchIngestionConfig,
    },
  });

  // Confirm paused state after worker registers.
  try {
    const { Queue } = await import('bullmq');
    const probe = new Queue(matchIngestionConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const paused = await probe.isPaused();
    logger.info('Match-ingestion queue probe', {
      queue: matchIngestionConfig.queueName,
      paused,
      supportedJob: MATCH_INGESTION_JOB_NAME,
    });
    await probe.close();
  } catch (error: unknown) {
    logger.warn('Match-ingestion queue probe failed', {
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('Shutting down worker', { signal });
    await Promise.allSettled([matchIngestionWorker.close()]);
    await Promise.allSettled([providerHandle.close(), disconnectPrisma(), connection.quit()]);
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

// Gate processing on main() — importing this module in tests must not start workers.
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown worker startup error';
  logger.error('Worker failed to start', { error: message });
  process.exit(1);
});
