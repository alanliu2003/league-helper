import { describe, expect, it, vi } from 'vitest';
import type { ChampionStaticSyncConfig } from './sync-champion-static.config';
import {
  classifyChampionDiff,
  findDuplicateChampionIdentities,
  syncChampionStatic,
  type ChampionStaticSyncPrisma,
} from './sync-champion-static-core';
import type { MappedChampionStaticRow } from './sync-champion-static.types';

type StoredChampion = {
  championId: number;
  championKey: string;
  name: string;
  title: string;
  tags: string[];
  baseStats: Record<string, unknown>;
  imageData: Record<string, unknown>;
  passive: Record<string, unknown>;
  spells: unknown[];
  rawPayload: null;
};

type StoredPatch = {
  id: string;
  version: string;
  normalizedMajorMinor: string;
  dataDragonVersion: string | null;
  isActive: boolean;
  staticDataStatus: 'PENDING' | 'READY' | 'FAILED' | 'STALE';
  champions: Map<number, StoredChampion>;
};

function makeConfig(overrides: Partial<ChampionStaticSyncConfig> = {}): ChampionStaticSyncConfig {
  return {
    locale: 'en_US',
    requestTimeoutMs: 1_000,
    baseUrl: 'https://ddragon.leagueoflegends.com',
    version: '16.10.1',
    minChampions: 2,
    maxRetries: 2,
    maxRetryDelayMs: 5_000,
    ...overrides,
  };
}

