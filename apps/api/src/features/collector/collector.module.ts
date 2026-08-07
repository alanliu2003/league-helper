import { Module } from '@nestjs/common';
import {
  CHAMPION_STATS_CONFIG,
  loadChampionStatsConfig,
} from '../../config/champion-stats.config';
import { RiotModule } from '../../integrations/riot/riot.module';
import { PersistenceModule } from '../../persistence/persistence.module';
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
import { CollectorStatusService } from './collector-status.service';
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
    CollectorRunRepository,
    CollectorEligibilityService,
    CollectorCoverageService,
    CollectorStatusService,
    CollectorAuditService,
    PopulationCollectorService,
  ],
  exports: [
    // Re-export enrollment surface (COLLECTOR_CONFIG / TrackedPlayerRepository / EnrollmentService).
    CollectorEnrollmentModule,
    CollectorRunRepository,
    CollectorEligibilityService,
    CollectorCoverageService,
    CollectorStatusService,
    CollectorAuditService,
    PopulationCollectorService,
  ],
})
export class CollectorModule {}
