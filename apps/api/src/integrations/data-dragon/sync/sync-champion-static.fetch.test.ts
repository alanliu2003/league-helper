import { describe, expect, it, vi } from 'vitest';
import type { ChampionStaticSyncConfig } from './sync-champion-static.config';
import {
  DataDragonSyncFetchError,
  fetchChampionStaticFile,
  resolveDataDragonVersion,
} from './sync-champion-static.fetch';

const baseConfig: ChampionStaticSyncConfig = {
  locale: 'en_US',
  requestTimeoutMs: 1_000,
  baseUrl: 'https://ddragon.leagueoflegends.com',
  version: 'latest',
  minChampions: 100,
  maxRetries: 2,
  maxRetryDelayMs: 5_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sync-champion-static.fetch', () => {
  it('resolves latest version from versions.json index 0', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(['16.10.1', '16.9.1']));
    const version = await resolveDataDragonVersion(baseConfig, {
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });
    expect(version).toBe('16.10.1');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('uses pinned version without calling versions.json', async () => {
    const fetchFn = vi.fn();
    const version = await resolveDataDragonVersion(
      { ...baseConfig, version: '14.15.1' },
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    expect(version).toBe('14.15.1');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches and parses champion.json', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        version: '16.10.1',
        data: {
          Ahri: {
            id: 'Ahri',
            key: '103',
            name: 'Ahri',
            title: 'the Nine-Tailed Fox',
            tags: ['Mage'],
          },
        },
      }),
    );
    const file = await fetchChampionStaticFile(baseConfig, '16.10.1', {
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn: async () => undefined,
      randomFn: () => 0,
    });
    expect(file.version).toBe('16.10.1');
    expect(file.data.Ahri?.id).toBe('Ahri');
  });

  it('rejects invalid champion.json payload', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ version: '16.10.1', data: {} }));
    await expect(
      fetchChampionStaticFile(baseConfig, '16.10.1', {
        fetchFn: fetchFn as unknown as typeof fetch,
        sleepFn: async () => undefined,
        randomFn: () => 0,
      }),
    ).rejects.toBeInstanceOf(DataDragonSyncFetchError);
  });

  it('retries on timeout then fails after budget', async () => {
    const sleepFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    });

    await expect(
      fetchChampionStaticFile(baseConfig, '16.10.1', {
        fetchFn: fetchFn as unknown as typeof fetch,
        sleepFn,
        randomFn: () => 0,
      }),
    ).rejects.toThrow(/champion\.json/i);

    // initial + 2 retries
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('retries 503 then succeeds', async () => {
    const sleepFn = vi.fn(async () => undefined);
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: 'busy' }, 503);
      }
      return jsonResponse({
        version: '16.10.1',
        data: {
          Ahri: {
            id: 'Ahri',
            key: '103',
            name: 'Ahri',
            title: 'the Nine-Tailed Fox',
            tags: ['Mage'],
          },
        },
      });
    });

    const file = await fetchChampionStaticFile(baseConfig, '16.10.1', {
      fetchFn: fetchFn as unknown as typeof fetch,
      sleepFn,
      randomFn: () => 0,
    });
    expect(file.data.Ahri?.key).toBe('103');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('fails immediately on non-retryable 404', async () => {
    const sleepFn = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'missing' }, 404));

    await expect(
      fetchChampionStaticFile(baseConfig, '16.10.1', {
        fetchFn: fetchFn as unknown as typeof fetch,
        sleepFn,
        randomFn: () => 0,
      }),
    ).rejects.toMatchObject({ status: 404, kind: 'champion.json' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});
