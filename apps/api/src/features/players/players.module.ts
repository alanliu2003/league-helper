import { Module } from '@nestjs/common';
import { RiotModule } from '../../integrations/riot/riot.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { QueuesModule } from '../../queues/queues.module';
import { PlayerCacheService } from './player-cache.service';
import { PlayerProfileService } from './player-profile.service';
import { PlayerRefreshService } from './player-refresh.service';
import { PlayerRefreshStatusService } from './player-refresh-status.service';
import { PlayerSearchService } from './player-search.service';
import { PlayersController } from './players.controller';

@Module({
  imports: [PersistenceModule, RiotModule, QueuesModule],
  controllers: [PlayersController],
  providers: [
    PlayerSearchService,
    PlayerProfileService,
    PlayerRefreshService,
    PlayerRefreshStatusService,
    PlayerCacheService,
  ],
  exports: [PlayerSearchService, PlayerProfileService, PlayerRefreshService],
})
export class PlayersModule {}
