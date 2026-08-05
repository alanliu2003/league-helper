import type { GameDataProvider } from '@league-helper/shared';
import {
  loadRiotConfig,
  MockRiotGameDataProvider,
  RiotApiClient,
  RiotGameDataProvider,
  createConsoleRiotLogger,
  type RiotConfig,
} from '@league-helper/server-riot';

export type GameDataProviderHandle = {
  provider: GameDataProvider;
  /** No-op for mock; reserved for future client cleanup. */
  close: () => Promise<void>;
  config: RiotConfig;
};

/** Build the Riot game-data provider for the worker (mock or real). */
export function createGameDataProvider(
  env: NodeJS.ProcessEnv = process.env,
): GameDataProviderHandle {
  const config = loadRiotConfig(env);
  if (config.providerMode === 'mock') {
    return {
      provider: new MockRiotGameDataProvider(),
      close: async () => undefined,
      config,
    };
  }

  const client = RiotApiClient.create(config, {
    logger: createConsoleRiotLogger('WorkerRiotApiClient'),
  });
  return {
    provider: new RiotGameDataProvider(client),
    close: async () => undefined,
    config,
  };
}