function championPayload(
  entries: Array<{
    id: string;
    key: string;
    name: string;
    title: string;
    tags?: string[];
    image?: Record<string, unknown>;
    stats?: Record<string, unknown>;
  }>,
  version = '16.10.1',
) {
  const data: Record<string, unknown> = {};
  for (const entry of entries) {
    data[entry.id] = {
      id: entry.id,
      key: entry.key,
      name: entry.name,
      title: entry.title,
      tags: entry.tags ?? [],
      image: entry.image ?? {},
      stats: entry.stats ?? {},
    };
  }
  return { version, data };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFakePrisma(seed?: {
  patches?: StoredPatch[];
  failOnChampionUpsert?: boolean;
}): {
  prisma: ChampionStaticSyncPrisma;
  state: { patches: Map<string, StoredPatch>; deleteCalls: number };
} {
  const patches = new Map<string, StoredPatch>();
  for (const patch of seed?.patches ?? []) {
    patches.set(patch.version, structuredClone(patch));
  }
  const state = { patches, deleteCalls: 0 };

  const createClient = (working: Map<string, StoredPatch>): ChampionStaticSyncPrisma => {
    const byId = () => new Map([...working.values()].map((p) => [p.id, p]));

    return {
      patch: {
        findUnique: async ({ where }) => {
          const patch = working.get(where.version);
          return patch
            ? { id: patch.id, version: patch.version, isActive: patch.isActive }
            : null;
        },
        findFirst: async ({ where }) => {
          const patch = [...working.values()].find((p) => p.isActive === where.isActive);
          return patch ? { id: patch.id, version: patch.version } : null;
        },
        upsert: async ({ where, create, update }) => {
          const existing = working.get(where.version);
          if (!existing) {
            const created: StoredPatch = {
              id: `patch-${create.version}`,
              version: create.version,
              normalizedMajorMinor: create.normalizedMajorMinor,
              dataDragonVersion: create.dataDragonVersion,
              isActive: create.isActive,
              staticDataStatus: create.staticDataStatus,
              champions: new Map(),
            };
            working.set(created.version, created);
            return { ...created };
          }
          existing.normalizedMajorMinor = update.normalizedMajorMinor;
          existing.dataDragonVersion = update.dataDragonVersion;
          return { ...existing };
        },
        update: async ({ where, data }) => {
          const patch = byId().get(where.id);
          if (!patch) {
            throw new Error(`Patch ${where.id} not found`);
          }
          if (data.isActive !== undefined) {
            patch.isActive = data.isActive;
          }
          if (data.staticDataStatus !== undefined) {
            patch.staticDataStatus = data.staticDataStatus;
          }
          return { ...patch };
        },
        updateMany: async ({ where, data }) => {
          let count = 0;
          for (const patch of working.values()) {
            if (where.isActive !== undefined && patch.isActive !== where.isActive) {
              continue;
            }
            if (where.id?.not && patch.id === where.id.not) {
              continue;
            }
            patch.isActive = data.isActive;
            count += 1;
          }
          return { count };
        },
      },
      championStaticData: {
        findMany: async ({ where }) => {
          const patch = byId().get(where.patchId);
          if (!patch) {
            return [];
          }
          return [...patch.champions.values()].map((c) => ({
            championId: c.championId,
            championKey: c.championKey,
            name: c.name,
            title: c.title,
            tags: [...c.tags],
            baseStats: c.baseStats,
            imageData: c.imageData,
          }));
        },
        upsert: async ({ where, create, update }) => {
          if (seed?.failOnChampionUpsert) {
            throw new Error('simulated upsert failure');
          }
          const patch = byId().get(where.patchId_championId.patchId);
          if (!patch) {
            throw new Error('patch missing for champion upsert');
          }
          const existing = patch.champions.get(where.patchId_championId.championId);
          if (!existing) {
            const row: StoredChampion = {
              championId: create.championId,
              championKey: create.championKey,
              name: create.name,
              title: create.title,
              tags: [...create.tags],
              baseStats: create.baseStats as Record<string, unknown>,
              imageData: create.imageData as Record<string, unknown>,
              passive: create.passive as Record<string, unknown>,
              spells: create.spells as unknown[],
              rawPayload: null,
            };
            patch.champions.set(row.championId, row);
            return row;
          }
          existing.championKey = update.championKey;
          existing.name = update.name;
          existing.title = update.title;
          existing.tags = [...update.tags];
          existing.baseStats = update.baseStats as Record<string, unknown>;
          existing.imageData = update.imageData as Record<string, unknown>;
          existing.passive = update.passive as Record<string, unknown>;
          existing.spells = update.spells as unknown[];
          existing.rawPayload = null;
          return existing;
        },
        delete: async () => {
          state.deleteCalls += 1;
          throw new Error('delete should not be called');
        },
        deleteMany: async () => {
          state.deleteCalls += 1;
          throw new Error('deleteMany should not be called');
        },
      },
      $transaction: async (fn, _options?) => {
        // Simulate transactional rollback: mutate a clone, commit only on success.
        const draft = new Map<string, StoredPatch>();
        for (const [version, patch] of working) {
          draft.set(version, {
            ...patch,
            champions: new Map(
              [...patch.champions.entries()].map(([id, c]) => [id, { ...c, tags: [...c.tags] }]),
            ),
          });
        }
        const tx = createClient(draft);
        const result = await fn(tx);
        working.clear();
        for (const [version, patch] of draft) {
          working.set(version, patch);
        }
        return result;
      },
    };
  };

  return { prisma: createClient(patches), state };
}

const AHRI = {
  id: 'Ahri',
  key: '103',
  name: 'Ahri',
  title: 'the Nine-Tailed Fox',
  tags: ['Mage', 'Assassin'],
};
const MUNDO = {
  id: 'DrMundo',
  key: '36',
  name: 'Dr. Mundo',
  title: 'the Madman of Zaun',
  tags: ['Fighter', 'Tank'],
};

describe('findDuplicateChampionIdentities', () => {
  it('detects duplicate championId', () => {
    const mapped: MappedChampionStaticRow[] = [
      {
        championId: 103,
        championKey: 'Ahri',
        name: 'Ahri',
        title: 't',
        tags: [],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
      {
        championId: 103,
        championKey: 'FakeAhri',
        name: 'Fake',
        title: 't',
        tags: [],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
    ];
    expect(findDuplicateChampionIdentities(mapped)).toMatch(/Duplicate championId 103/);
  });

  it('detects duplicate championKey', () => {
    const mapped: MappedChampionStaticRow[] = [
      {
        championId: 103,
        championKey: 'Ahri',
        name: 'Ahri',
        title: 't',
        tags: [],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
      {
        championId: 999,
        championKey: 'Ahri',
        name: 'Ahri Clone',
        title: 't',
        tags: [],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
    ];
    expect(findDuplicateChampionIdentities(mapped)).toMatch(/Duplicate championKey Ahri/);
  });
});

describe('classifyChampionDiff', () => {
  it('classifies new, changed, and unchanged rows', () => {
    const mapped: MappedChampionStaticRow[] = [
      {
        championId: 103,
        championKey: 'Ahri',
        name: 'Ahri',
        title: 'new title',
        tags: ['Mage'],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
      {
        championId: 36,
        championKey: 'DrMundo',
        name: 'Dr. Mundo',
        title: 'the Madman of Zaun',
        tags: ['Fighter', 'Tank'],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
      {
        championId: 157,
        championKey: 'Yasuo',
        name: 'Yasuo',
        title: 'the Unforgiven',
        tags: ['Fighter'],
        baseStats: {},
        passive: {},
        spells: [],
        imageData: {},
      },
    ];
    const existing = [
      {
        championId: 103,
        championKey: 'Ahri',
        name: 'Ahri',
        title: 'old title',
        tags: ['Mage'],
        baseStats: {},
        imageData: {},
      },
      {
        championId: 36,
        championKey: 'DrMundo',
        name: 'Dr. Mundo',
        title: 'the Madman of Zaun',
        tags: ['Tank', 'Fighter'],
        baseStats: {},
        imageData: {},
      },
    ];
    expect(classifyChampionDiff(mapped, existing)).toEqual({
      newCount: 1,
      changedCount: 1,
      unchangedCount: 1,
    });
  });
});

describe('syncChampionStatic', () => {
  it('rejects duplicate championId before any writes', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'seed',
          version: '14.1.1',
          normalizedMajorMinor: '14.1',
          dataDragonVersion: '14.1.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map(),
        },
      ],
    });
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        championPayload([
          AHRI,
          { id: 'FakeAhri', key: '103', name: 'Fake Ahri', title: 'dup id' },
        ]),
      ),
    );

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Duplicate championId 103/);
    expect(result.discovered).toBe(2);
    expect(state.patches.get('14.1.1')?.isActive).toBe(true);
    expect(state.patches.has('16.10.1')).toBe(false);
  });

  it('rejects duplicate championKey before any writes', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'seed',
          version: '14.1.1',
          normalizedMajorMinor: '14.1',
          dataDragonVersion: '14.1.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map(),
        },
      ],
    });
    // Record keys must differ so both entries survive Object.values; entry.id maps to championKey.
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
          AhriAlias: {
            id: 'Ahri',
            key: '999',
            name: 'Ahri Clone',
            title: 'dup key',
            tags: [],
          },
        },
      }),
    );

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Duplicate championKey Ahri/);
    expect(result.discovered).toBe(2);
    expect(state.patches.get('14.1.1')?.isActive).toBe(true);
    expect(state.patches.has('16.10.1')).toBe(false);
  });

  it('rejects below-minimum champion count before any writes', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'seed',
          version: '14.1.1',
          normalizedMajorMinor: '14.1',
          dataDragonVersion: '14.1.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map(),
        },
      ],
    });
    const fetchFn = vi.fn(async () => jsonResponse(championPayload([AHRI])));

    const result = await syncChampionStatic({
      config: makeConfig({ minChampions: 100 }),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/below minimum/i);
    expect(state.patches.get('14.1.1')?.isActive).toBe(true);
    expect(state.patches.has('16.10.1')).toBe(false);
  });

  it('dry-run classifies diffs and performs no writes', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'p-16',
          version: '16.10.1',
          normalizedMajorMinor: '16.10',
          dataDragonVersion: '16.10.1',
          isActive: false,
          staticDataStatus: 'READY',
          champions: new Map([
            [
              103,
              {
                championId: 103,
                championKey: 'Ahri',
                name: 'Ahri',
                title: 'old title',
                tags: ['Mage'],
                baseStats: {},
                imageData: {},
                passive: {},
                spells: [],
                rawPayload: null,
              },
            ],
          ]),
        },
      ],
    });
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        championPayload([
          { ...AHRI, title: 'the Nine-Tailed Fox' },
          MUNDO,
        ]),
      ),
    );

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: true,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.newCount).toBe(1);
    expect(result.changedCount).toBe(1);
    expect(result.unchangedCount).toBe(0);
    expect(result.upsertedCount).toBe(0);
    expect(state.patches.get('p-16') ?? state.patches.get('16.10.1')?.isActive).toBeFalsy();
    expect(state.patches.get('16.10.1')?.champions.size).toBe(1);
  });

  it('inserts new champions, stores version fields, activates READY, demotes previous', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'seed',
          version: '14.1.1',
          normalizedMajorMinor: '14.1',
          dataDragonVersion: '14.1.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map(),
        },
      ],
    });
    const fetchFn = vi.fn(async () => jsonResponse(championPayload([AHRI, MUNDO])));

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(true);
    expect(result.upsertedCount).toBe(2);
    expect(result.activePatchId).toBe('patch-16.10.1');
    expect(result.activePatchVersion).toBe('16.10.1');
    expect(result.championRowCount).toBe(2);
    expect(result.distinctChampionKeyCount).toBe(2);

    const synced = state.patches.get('16.10.1');
    expect(synced).toBeDefined();
    expect(synced?.isActive).toBe(true);
    expect(synced?.staticDataStatus).toBe('READY');
    expect(synced?.dataDragonVersion).toBe('16.10.1');
    expect(synced?.normalizedMajorMinor).toBe('16.10');
    expect(synced?.champions.get(103)?.championKey).toBe('Ahri');
    expect(state.patches.get('14.1.1')?.isActive).toBe(false);
  });

  it('updates existing champions when metadata changes', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'p-16',
          version: '16.10.1',
          normalizedMajorMinor: '16.10',
          dataDragonVersion: '16.10.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map([
            [
              103,
              {
                championId: 103,
                championKey: 'Ahri',
                name: 'Ahri',
                title: 'old title',
                tags: ['Mage'],
                baseStats: {},
                imageData: {},
                passive: {},
                spells: [],
                rawPayload: null,
              },
            ],
            [
              36,
              {
                championId: 36,
                championKey: 'DrMundo',
                name: 'Dr. Mundo',
                title: 'the Madman of Zaun',
                tags: ['Fighter', 'Tank'],
                baseStats: {},
                imageData: {},
                passive: {},
                spells: [],
                rawPayload: null,
              },
            ],
          ]),
        },
      ],
    });
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        championPayload([
          { ...AHRI, title: 'the Nine-Tailed Fox', tags: ['Mage', 'Assassin'] },
          MUNDO,
        ]),
      ),
    );

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(true);
    expect(result.changedCount).toBe(1);
    expect(result.unchangedCount).toBe(1);
    expect(state.patches.get('16.10.1')?.champions.get(103)?.title).toBe('the Nine-Tailed Fox');
    expect(state.patches.get('16.10.1')?.champions.get(103)?.tags).toEqual(['Mage', 'Assassin']);
  });

  it('invalid payload results in no writes', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'seed',
          version: '14.1.1',
          normalizedMajorMinor: '14.1',
          dataDragonVersion: '14.1.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map(),
        },
      ],
    });
    const fetchFn = vi.fn(async () => jsonResponse({ version: '16.10.1', data: {} }));

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(false);
    expect(state.patches.get('14.1.1')?.isActive).toBe(true);
    expect(state.patches.has('16.10.1')).toBe(false);
  });

  it('transaction failure leaves prior active patch unchanged', async () => {
    const { prisma, state } = createFakePrisma({
      failOnChampionUpsert: true,
      patches: [
        {
          id: 'seed',
          version: '14.1.1',
          normalizedMajorMinor: '14.1',
          dataDragonVersion: '14.1.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map(),
        },
      ],
    });
    const fetchFn = vi.fn(async () => jsonResponse(championPayload([AHRI, MUNDO])));

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/simulated upsert failure/i);
    expect(result.discovered).toBe(2);
    expect(state.patches.get('14.1.1')?.isActive).toBe(true);
    // Rolled back — either absent or inactive without champions committed
    const maybeSynced = state.patches.get('16.10.1');
    expect(maybeSynced === undefined || maybeSynced.isActive === false).toBe(true);
    expect(maybeSynced?.champions.size ?? 0).toBe(0);
  });

  it('does not delete champions omitted from the remote payload', async () => {
    const { prisma, state } = createFakePrisma({
      patches: [
        {
          id: 'p-16',
          version: '16.10.1',
          normalizedMajorMinor: '16.10',
          dataDragonVersion: '16.10.1',
          isActive: true,
          staticDataStatus: 'READY',
          champions: new Map([
            [
              103,
              {
                championId: 103,
                championKey: 'Ahri',
                name: 'Ahri',
                title: 'the Nine-Tailed Fox',
                tags: ['Mage'],
                baseStats: {},
                imageData: {},
                passive: {},
                spells: [],
                rawPayload: null,
              },
            ],
            [
              36,
              {
                championId: 36,
                championKey: 'DrMundo',
                name: 'Dr. Mundo',
                title: 'the Madman of Zaun',
                tags: ['Fighter'],
                baseStats: {},
                imageData: {},
                passive: {},
                spells: [],
                rawPayload: null,
              },
            ],
            [
              157,
              {
                championId: 157,
                championKey: 'Yasuo',
                name: 'Yasuo',
                title: 'the Unforgiven',
                tags: ['Fighter'],
                baseStats: {},
                imageData: {},
                passive: {},
                spells: [],
                rawPayload: null,
              },
            ],
          ]),
        },
      ],
    });
    // Remote omits Yasuo
    const fetchFn = vi.fn(async () => jsonResponse(championPayload([AHRI, MUNDO])));

    const result = await syncChampionStatic({
      config: makeConfig({ minChampions: 2 }),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(true);
    expect(state.deleteCalls).toBe(0);
    expect(state.patches.get('16.10.1')?.champions.has(157)).toBe(true);
    expect(result.championRowCount).toBe(3);
    expect(result.distinctChampionKeyCount).toBe(3);
  });

  it('includes post-sync verification counts in the result', async () => {
    const { prisma } = createFakePrisma();
    const fetchFn = vi.fn(async () => jsonResponse(championPayload([AHRI, MUNDO])));

    const result = await syncChampionStatic({
      config: makeConfig(),
      prisma,
      dryRun: false,
      fetchDeps: { fetchFn: fetchFn as unknown as typeof fetch, sleepFn: async () => undefined },
    });

    expect(result.ok).toBe(true);
    expect(result.championRowCount).toBe(2);
    expect(result.distinctChampionKeyCount).toBe(2);
  });
});
