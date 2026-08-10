import 'dotenv/config';
import { Queue } from 'bullmq';
import { RiotSharedCooldownStore } from '@league-helper/server-riot';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  MATCH_INGESTION_JOB_NAME,
  createHealthResponse,
  parseBullMqRedisConnectionInfo,
  resolveBullMqPrefix,
  type ChampionAggregationJobPayload,
} from '@league-helper/shared';
import {
  loadChampionAggregationWorkerConfig,
  loadMatchIngestionWorkerConfig,
  getRedisUrl,
} from './config.js';
import { logger } from './logger.js';
import { disconnectPrisma, getPrismaClient } from './prisma.js';
import { createGameDataProvider } from './provider.js';
import { createRedisConnection } from './queues.js';
import { createChampionAggregationWorker } from './queues/champion-aggregation/champion-aggregation.worker.js';
import { createMatchIngestionWorker } from './queues/match-ingestion/match-ingestion.worker.js';

async function main(): Promise<void> {
  const redisUrl = getRedisUrl();
  const connectionInfo = parseBullMqRedisConnectionInfo(redisUrl, resolveBullMqPrefix());
  const matchIngestionConfig = loadMatchIngestionWorkerConfig();
  const championAggregationConfig = loadChampionAggregationWorkerConfig();
  const connection = createRedisConnection();
  const prisma = getPrismaClient();
  await prisma.$connect();
  const providerHandle = createGameDataProvider();
  const riotConfig = providerHandle.config;

  const championAggregationQueue = new Queue<ChampionAggregationJobPayload>(
    championAggregationConfig.queueName,
    {
      connection,
      prefix: connectionInfo.prefix,
    },
  );

  logger.info('Worker starting', {
    matchIngestionQueue: matchIngestionConfig.queueName,
    matchIngestionJob: MATCH_INGESTION_JOB_NAME,
    matchIngestionConcurrency: matchIngestionConfig.concurrency,
    championAggregationQueue: championAggregationConfig.queueName,
    championAggregationJob: CHAMPION_AGGREGATION_JOB_NAME,
    championAggregationConcurrency: championAggregationConfig.concurrency,
    sourceNormalizationVersion: championAggregationConfig.sourceNormalizationVersion,
    aggregationVersion: championAggregationConfig.aggregationVersion,
    providerMode: riotConfig.providerMode,
    providerConfigured: riotConfig.providerMode === 'mock' || Boolean(riotConfig.apiKey),
    redisDatabase: connectionInfo.database,
    bullmqPrefix: connectionInfo.prefix,
    redisConnectionReady: connection.status === 'ready' || connection.status === 'connecting',
    prismaConnectionReady: true,
    health: createHealthResponse('worker').status,
  });

  let matchIngestionWorker;
  let championAggregationWorker;
  try {
    matchIngestionWorker = createMatchIngestionWorker({
      connection,
      config: matchIngestionConfig,
      deps: {
        prisma,
        provider: providerHandle.provider,
        redis: connection,
        config: matchIngestionConfig,
        championAggregationQueue,
        championAggregationConfig,
        sharedCooldown: new RiotSharedCooldownStore(connection),
      },
    });

    championAggregationWorker = createChampionAggregationWorker({
      connection,
      config: championAggregationConfig,
      aggregationQueue: championAggregationQueue,
      deps: {
        prisma,
        redis: connection,
        config: championAggregationConfig,
        aggregationQueue: championAggregationQueue,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown worker init error';
    logger.error('Worker failed to initialize consumers', { error: message });
    await Promise.allSettled([championAggregationQueue.close(), connection.quit(), disconnectPrisma()]);
    process.exit(1);
    return;
  }

  // Confirm both queues are probeable — readiness requires both consumers.
  try {
    const matchProbe = new Queue(matchIngestionConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const aggProbe = new Queue(championAggregationConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const [matchPaused, aggPaused] = await Promise.all([
      matchProbe.isPaused(),
      aggProbe.isPaused(),
    ]);
    logger.info('Queue probes', {
      matchIngestionQueue: matchIngestionConfig.queueName,
      matchIngestionPaused: matchPaused,
      matchIngestionJob: MATCH_INGESTION_JOB_NAME,
      championAggregationQueue: championAggregationConfig.queueName,
      championAggregationPaused: aggPaused,
      championAggregationJob: CHAMPION_AGGREGATION_JOB_NAME,
      readiness: 'both_consumers_initialized',
    });
    await Promise.allSettled([matchProbe.close(), aggProbe.close()]);
  } catch (error: unknown) {
    logger.warn('Queue probe failed', {
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
    await Promise.allSettled([
      matchIngestionWorker.close(),
      championAggregationWorker.close(),
    ]);
    await Promise.allSettled([
      championAggregationQueue.close(),
      providerHandle.close(),
      disconnectPrisma(),
      connection.quit(),
    ]);
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
