import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  DATA_DRAGON_CONFIG,
  loadDataDragonConfig,
  type DataDragonConfig,
} from '../../config/data-dragon.config';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';
import { QueuesModule } from '../../queues/queues.module';
import { DataDragonChampionService } from './data-dragon-champion.service';

@Module({
  imports: [QueuesModule],
  providers: [
    {
      provide: DATA_DRAGON_CONFIG,
      useFactory: () => loadDataDragonConfig(),
    },
    {
      provide: DataDragonChampionService,
      inject: [DATA_DRAGON_CONFIG, REDIS_CONNECTION],
      useFactory: (config: DataDragonConfig, redis: Redis) =>
        new DataDragonChampionService(config, redis),
    },
  ],
  exports: [DataDragonChampionService, DATA_DRAGON_CONFIG],
})
export class DataDragonModule {}
