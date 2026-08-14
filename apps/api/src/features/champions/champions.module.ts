import { Module } from '@nestjs/common';
import { CHAMPION_STATS_CONFIG, loadChampionStatsConfig } from '../../config/champion-stats.config';
import { DataDragonModule } from '../../integrations/data-dragon/data-dragon.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { QueuesModule } from '../../queues/queues.module';
import { ChampionBuildsService } from './champion-builds.service';
import { ChampionInsightsService } from './champion-insights.service';
import { ChampionMatchupsService } from './champion-matchups.service';
import { ChampionStatsCacheService } from './champion-stats-cache.service';
import { ChampionStatsController } from './champion-stats.controller';
import { ChampionStatsService } from './champion-stats.service';
import { ChampionStaticService } from './champion-static.service';
import { ChampionsController } from './champions.controller';

@Module({
  imports: [PersistenceModule, DataDragonModule, QueuesModule],
  controllers: [ChampionsController, ChampionStatsController],
  providers: [
    {
      provide: CHAMPION_STATS_CONFIG,
      useFactory: () => loadChampionStatsConfig(),
    },
    ChampionStaticService,
    ChampionStatsService,
    ChampionBuildsService,
    ChampionMatchupsService,
    ChampionInsightsService,
    ChampionStatsCacheService,
  ],
  exports: [
    ChampionStaticService,
    ChampionStatsService,
    ChampionBuildsService,
    ChampionMatchupsService,
    ChampionInsightsService,
  ],
})
export class ChampionsModule {}
