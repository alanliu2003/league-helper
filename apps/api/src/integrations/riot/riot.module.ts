import { Module } from '@nestjs/common';
import type { GameDataProvider } from '@league-helper/shared';
import { loadRiotConfig, type RiotConfig } from './riot.config';
import { RiotApiClient } from './riot-api.client';
import { RiotGameDataProvider } from './riot-game-data.provider';
import { MockRiotGameDataProvider } from './mock-riot-game-data.provider';
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
    MockRiotGameDataProvider,
    RiotGameDataProvider,
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
