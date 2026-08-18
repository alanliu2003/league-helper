import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  MATCH_INGESTION_QUEUE_NAME,
  MATCH_TIMELINE_QUEUE_NAME,
  createBullMqConnectionOptions,
  resolveBullMqPrefix,
  type ChampionAiInsightJobPayload,
  type MatchIngestionJobPayload,
  type MatchTimelineJobPayload,
  type PlayerPlaystyleInsightJobPayload,
} from '@league-helper/shared';
import {
  CHAMPION_AI_CONFIG,
  loadChampionAiConfig,
  type ChampionAiConfig,
} from '../config/champion-ai.config';
import {
  PLAYER_PLAYSTYLE_AI_CONFIG,
  loadPlayerPlaystyleAiConfig,
  type PlayerPlaystyleAiConfig,
} from '../config/player-playstyle-ai.config';
import { loadPlayerRefreshConfig, PLAYER_REFRESH_CONFIG } from '../config/player-refresh.config';
import { PersistenceModule } from '../persistence/persistence.module';
import { ChampionAiInsightProducer } from './champion-ai-insight.producer';
import { PlayerPlaystyleInsightProducer } from './player-playstyle-insight.producer';
import { IngestionReconciliationService } from './ingestion-reconciliation.service';
import { MatchIngestionProducer } from './match-ingestion.producer';
import { MatchTimelineProducer } from './match-timeline.producer';
import { QueuesLifecycleService } from './queues-lifecycle.service';
import {
  CHAMPION_AI_INSIGHT_QUEUE,
  MATCH_INGESTION_QUEUE,
  MATCH_TIMELINE_QUEUE,
  PLAYER_AI_PLAYSTYLE_QUEUE,
  REDIS_CONNECTION,
} from './queue.tokens';

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
      provide: MATCH_TIMELINE_QUEUE,
      inject: [PLAYER_REFRESH_CONFIG],
      useFactory: (config: ReturnType<typeof loadPlayerRefreshConfig>) => {
        const queueName = config.matchTimelineQueueName || MATCH_TIMELINE_QUEUE_NAME;
        return new Queue<MatchTimelineJobPayload>(queueName, {
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
    {
      provide: PLAYER_PLAYSTYLE_AI_CONFIG,
      useFactory: () => loadPlayerPlaystyleAiConfig(),
    },
    {
      provide: PLAYER_AI_PLAYSTYLE_QUEUE,
      inject: [PLAYER_PLAYSTYLE_AI_CONFIG, PLAYER_REFRESH_CONFIG],
      useFactory: (
        aiConfig: PlayerPlaystyleAiConfig,
        refreshConfig: ReturnType<typeof loadPlayerRefreshConfig>,
      ) => {
        return new Queue<PlayerPlaystyleInsightJobPayload>(aiConfig.queueName, {
          connection: createBullMqConnectionOptions(refreshConfig.redisUrl),
          prefix: resolveBullMqPrefix(),
        });
      },
    },
    MatchIngestionProducer,
    MatchTimelineProducer,
    ChampionAiInsightProducer,
    PlayerPlaystyleInsightProducer,
    IngestionReconciliationService,
    QueuesLifecycleService,
  ],
  exports: [
    PLAYER_REFRESH_CONFIG,
    CHAMPION_AI_CONFIG,
    PLAYER_PLAYSTYLE_AI_CONFIG,
    REDIS_CONNECTION,
    MATCH_INGESTION_QUEUE,
    MATCH_TIMELINE_QUEUE,
    CHAMPION_AI_INSIGHT_QUEUE,
    PLAYER_AI_PLAYSTYLE_QUEUE,
    MatchIngestionProducer,
    MatchTimelineProducer,
    ChampionAiInsightProducer,
    PlayerPlaystyleInsightProducer,
    IngestionReconciliationService,
  ],
})
export class QueuesModule {}
