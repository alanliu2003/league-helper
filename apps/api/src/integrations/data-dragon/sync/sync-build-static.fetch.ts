import { decideRetry, sleep } from '@league-helper/server-riot';
import { DataDragonVersionsSchema } from '../data-dragon.types';
import type { ChampionStaticSyncConfig } from './sync-champion-static.config';

export type BuildStaticFetchDeps = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
};

type UrlKind = 'versions' | 'item.json' | 'runesReforged.json' | 'summoner.json';

export class DataDragonBuildStaticFetchError extends Error {
  constructor(
    message: string,
    readonly kind: UrlKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DataDragonBuildStaticFetchError';
  }
}

async function fetchJsonWithRetry(
  url: string,
  kind: UrlKind,
  config: ChampionStaticSyncConfig,
  deps: BuildStaticFetchDeps,
): Promise<unknown> {
  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
  const sleepFn = deps.sleepFn ?? ((ms: number) => sleep(ms));
  const randomFn = deps.randomFn ?? Math.random;
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetchFn(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const decision = decideRetry({
          method: 'GET',
          attempt,
          maxRetries: config.maxRetries,
          status: response.status,
          maxRetryDelayMs: config.maxRetryDelayMs,
          random: randomFn,
        });
        if (decision.retry) {
          attempt += 1;
          await sleepFn(decision.delayMs);
          continue;
        }
        throw new DataDragonBuildStaticFetchError(
          `Data Dragon ${kind} request failed with HTTP ${response.status}`,
          kind,
          response.status,
        );
      }
      return (await response.json()) as unknown;
    } catch (error: unknown) {
      if (error instanceof DataDragonBuildStaticFetchError) {
        throw error;
      }
      const decision = decideRetry({
        method: 'GET',
        attempt,
        maxRetries: config.maxRetries,
        transportError: error,
        maxRetryDelayMs: config.maxRetryDelayMs,
        random: randomFn,
      });
      if (decision.retry) {
        attempt += 1;
        await sleepFn(decision.delayMs);
        continue;
      }
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new DataDragonBuildStaticFetchError(
        `Data Dragon ${kind} request failed after retries: ${detail}`,
        kind,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function resolveBuildStaticVersion(
  config: ChampionStaticSyncConfig,
  deps: BuildStaticFetchDeps = {},
): Promise<string> {
  if (config.version !== 'latest') {
    return config.version;
  }
  const body = await fetchJsonWithRetry(
    `${config.baseUrl}/api/versions.json`,
    'versions',
    config,
    deps,
  );
  const parsed = DataDragonVersionsSchema.safeParse(body);
  if (!parsed.success || !parsed.data[0]) {
    throw new DataDragonBuildStaticFetchError(
      'Data Dragon versions.json payload was rejected or empty',
      'versions',
    );
  }
  return parsed.data[0];
}

export async function fetchItemStaticFile(
  config: ChampionStaticSyncConfig,
  version: string,
  deps: BuildStaticFetchDeps = {},
): Promise<unknown> {
  return fetchJsonWithRetry(
    `${config.baseUrl}/cdn/${encodeURIComponent(version)}/data/${encodeURIComponent(config.locale)}/item.json`,
    'item.json',
    config,
    deps,
  );
}

export async function fetchRuneStaticFile(
  config: ChampionStaticSyncConfig,
  version: string,
  deps: BuildStaticFetchDeps = {},
): Promise<unknown> {
  return fetchJsonWithRetry(
    `${config.baseUrl}/cdn/${encodeURIComponent(version)}/data/${encodeURIComponent(config.locale)}/runesReforged.json`,
    'runesReforged.json',
    config,
    deps,
  );
}

export async function fetchSummonerSpellStaticFile(
  config: ChampionStaticSyncConfig,
  version: string,
  deps: BuildStaticFetchDeps = {},
): Promise<unknown> {
  return fetchJsonWithRetry(
    `${config.baseUrl}/cdn/${encodeURIComponent(version)}/data/${encodeURIComponent(config.locale)}/summoner.json`,
    'summoner.json',
    config,
    deps,
  );
}
