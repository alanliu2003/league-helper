import { Module } from '@nestjs/common';
import type { GameDataProvider } from '@league-helper/shared';
import {
  createRiotRequestBudgetGate,
  loadRiotConfig,
  loadRiotRequestBudgetConfig,
  MockRiotGameDataProvider,
  RiotApiClient,
  RiotGameDataProvider,
  RiotRequestBudgetStore,
  type RiotConfig,
} from '@league-helper/server-riot';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from '../../queues/queue.tokens';
import { GAME_DATA_PROVIDER, RIOT_CONFIG, RIOT_REQUEST_BUDGET_STORE } from './riot.tokens';

@Module({
  providers: [
    {
      provide: RIOT_CONFIG,
      useFactory: (): RiotConfig => loadRiotConfig(),
    },
    {
      provide: RIOT_REQUEST_BUDGET_STORE,
      // Optional: unit tests may import RiotModule without QueuesModule/Redis.
      inject: [{ token: REDIS_CONNECTION, optional: true }],
      useFactory: (redis?: Redis): RiotRequestBudgetStore | null => {
        if (!redis) {
          return null;
        }
        return new RiotRequestBudgetStore(redis, {
          config: loadRiotRequestBudgetConfig(),
        });
      },
    },
    {
      provide: RiotApiClient,
      useFactory: (
        config: RiotConfig,
        budgetStore: RiotRequestBudgetStore | null,
      ): RiotApiClient =>
        RiotApiClient.create(config, {
          requestBudget: createRiotRequestBudgetGate(budgetStore),
        }),
      inject: [RIOT_CONFIG, RIOT_REQUEST_BUDGET_STORE],
    },
    {
      provide: MockRiotGameDataProvider,
      useFactory: (): MockRiotGameDataProvider => new MockRiotGameDataProvider(),
    },
    {
      provide: RiotGameDataProvider,
      useFactory: (client: RiotApiClient): RiotGameDataProvider => new RiotGameDataProvider(client),
      inject: [RiotApiClient],
    },
    {
      provide: GAME_DATA_PROVIDER,
      useFactory: (
        config: RiotConfig,
        mockProvider: MockRiotGameDataProvider,
        realProvider: RiotGameDataProvider,
      ): GameDataProvider => {
        return config.providerMode === 'mock' ? mockProvider : realProvider;
      },
      inject: [RIOT_CONFIG, MockRiotGameDataProvider, RiotGameDataProvider],
    },
  ],
  exports: [
    GAME_DATA_PROVIDER,
    RIOT_CONFIG,
    RiotApiClient,
    MockRiotGameDataProvider,
    RIOT_REQUEST_BUDGET_STORE,
  ],
})
export class RiotModule {}
