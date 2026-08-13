import { decideRetry, sleep } from '@league-helper/server-riot';
import { DataDragonVersionsSchema } from '../data-dragon.types';
import type { ChampionStaticSyncConfig } from './sync-champion-static.config';
import {
  parseChampionStaticFile,
  type SyncDataDragonChampionFile,
} from './sync-champion-static.types';

export type SyncFetchDeps = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
};

type UrlKind = 'versions' | 'champion.json' | 'championFull.json';

export class DataDragonSyncFetchError extends Error {
  constructor(
    message: string,
    readonly kind: UrlKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DataDragonSyncFetchError';
  }
}

async function fetchJsonWithRetry(
  url: string,
  kind: UrlKind,
  config: ChampionStaticSyncConfig,
  deps: SyncFetchDeps,
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
        throw new DataDragonSyncFetchError(
          `Data Dragon ${kind} request failed with HTTP ${response.status}`,
          kind,
          response.status,
        );
      }

      try {
        return (await response.json()) as unknown;
      } catch {
        throw new DataDragonSyncFetchError(
          `Data Dragon ${kind} response was not valid JSON`,
          kind,
          response.status,
        );
      }
    } catch (error: unknown) {
      if (error instanceof DataDragonSyncFetchError) {
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
      throw new DataDragonSyncFetchError(
        `Data Dragon ${kind} request failed after retries: ${detail}`,
        kind,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function resolveDataDragonVersion(
  config: ChampionStaticSyncConfig,
  deps: SyncFetchDeps = {},
): Promise<string> {
  if (config.version !== 'latest') {
    return config.version;
  }

  const url = `${config.baseUrl}/api/versions.json`;
  const body = await fetchJsonWithRetry(url, 'versions', config, deps);
  const parsed = DataDragonVersionsSchema.safeParse(body);
  if (!parsed.success || !parsed.data[0]) {
    throw new DataDragonSyncFetchError(
      'Data Dragon versions.json payload was rejected or empty',
      'versions',
    );
  }
  return parsed.data[0];
}

export async function fetchChampionStaticFile(
  config: ChampionStaticSyncConfig,
  version: string,
  deps: SyncFetchDeps = {},
): Promise<SyncDataDragonChampionFile> {
  const url = `${config.baseUrl}/cdn/${encodeURIComponent(version)}/data/${encodeURIComponent(config.locale)}/champion.json`;
  const body = await fetchJsonWithRetry(url, 'champion.json', config, deps);
  try {
    return parseChampionStaticFile(body);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'validation failed';
    throw new DataDragonSyncFetchError(
      `Data Dragon champion.json failed validation: ${detail}`,
      'champion.json',
    );
  }
}

export async function fetchChampionFullFile(
  config: ChampionStaticSyncConfig,
  version: string,
  deps: SyncFetchDeps = {},
): Promise<SyncDataDragonChampionFile> {
  const url = `${config.baseUrl}/cdn/${encodeURIComponent(version)}/data/${encodeURIComponent(config.locale)}/championFull.json`;
  const body = await fetchJsonWithRetry(url, 'championFull.json', config, deps);
  try {
    return parseChampionStaticFile(body);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'validation failed';
    throw new DataDragonSyncFetchError(
      `Data Dragon championFull.json failed validation: ${detail}`,
      'championFull.json',
    );
  }
}
