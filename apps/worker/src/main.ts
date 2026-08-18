import 'dotenv/config';
import { Queue } from 'bullmq';
import { RiotSharedCooldownStore } from '@league-helper/server-riot';
import {
  CHAMPION_AGGREGATION_JOB_NAME,
  CHAMPION_AI_INSIGHT_JOB_NAME,
  MATCH_INGESTION_JOB_NAME,
  MATCH_TIMELINE_JOB_NAME,
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
  PLAYER_AI_PLAYSTYLE_JOB_NAME,
  createHealthResponse,
  parseBullMqRedisConnectionInfo,
  resolveBullMqPrefix,
  type ChampionAggregationJobPayload,
  type ChampionAiInsightJobPayload,
  type ParticipantRankEnrichmentJobPayload,
  type PlayerPlaystyleInsightJobPayload,
} from '@league-helper/shared';
import {
  loadChampionAggregationWorkerConfig,
  loadChampionAiInsightWorkerConfig,
  loadMatchIngestionWorkerConfig,
  loadMatchTimelineWorkerConfig,
  loadParticipantRankEnrichmentWorkerConfig,
  loadPlayerPlaystyleInsightWorkerConfig,
  getRedisUrl,
} from './config.js';
import { logger } from './logger.js';
import { disconnectPrisma, getPrismaClient } from './prisma.js';
import { createGameDataProvider } from './provider.js';
import { createRedisConnection } from './queues.js';
import { createChampionAggregationWorker } from './queues/champion-aggregation/champion-aggregation.worker.js';
import { createChampionAiInsightWorker } from './queues/champion-ai-insight/champion-ai-insight.worker.js';
import { createMatchIngestionWorker } from './queues/match-ingestion/match-ingestion.worker.js';
import { createMatchTimelineWorker } from './queues/match-timeline/match-timeline.worker.js';
import { createParticipantRankEnrichmentWorker } from './queues/participant-rank-enrichment/participant-rank-enrichment.worker.js';
import { createPlayerPlaystyleInsightWorker } from './queues/player-playstyle-insight/player-playstyle-insight.worker.js';

async function main(): Promise<void> {
  const redisUrl = getRedisUrl();
  const connectionInfo = parseBullMqRedisConnectionInfo(redisUrl, resolveBullMqPrefix());
  const matchIngestionConfig = loadMatchIngestionWorkerConfig();
  const matchTimelineConfig = loadMatchTimelineWorkerConfig();
  const championAggregationConfig = loadChampionAggregationWorkerConfig();
  const participantRankEnrichmentConfig = loadParticipantRankEnrichmentWorkerConfig();
  const championAiInsightConfig = loadChampionAiInsightWorkerConfig();
  const playerPlaystyleInsightConfig = loadPlayerPlaystyleInsightWorkerConfig();
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

  const playerPlaystyleInsightQueue = new Queue<PlayerPlaystyleInsightJobPayload>(
    playerPlaystyleInsightConfig.queueName,
    {
      connection,
      prefix: connectionInfo.prefix,
    },
  );

  logger.info('Worker starting', {
    matchIngestionQueue: matchIngestionConfig.queueName,
    matchIngestionJob: MATCH_INGESTION_JOB_NAME,
    matchIngestionConcurrency: matchIngestionConfig.concurrency,
    matchTimelineQueue: matchTimelineConfig.queueName,
    matchTimelineJob: MATCH_TIMELINE_JOB_NAME,
    matchTimelineConcurrency: matchTimelineConfig.concurrency,
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
    playerPlaystyleInsightQueue: playerPlaystyleInsightConfig.queueName,
    playerPlaystyleInsightJob: PLAYER_AI_PLAYSTYLE_JOB_NAME,
    playerPlaystyleInsightConcurrency: playerPlaystyleInsightConfig.concurrency,
    playerPlaystyleInsightEnabled: playerPlaystyleInsightConfig.enabled,
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
  let matchTimelineWorker;
  let championAggregationWorker;
  let participantRankEnrichmentWorker;
  let championAiInsightWorker;
  let playerPlaystyleInsightWorker;
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

    matchTimelineWorker = createMatchTimelineWorker({
      connection,
      config: matchTimelineConfig,
      deps: {
        prisma,
        provider: providerHandle.provider,
        config: matchTimelineConfig,
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

    playerPlaystyleInsightWorker = createPlayerPlaystyleInsightWorker({
      connection,
      config: playerPlaystyleInsightConfig,
      prisma,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown worker init error';
    logger.error('Worker failed to initialize consumers', { error: message });
    await Promise.allSettled([
      championAggregationQueue.close(),
      participantRankEnrichmentQueue.close(),
      championAiInsightQueue.close(),
      playerPlaystyleInsightQueue.close(),
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
    const timelineProbe = new Queue(matchTimelineConfig.queueName, {
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
    const playstyleProbe = new Queue(playerPlaystyleInsightConfig.queueName, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
      prefix: connectionInfo.prefix,
    });
    const [matchPaused, timelinePaused, aggPaused, rankPaused, insightPaused, playstylePaused] =
      await Promise.all([
        matchProbe.isPaused(),
        timelineProbe.isPaused(),
        aggProbe.isPaused(),
        rankProbe.isPaused(),
        insightProbe.isPaused(),
        playstyleProbe.isPaused(),
      ]);
    logger.info('Queue probes', {
      matchIngestionQueue: matchIngestionConfig.queueName,
      matchIngestionPaused: matchPaused,
      matchIngestionJob: MATCH_INGESTION_JOB_NAME,
      matchTimelineQueue: matchTimelineConfig.queueName,
      matchTimelinePaused: timelinePaused,
      matchTimelineJob: MATCH_TIMELINE_JOB_NAME,
      championAggregationQueue: championAggregationConfig.queueName,
      championAggregationPaused: aggPaused,
      championAggregationJob: CHAMPION_AGGREGATION_JOB_NAME,
      participantRankEnrichmentQueue: participantRankEnrichmentConfig.queueName,
      participantRankEnrichmentPaused: rankPaused,
      participantRankEnrichmentJob: PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
      championAiInsightQueue: championAiInsightConfig.queueName,
      championAiInsightPaused: insightPaused,
      championAiInsightJob: CHAMPION_AI_INSIGHT_JOB_NAME,
      playerPlaystyleInsightQueue: playerPlaystyleInsightConfig.queueName,
      playerPlaystyleInsightPaused: playstylePaused,
      playerPlaystyleInsightJob: PLAYER_AI_PLAYSTYLE_JOB_NAME,
      readiness: 'all_consumers_initialized',
    });
    await Promise.allSettled([
      matchProbe.close(),
      timelineProbe.close(),
      aggProbe.close(),
      rankProbe.close(),
      insightProbe.close(),
      playstyleProbe.close(),
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
      matchTimelineWorker.close(),
      championAggregationWorker.close(),
      participantRankEnrichmentWorker.close(),
      championAiInsightWorker.close(),
      playerPlaystyleInsightWorker.close(),
    ]);
    await Promise.allSettled([
      championAggregationQueue.close(),
      participantRankEnrichmentQueue.close(),
      championAiInsightQueue.close(),
      playerPlaystyleInsightQueue.close(),
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
