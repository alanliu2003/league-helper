import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataDragonConfig } from '../../config/data-dragon.config';
import { DataDragonChampionService } from './data-dragon-champion.service';
import {
  MOCK_DDRAGON_CHAMPION_JSON,
  MOCK_DDRAGON_VERSION,
  MOCK_DDRAGON_VERSIONS,
  expectedTryndamereIconUrl,
} from './test-utils/mock-ddragon-fixtures';

type MockFetchCall = {
  url: string;
  init?: RequestInit;
};

function createMockFetch(handlers: Array<{ status: number; body?: unknown; textBody?: string }>) {
  const calls: MockFetchCall[] = [];
  let index = 0;

  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    if (index >= handlers.length) {
      throw new Error(`Unexpected fetch call to ${url}`);
    }
    const configured = handlers[index++]!;
    const headers = new Headers({ 'content-type': 'application/json' });
    const body =
      configured.textBody !== undefined
        ? configured.textBody
        : configured.body === undefined
          ? ''
          : JSON.stringify(configured.body);
    return new Response(body, { status: configured.status, headers });
  };

  return { fetchFn, calls };
}

function createRedisMock(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.delete(key);
      return existed ? 1 : 0;
    }),
  };
}

const baseConfig: DataDragonConfig = {
  locale: 'en_US',
  cacheTtlSeconds: 21_600,
  requestTimeoutMs: 10_000,
  baseUrl: 'https://ddragon.leagueoflegends.com',
};

