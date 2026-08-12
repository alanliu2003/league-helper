import type { GameDataProvider } from '@league-helper/shared';
import {
  createConsoleRiotLogger,
  createRiotRequestBudgetGate,
  loadRiotConfig,
  loadRiotRequestBudgetConfig,
  MockRiotGameDataProvider,
  RiotApiClient,
  RiotGameDataProvider,
  RiotRequestBudgetStore,
  type RequestBudgetRedisClient,
  type RiotConfig,
} from '@league-helper/server-riot';

export type GameDataProviderHandle = {
  provider: GameDataProvider;
  /** No-op for mock; reserved for future client cleanup. */
  close: () => Promise<void>;
  config: RiotConfig;
  requestBudget: RiotRequestBudgetStore | null;
};

/** Build the Riot game-data provider for the worker (mock or real). */
export function createGameDataProvider(
  env: NodeJS.ProcessEnv = process.env,
  options?: { redis?: RequestBudgetRedisClient | null },
): GameDataProviderHandle {
  const config = loadRiotConfig(env);
  if (config.providerMode === 'mock') {
    return {
      provider: new MockRiotGameDataProvider(),
      close: async () => undefined,
      config,
      requestBudget: null,
    };
  }

  const budgetConfig = loadRiotRequestBudgetConfig(env);
  const requestBudget =
    options?.redis && budgetConfig.enabled
      ? new RiotRequestBudgetStore(options.redis, { config: budgetConfig })
      : null;

  const client = RiotApiClient.create(config, {
    logger: createConsoleRiotLogger('WorkerRiotApiClient'),
    requestBudget: createRiotRequestBudgetGate(requestBudget),
  });
  return {
    provider: new RiotGameDataProvider(client),
    close: async () => undefined,
    config,
    requestBudget,
  };
}
