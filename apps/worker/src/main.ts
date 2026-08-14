import 'dotenv/config';
import { Queue } from 'bullmq';
import { RiotSharedCooldownStore } from '@league-helper/server-riot';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  CHAMPION_AI_INSIGHT_JOB_NAME,
  MATCH_INGESTION_JOB_NAME,
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  createHealthResponse,
  parseBullMqRedisConnectionInfo,
  resolveBullMqPrefix,
  type ChampionAggregationJobPayload,
  type ChampionAiInsightJobPayload,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';
import {
  loadChampionAggregationWorkerConfig,
  loadChampionAiInsightWorkerConfig,
  loadMatchIngestionWorkerConfig,
  loadParticipantRankEnrichmentWorkerConfig,
  getRedisUrl,
} from './config.js';
import { logger } from './logger.js';
import { disconnectPrisma, getPrismaClient } from './prisma.js';
import { createGameDataProvider } from './provider.js';
import { createRedisConnection } from './queues.js';
import { createChampionAggregationWorker } from './queues/champion-aggregation/champion-aggregation.worker.js';
import { createChampionAiInsightWorker } from './queues/champion-ai-insight/champion-ai-insight.worker.js';
import { createMatchIngestionWorker } from './queues/match-ingestion/match-ingestion.worker.js';
import { createParticipantRankEnrichmentWorker } from './queues/participant-rank-enrichment/participant-rank-enrichment.worker.js';

async function main(): Promise<void> {
  const redisUrl = getRedisUrl();
  const connectionInfo = parseBullMqRedisConnectionInfo(redisUrl, resolveBullMqPrefix());
  const matchIngestionConfig = loadMatchIngestionWorkerConfig();
  const championAggregationConfig = loadChampionAggregationWorkerConfig();
  const participantRankEnrichmentConfig = loadParticipantRankEnrichmentWorkerConfig();
  const championAiInsightConfig = loadChampionAiInsightWorkerConfig();
  const connection = createRedisConnection();
  const prisma = getPrismaClient();
  await prisma.$connect();
  const providerHandle = createGameDataProvider(process.env, { redis: connection });
  const riotConfig = providerHandle.config;
  const sharedCooldown = new RiotSharedCooldownStore(connection);

  const championAggregationQueue = new Queue<ChampionAggregationJobPayload>(
    championAggregationConfig.queueName,
    {
      connection,
      prefix: connectionInfo.prefix,
    },
  );

  const participantRankEnrichmentQueue = new Queue<ParticipantRankEnrichmentJobPayload>(
    participantRankEnrichmentConfig.queueName,
    {
      connection,
      prefix: connectionInfo.prefix,
    },
  );

  const championAiInsightQueue = new Queue<ChampionAiInsightJobPayload>(
    championAiInsightConfig.queueName,
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
    participantRankEnrichmentQueue: participantRankEnrichmentConfig.queueName,
    participantRankEnrichmentJob: PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
    participantRankEnrichmentConcurrency: participantRankEnrichmentConfig.concurrency,
    championAiInsightQueue: championAiInsightConfig.queueName,
    championAiInsightJob: CHAMPION_AI_INSIGHT_JOB_NAME,
    championAiInsightConcurrency: championAiInsightConfig.concurrency,
    championAiInsightEnabled: championAiInsightConfig.enabled,
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
  let participantRankEnrichmentWorker;
  let championAiInsightWorker;
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
        participantRankEnrichmentQueue,
        participantRankEnrichmentConfig,
        sharedCooldown,
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

    participantRankEnrichmentWorker = createParticipantRankEnrichmentWorker({
      connection,
      config: participantRankEnrichmentConfig,
      deps: {
        prisma,
        provider: providerHandle.provider,
        redis: connection,
        config: participantRankEnrichmentConfig,
        championAggregationQueue,
        championAggregationConfig,
        sharedCooldown,
      },
    });

    championAiInsightWorker = createChampionAiInsightWorker({
      connection,
      config: championAiInsightConfig,
      prisma,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown worker init error';
    logger.error('Worker failed to initialize consumers', { error: message });
    await Promise.allSettled([
      championAggregationQueue.close(),
      participantRankEnrichmentQueue.close(),
      championAiInsightQueue.close(),
      connection.quit(),
      disconnectPrisma(),
    ]);
    process.exit(1);
    return;
  }

  // Confirm queues are probeable — readiness requires all consumers.
  try {
    const matchProbe = new Queue(matchIngestionConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const aggProbe = new Queue(championAggregationConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const rankProbe = new Queue(participantRankEnrichmentConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const insightProbe = new Queue(championAiInsightConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const [matchPaused, aggPaused, rankPaused, insightPaused] = await Promise.all([
      matchProbe.isPaused(),
      aggProbe.isPaused(),
      rankProbe.isPaused(),
      insightProbe.isPaused(),
    ]);
    logger.info('Queue probes', {
      matchIngestionQueue: matchIngestionConfig.queueName,
      matchIngestionPaused: matchPaused,
      matchIngestionJob: MATCH_INGESTION_JOB_NAME,
      championAggregationQueue: championAggregationConfig.queueName,
      championAggregationPaused: aggPaused,
      championAggregationJob: CHAMPION_AGGREGATION_JOB_NAME,
      participantRankEnrichmentQueue: participantRankEnrichmentConfig.queueName,
      participantRankEnrichmentPaused: rankPaused,
      participantRankEnrichmentJob: PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
      championAiInsightQueue: championAiInsightConfig.queueName,
      championAiInsightPaused: insightPaused,
      championAiInsightJob: CHAMPION_AI_INSIGHT_JOB_NAME,
      readiness: 'all_consumers_initialized',
    });
    await Promise.allSettled([
      matchProbe.close(),
      aggProbe.close(),
      rankProbe.close(),
      insightProbe.close(),
    ]);
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
      participantRankEnrichmentWorker.close(),
      championAiInsightWorker.close(),
    ]);
    await Promise.allSettled([
      championAggregationQueue.close(),
      participantRankEnrichmentQueue.close(),
      championAiInsightQueue.close(),
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
