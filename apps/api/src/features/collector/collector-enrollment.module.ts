import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../persistence/persistence.module';
import { loadCollectorConfig } from './collector.config';
import { COLLECTOR_CONFIG, CollectorEnrollmentService } from './collector-enrollment.service';
import { TrackedPlayerRepository } from './tracked-player.repository';

/**
 * Narrow enrollment surface for PlayersModule (search/bootstrap hooks).
 * Keeps PlayersModule from importing full CollectorModule (avoids circular deps
 * with CollectorModule → PlayersModule for discovery).
 */
@Module({
  imports: [PersistenceModule],
  providers: [
    {
      provide: COLLECTOR_CONFIG,
      useFactory: () => loadCollectorConfig(process.env),
    },
    TrackedPlayerRepository,
    CollectorEnrollmentService,
  ],
  exports: [COLLECTOR_CONFIG, TrackedPlayerRepository, CollectorEnrollmentService],
})
export class CollectorEnrollmentModule {}
