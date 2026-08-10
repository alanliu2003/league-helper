import { Module } from '@nestjs/common';
import { RiotSharedCooldownStore } from '@league-helper/server-riot';
import type { Redis } from 'ioredis';
import {
  CHAMPION_STATS_CONFIG,
  loadChampionStatsConfig,
} from '../../config/champion-stats.config';
import { RiotModule } from '../../integrations/riot/riot.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';
import {
  DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
  PLAYER_MATCH_DISCOVERY_PAGE_SIZE,
} from '../players/discovery/player-match-discovery.service';
import { PlayersModule } from '../players/players.module';
import { CollectorAuditService } from './collector-audit.service';
import { CollectorCoverageService } from './collector-coverage.service';
import { CollectorEligibilityService } from './collector-eligibility.service';
import { CollectorEnrollmentModule } from './collector-enrollment.module';
import { CollectorRunRepository } from './collector-run.repository';
import { CollectorSchedulerService } from './collector-scheduler.service';
import { CollectorSchedulerStateRepository } from './collector-scheduler-state.repository';
import { CollectorStatusService } from './collector-status.service';
import { RIOT_SHARED_COOLDOWN_STORE } from './collector.tokens';
import { LadderSeedService } from './ladder/ladder-seed.service';
import { PopulationCollectorService } from './population-collector.service';

@Module({
  imports: [PersistenceModule, RiotModule, PlayersModule, CollectorEnrollmentModule],
  providers: [
    {
      provide: CHAMPION_STATS_CONFIG,
      useFactory: () => loadChampionStatsConfig(process.env),
    },
    {
      provide: PLAYER_MATCH_DISCOVERY_PAGE_SIZE,
      useValue: DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
    },
    {
      // QueuesModule (@Global) exports REDIS_CONNECTION.
      provide: RIOT_SHARED_COOLDOWN_STORE,
      inject: [REDIS_CONNECTION],
      useFactory: (redis: Redis) => new RiotSharedCooldownStore(redis),
    },
    CollectorRunRepository,
    CollectorSchedulerStateRepository,
    CollectorSchedulerService,
    CollectorEligibilityService,
    CollectorCoverageService,
    CollectorStatusService,
    CollectorAuditService,
    PopulationCollectorService,
    // Operator CLI only — never invoked from AppModule / worker boot.
    LadderSeedService,
  ],
  exports: [
    // Re-export enrollment surface (COLLECTOR_CONFIG / TrackedPlayerRepository / EnrollmentService).
    CollectorEnrollmentModule,
    RIOT_SHARED_COOLDOWN_STORE,
    CollectorRunRepository,
    CollectorSchedulerStateRepository,
    CollectorSchedulerService,
    CollectorEligibilityService,
    CollectorCoverageService,
    CollectorStatusService,
    CollectorAuditService,
    PopulationCollectorService,
    LadderSeedService,
  ],
})
export class CollectorModule {}
