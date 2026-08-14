import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  MATCH_INGESTION_QUEUE_NAME,
  createBullMqConnectionOptions,
  resolveBullMqPrefix,
  type ChampionAiInsightJobPayload,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import {
  CHAMPION_AI_CONFIG,
  loadChampionAiConfig,
  type ChampionAiConfig,
} from '../config/champion-ai.config';
import { loadPlayerRefreshConfig, PLAYER_REFRESH_CONFIG } from '../config/player-refresh.config';
import { PersistenceModule } from '../persistence/persistence.module';
import { ChampionAiInsightProducer } from './champion-ai-insight.producer';
import { IngestionReconciliationService } from './ingestion-reconciliation.service';
import { MatchIngestionProducer } from './match-ingestion.producer';
import { QueuesLifecycleService } from './queues-lifecycle.service';
import { CHAMPION_AI_INSIGHT_QUEUE, MATCH_INGESTION_QUEUE, REDIS_CONNECTION } from './queue.tokens';

@Global()
@Module({
  imports: [PersistenceModule],
  providers: [
    {
      provide: PLAYER_REFRESH_CONFIG,
      useFactory: () => loadPlayerRefreshConfig(),
    },
    {
      provide: REDIS_CONNECTION,
      useFactory: () => {
        const config = loadPlayerRefreshConfig();
        return new Redis(config.redisUrl, {
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });
      },
    },
    {
      provide: MATCH_INGESTION_QUEUE,
      inject: [PLAYER_REFRESH_CONFIG],
      useFactory: (config: ReturnType<typeof loadPlayerRefreshConfig>) => {
        const queueName = config.matchIngestionQueueName || MATCH_INGESTION_QUEUE_NAME;
        // Own connection options (not a shared ioredis instance) so Queue.close()
        // does not leave duplicate Redis sockets that hang Nest shutdown.
        return new Queue<MatchIngestionJobPayload>(queueName, {
          connection: createBullMqConnectionOptions(config.redisUrl),
          prefix: resolveBullMqPrefix(),
        });
      },
    },
    {
      provide: CHAMPION_AI_CONFIG,
      useFactory: () => loadChampionAiConfig(),
    },
    {
      provide: CHAMPION_AI_INSIGHT_QUEUE,
      inject: [CHAMPION_AI_CONFIG, PLAYER_REFRESH_CONFIG],
      useFactory: (
        aiConfig: ChampionAiConfig,
        refreshConfig: ReturnType<typeof loadPlayerRefreshConfig>,
      ) => {
        return new Queue<ChampionAiInsightJobPayload>(aiConfig.queueName, {
          connection: createBullMqConnectionOptions(refreshConfig.redisUrl),
          prefix: resolveBullMqPrefix(),
        });
      },
    },
    MatchIngestionProducer,
    ChampionAiInsightProducer,
    IngestionReconciliationService,
    QueuesLifecycleService,
  ],
  exports: [
    PLAYER_REFRESH_CONFIG,
    CHAMPION_AI_CONFIG,
    REDIS_CONNECTION,
    MATCH_INGESTION_QUEUE,
    CHAMPION_AI_INSIGHT_QUEUE,
    MatchIngestionProducer,
    ChampionAiInsightProducer,
    IngestionReconciliationService,
  ],
})
export class QueuesModule {}
