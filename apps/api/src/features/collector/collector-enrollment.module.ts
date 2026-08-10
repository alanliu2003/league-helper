import { Module } from '@nestjs/common';
import type { PlatformRoute } from '@league-helper/shared';
import { PersistenceModule } from '../../persistence/persistence.module';
import { RiotModule } from '../../integrations/riot/riot.module';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import { loadCollectorConfig } from './collector.config';
import { COLLECTOR_CONFIG, CollectorEnrollmentService } from './collector-enrollment.service';
import {
  LADDER_ACCOUNT_RESOLVER,
  LadderEnrollmentService,
  type LadderAccountResolver,
} from './ladder/ladder-enrollment.service';
import { TrackedPlayerRepository } from './tracked-player.repository';

type AccountByPuuidProvider = {
  getAccountByPuuid(input: {
    puuid: string;
    platform: PlatformRoute;
  }): Promise<{
    riotId: { gameName: string; tagLine: string };
    regionalRoute?: string;
  }>;
};

function isAccountByPuuidProvider(value: unknown): value is AccountByPuuidProvider {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as AccountByPuuidProvider).getAccountByPuuid === 'function'
  );
}

/**
 * Narrow enrollment surface for PlayersModule (search/bootstrap hooks).
 * Keeps PlayersModule from importing full CollectorModule (avoids circular deps
 * with CollectorModule → PlayersModule for discovery).
 *
 * LADDER_ACCOUNT_RESOLVER is wired here for ladder enrollment / ladder-seed CLI.
 * RiotModule does not import Players/Collector, so this import is acyclic.
 */
@Module({
  imports: [PersistenceModule, RiotModule],
  providers: [
    {
      provide: COLLECTOR_CONFIG,
      useFactory: () => loadCollectorConfig(process.env),
    },
    {
      provide: LADDER_ACCOUNT_RESOLVER,
      useFactory: (gameData: unknown): LadderAccountResolver | undefined => {
        if (!isAccountByPuuidProvider(gameData)) {
          return undefined;
        }
        return async ({ puuid, platformRoute }) => {
          const account = await gameData.getAccountByPuuid({
            puuid,
            platform: platformRoute as PlatformRoute,
          });
          return {
            gameName: account.riotId.gameName,
            tagLine: account.riotId.tagLine,
            ...(account.regionalRoute !== undefined
              ? { regionalRoute: account.regionalRoute }
              : {}),
          };
        };
      },
      inject: [GAME_DATA_PROVIDER],
    },
    TrackedPlayerRepository,
    CollectorEnrollmentService,
    LadderEnrollmentService,
  ],
  exports: [
    COLLECTOR_CONFIG,
    TrackedPlayerRepository,
    CollectorEnrollmentService,
    LadderEnrollmentService,
    LADDER_ACCOUNT_RESOLVER,
  ],
})
export class CollectorEnrollmentModule {}
