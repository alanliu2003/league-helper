import { Module } from '@nestjs/common';
import type { GameDataProvider } from '@league-helper/shared';
import {
  loadRiotConfig,
  MockRiotGameDataProvider,
  RiotApiClient,
  RiotGameDataProvider,
  type RiotConfig,
} from '@league-helper/server-riot';
import { GAME_DATA_PROVIDER, RIOT_CONFIG } from './riot.tokens';

@Module({
  providers: [
    {
      provide: RIOT_CONFIG,
      useFactory: (): RiotConfig => loadRiotConfig(),
    },
    {
      provide: RiotApiClient,
      useFactory: (config: RiotConfig): RiotApiClient => RiotApiClient.create(config),
      inject: [RIOT_CONFIG],
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
  exports: [GAME_DATA_PROVIDER, RIOT_CONFIG, RiotApiClient, MockRiotGameDataProvider],
})
export class RiotModule {}
