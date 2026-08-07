import { Module } from '@nestjs/common';
import { DataDragonModule } from '../../integrations/data-dragon/data-dragon.module';
import { RiotModule } from '../../integrations/riot/riot.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { QueuesModule } from '../../queues/queues.module';
import { CollectorEnrollmentModule } from '../collector/collector-enrollment.module';
import {
  DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
  PLAYER_MATCH_DISCOVERY_PAGE_SIZE,
  PlayerMatchDiscoveryService,
} from './discovery/player-match-discovery.service';
import { PlayerCacheService } from './player-cache.service';
import { PlayerProfileService } from './player-profile.service';
import { PlayerRefreshService } from './player-refresh.service';
import { PlayerRefreshStatusService } from './player-refresh-status.service';
import { PlayerSearchService } from './player-search.service';
import { PlayersController } from './players.controller';

@Module({
  imports: [
    PersistenceModule,
    RiotModule,
    QueuesModule,
    DataDragonModule,
    CollectorEnrollmentModule,
  ],
  controllers: [PlayersController],
  providers: [
    PlayerSearchService,
    PlayerProfileService,
    PlayerRefreshService,
    PlayerRefreshStatusService,
    PlayerCacheService,
    {
      provide: PLAYER_MATCH_DISCOVERY_PAGE_SIZE,
      useValue: DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
    },
    PlayerMatchDiscoveryService,
  ],
  exports: [
    PlayerSearchService,
    PlayerProfileService,
    PlayerRefreshService,
    PlayerMatchDiscoveryService,
  ],
})
export class PlayersModule {}
