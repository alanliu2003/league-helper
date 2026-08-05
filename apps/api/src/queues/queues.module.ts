import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  MATCH_INGESTION_QUEUE_NAME,
  createBullMqConnectionOptions,
  resolveBullMqPrefix,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import { loadPlayerRefreshConfig, PLAYER_REFRESH_CONFIG } from '../config/player-refresh.config';
import { PersistenceModule } from '../persistence/persistence.module';
import { IngestionReconciliationService } from './ingestion-reconciliation.service';
import { MatchIngestionProducer } from './match-ingestion.producer';
import { QueuesLifecycleService } from './queues-lifecycle.service';
import { MATCH_INGESTION_QUEUE, REDIS_CONNECTION } from './queue.tokens';

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
    MatchIngestionProducer,
    IngestionReconciliationService,
    QueuesLifecycleService,
  ],
  exports: [
    PLAYER_REFRESH_CONFIG,
    REDIS_CONNECTION,
    MATCH_INGESTION_QUEUE,
    MatchIngestionProducer,
    IngestionReconciliationService,
  ],
})
export class QueuesModule {}