describe('DataDragonChampionService', () => {
  const originalApiKey = process.env.RIOT_API_KEY;

  beforeEach(() => {
    process.env.RIOT_API_KEY = 'test-riot-key-should-never-be-sent';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.RIOT_API_KEY;
    } else {
      process.env.RIOT_API_KEY = originalApiKey;
    }
  });

  it('parses versions and champion.json and resolves numeric id 23 to Tryndamere', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const redis = createRedisMock();
    const service = new DataDragonChampionService(baseConfig, redis, { fetchFn });

    const champion = await service.getChampionByNumericId(23);

    expect(champion).toMatchObject({
      id: 'Tryndamere',
      key: '23',
      name: 'Tryndamere',
      title: 'the Barbarian King',
      iconUrl: expectedTryndamereIconUrl(),
    });
    expect(await service.getChampionByStringId('Tryndamere')).toEqual(champion);
    expect(await service.getCurrentVersion()).toBe(MOCK_DDRAGON_VERSION);
    expect(calls[0]?.url).toBe('https://ddragon.leagueoflegends.com/api/versions.json');
    expect(calls[1]?.url).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${MOCK_DDRAGON_VERSION}/data/en_US/champion.json`,
    );
  });

  it('builds profile icon URLs from numeric profileIconId and version', () => {
    const service = new DataDragonChampionService(baseConfig, createRedisMock());
    expect(service.buildProfileIconUrl(5912, MOCK_DDRAGON_VERSION)).toBe(
      `https://ddragon.leagueoflegends.com/cdn/${MOCK_DDRAGON_VERSION}/img/profileicon/5912.png`,
    );
    expect(service.buildProfileIconUrl(-1, MOCK_DDRAGON_VERSION)).toBeNull();
    expect(service.buildProfileIconUrl(1, '')).toBeNull();
  });

  it('returns null for unknown champion ids without throwing', async () => {
    const { fetchFn } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const service = new DataDragonChampionService(baseConfig, createRedisMock(), { fetchFn });

    await expect(service.getChampionByNumericId(999_999)).resolves.toBeNull();
    await expect(service.getChampionByStringId('NotAChampion')).resolves.toBeNull();
  });

  it('maps numeric keys to Data Dragon string ids and icon URLs (never numeric paths)', async () => {
    const { fetchFn } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const service = new DataDragonChampionService(baseConfig, createRedisMock(), { fetchFn });

    const cases: Array<{ id: number; key: string; name: string }> = [
      { id: 23, key: 'Tryndamere', name: 'Tryndamere' },
      { id: 61, key: 'Orianna', name: 'Orianna' },
      { id: 36, key: 'DrMundo', name: 'Dr. Mundo' },
      { id: 777, key: 'Yone', name: 'Yone' },
      { id: 104, key: 'Graves', name: 'Graves' },
      { id: 102, key: 'Shyvana', name: 'Shyvana' },
    ];

    for (const expected of cases) {
      const champion = await service.getChampionByNumericId(expected.id);
      expect(champion).toMatchObject({
        id: expected.key,
        key: String(expected.id),
        name: expected.name,
      });
      expect(champion?.iconUrl).toBe(
        `https://ddragon.leagueoflegends.com/cdn/${MOCK_DDRAGON_VERSION}/img/champion/${expected.key}.png`,
      );
      expect(champion?.iconUrl).not.toContain(`/img/champion/${expected.id}.png`);
    }

    const mundo = await service.getChampionByNumericId(36);
    expect(mundo?.iconUrl).toContain('/img/champion/DrMundo.png');
    expect(mundo?.iconUrl).not.toContain('Dr.%20Mundo');
    expect(mundo?.iconUrl).not.toContain('Dr. Mundo');
  });

  it('serves Redis cache hits without network', async () => {
    const cached = {
      version: MOCK_DDRAGON_VERSION,
      locale: 'en_US',
      champions: [
        {
          id: 'Tryndamere',
          key: '23',
          name: 'Tryndamere',
          title: 'the Barbarian King',
          iconUrl: expectedTryndamereIconUrl(),
        },
      ],
      fetchedAtMs: Date.now(),
    };
    const redis = createRedisMock({
      'ddragon:champions:v1:en_US': JSON.stringify(cached),
    });
    const { fetchFn, calls } = createMockFetch([]);
    const service = new DataDragonChampionService(baseConfig, redis, { fetchFn });

    const champion = await service.getChampionByNumericId(23);
    expect(champion?.name).toBe('Tryndamere');
    expect(calls).toHaveLength(0);
    expect(redis.get).toHaveBeenCalled();
  });

  it('serves in-memory cache hits without network or Redis', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const redis = createRedisMock();
    const service = new DataDragonChampionService(baseConfig, redis, { fetchFn });

    await service.getChampionByNumericId(23);
    redis.get.mockClear();
    const before = calls.length;

    const again = await service.getChampionByNumericId(157);
    expect(again?.name).toBe('Yasuo');
    expect(calls.length).toBe(before);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('refreshes after cache TTL expiry', async () => {
    let now = 1_000_000;
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const redis = createRedisMock();
    const service = new DataDragonChampionService({ ...baseConfig, cacheTtlSeconds: 60 }, redis, {
      fetchFn,
      nowFn: () => now,
    });

    await service.getChampionByNumericId(23);
    expect(calls).toHaveLength(2);

    now += 61_000;
    redis.store.clear();
    await service.getChampionByNumericId(23);
    expect(calls).toHaveLength(4);
  });

  it('rejects malformed champion data safely', async () => {
    const { fetchFn } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: { not: 'champions' } },
    ]);
    const service = new DataDragonChampionService(baseConfig, createRedisMock(), { fetchFn });

    await expect(service.getAllChampions()).resolves.toEqual([]);
    await expect(service.getChampionByNumericId(23)).resolves.toBeNull();
  });

  it('rejects malformed versions.json safely', async () => {
    const { fetchFn } = createMockFetch([{ status: 200, body: { versions: [] } }]);
    const service = new DataDragonChampionService(baseConfig, createRedisMock(), { fetchFn });

    await expect(service.getCurrentVersion()).resolves.toBeNull();
  });

  it('builds icon URLs centrally and does not attach Riot API keys', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const service = new DataDragonChampionService(baseConfig, createRedisMock(), { fetchFn });

    expect(service.buildChampionIconUrl('Tryndamere', MOCK_DDRAGON_VERSION)).toBe(
      expectedTryndamereIconUrl(),
    );

    await service.getAllChampions();

    for (const call of calls) {
      expect(call.url).toContain('ddragon.leagueoflegends.com');
      expect(call.url).not.toContain('riotgames.com/lol');
      const headers = new Headers(call.init?.headers);
      expect(headers.get('X-Riot-Token')).toBeNull();
      expect(headers.get('Authorization')).toBeNull();
      expect(JSON.stringify(call.init ?? {})).not.toContain('test-riot-key-should-never-be-sent');
    }
  });

  it('returns empty/null on network failure without throwing', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error('network down');
    };
    const service = new DataDragonChampionService(baseConfig, createRedisMock(), { fetchFn });

    await expect(service.getAllChampions()).resolves.toEqual([]);
    await expect(service.getChampionByNumericId(23)).resolves.toBeNull();
    await expect(service.getCurrentVersion()).resolves.toBeNull();
  });

  it('refreshCache clears stores and refetches', async () => {
    const { fetchFn, calls } = createMockFetch([
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
      { status: 200, body: MOCK_DDRAGON_VERSIONS },
      { status: 200, body: MOCK_DDRAGON_CHAMPION_JSON },
    ]);
    const redis = createRedisMock();
    const service = new DataDragonChampionService(baseConfig, redis, { fetchFn });

    await service.getChampionByNumericId(23);
    expect(calls).toHaveLength(2);

    const refreshed = await service.refreshCache();
    expect(refreshed.some((c) => c.id === 'Tryndamere')).toBe(true);
    expect(redis.del).toHaveBeenCalledWith('ddragon:champions:v1:en_US');
    expect(calls).toHaveLength(4);
  });
});
