import { describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '@prisma/client';
import type { PlayerAccount as ProviderAccount, RankedEntry } from '@league-helper/shared';
import { loadMatchBootstrapConfig } from './bootstrap-player.config';
import { bootstrapPlayer, bootstrapPlayers } from './bootstrap-player-core';
import type { EnqueueDiscoveredMatchesDeps } from './enqueue-discovered-matches';

const config = loadMatchBootstrapConfig({});

const providerAccount: ProviderAccount = {
  provider: 'RIOT',
  externalAccountId: 'puuid-secret',
  platform: 'na1',
  regionalRoute: 'americas',
  riotId: { gameName: 'PlayerOne', tagLine: 'NA1' },
};

function makeDbAccount(overrides: Partial<PlayerAccount> = {}): PlayerAccount {
  return {
    id: 'acct-1',
    playerId: 'player-1',
    provider: 'RIOT',
    externalAccountId: 'puuid-secret',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    gameName: 'PlayerOne',
    tagLine: 'NA1',
    summonerId: null,
    accountId: null,
    profileIconId: null,
    summonerLevel: null,
    lastResolvedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const rankedEntry: RankedEntry = {
  provider: 'RIOT',
  externalAccountId: 'puuid-secret',
  platform: 'na1',
  queueType: 'RANKED_SOLO_5x5',
  tier: 'GOLD',
  division: 'II',
  leaguePoints: 50,
  wins: 10,
  losses: 8,
};

function createDeps(overrides: {
  resolvePlayer?: ReturnType<typeof vi.fn>;
  getRankedEntries?: ReturnType<typeof vi.fn>;
  getRecentMatchIds?: ReturnType<typeof vi.fn>;
  upsertPlayerAccount?: ReturnType<typeof vi.fn>;
  insertRankIfChanged?: ReturnType<typeof vi.fn>;
  enqueueDiscoveredMatches?: ReturnType<typeof vi.fn>;
  afterSuccessfulUpsert?: ReturnType<typeof vi.fn>;
} = {}) {
  const resolvePlayer =
    overrides.resolvePlayer ??
    vi.fn(async () => providerAccount);
  const getRankedEntries =
    overrides.getRankedEntries ??
    vi.fn(async () => [rankedEntry]);
  const getRecentMatchIds =
    overrides.getRecentMatchIds ??
    vi.fn(async (_account, options: { queue?: number; start?: number; count?: number }) => {
      expect(options.queue).toBe(420);
      const start = options.start ?? 0;
      const count = options.count ?? 100;
      return Array.from({ length: Math.min(count, 3) }, (_, i) => `m-${start + i}`);
    });
  const upsertPlayerAccount =
    overrides.upsertPlayerAccount ??
    vi.fn(async () => makeDbAccount());
  const insertRankIfChanged =
    overrides.insertRankIfChanged ??
    vi.fn(async () => null);
  const enqueueDiscoveredMatches =
    overrides.enqueueDiscoveredMatches ??
    vi.fn(async () => ({
      warnings: [],
      enqueuedCount: 3,
      skippedAlreadyCompleteCount: 0,
    }));

  const enqueueDeps = {
    matches: {} as EnqueueDiscoveredMatchesDeps['matches'],
    ingestionJobs: {} as EnqueueDiscoveredMatchesDeps['ingestionJobs'],
    producer: {
      enqueueMatch: vi.fn(),
      getJobStates: vi.fn(),
    } as EnqueueDiscoveredMatchesDeps['producer'],
    matchIngestionJobAttempts: 5,
    logger: { log: vi.fn() },
    invalidatePlayerCache: vi.fn(async () => undefined),
  };

  return {
    deps: {
      resolvePlayer,
      getRankedEntries,
      getRecentMatchIds,
      upsertPlayerAccount,
      insertRankIfChanged,
      enqueueDiscoveredMatches,
      enqueueDeps,
      config,
      logger: { log: vi.fn(), warn: vi.fn() },
      ...(overrides.afterSuccessfulUpsert
        ? { afterSuccessfulUpsert: overrides.afterSuccessfulUpsert }
        : {}),
    },
    spies: {
      resolvePlayer,
      getRankedEntries,
      getRecentMatchIds,
      upsertPlayerAccount,
      insertRankIfChanged,
      enqueueDiscoveredMatches,
      producerEnqueue: enqueueDeps.producer.enqueueMatch as ReturnType<typeof vi.fn>,
      afterSuccessfulUpsert: overrides.afterSuccessfulUpsert,
    },
  };
}

describe('bootstrapPlayer (single)', () => {
  it('dry-run discovers matches without DB writes or enqueue', async () => {
    const { deps, spies } = createDeps();

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: true,
      correlationId: 'corr-dry',
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.discoveredMatchCount).toBe(3);
    expect(result.wouldEnqueueCount).toBe(3);
    expect(result.enqueuedCount).toBe(0);
    expect(result.externalMatchIds).toEqual(['m-0', 'm-1', 'm-2']);
    expect(result.externalMatchIds.join(' ')).not.toMatch(/puuid/i);

    expect(spies.resolvePlayer).toHaveBeenCalled();
    expect(spies.getRecentMatchIds).toHaveBeenCalled();
    expect(spies.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(spies.insertRankIfChanged).not.toHaveBeenCalled();
    expect(spies.enqueueDiscoveredMatches).not.toHaveBeenCalled();
    expect(spies.producerEnqueue).not.toHaveBeenCalled();
  });

  it('apply resolves account, syncs ranks, paginates, and enqueues', async () => {
    const { deps, spies } = createDeps();

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-apply',
    });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.discoveredMatchCount).toBe(3);
    expect(result.enqueuedCount).toBe(3);
    expect(spies.upsertPlayerAccount).toHaveBeenCalledTimes(1);
    expect(spies.insertRankIfChanged).toHaveBeenCalledTimes(1);
    expect(spies.enqueueDiscoveredMatches).toHaveBeenCalledTimes(1);
    expect(spies.enqueueDiscoveredMatches.mock.calls[0]?.[1]).toMatchObject({
      discoveredMatchIds: ['m-0', 'm-1', 'm-2'],
      correlationId: 'corr-apply',
    });
  });

  it('second apply with all completed skips enqueue', async () => {
    const enqueueDiscoveredMatches = vi
      .fn()
      .mockResolvedValueOnce({
        warnings: [],
        enqueuedCount: 2,
        skippedAlreadyCompleteCount: 0,
      })
      .mockResolvedValueOnce({
        warnings: [],
        enqueuedCount: 0,
        skippedAlreadyCompleteCount: 2,
      });
    const getRecentMatchIds = vi.fn(async () => ['m-a', 'm-b']);
    const { deps } = createDeps({ enqueueDiscoveredMatches, getRecentMatchIds });

    const first = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 50,
      dryRun: false,
      correlationId: 'c1',
    });
    const second = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 50,
      dryRun: false,
      correlationId: 'c2',
    });

    expect(first.enqueuedCount).toBe(2);
    expect(second.enqueuedCount).toBe(0);
    expect(second.skippedAlreadyCompleteCount).toBe(2);
  });

  it('passes queueId and maxMatches into paginated discovery', async () => {
    const getRecentMatchIds = vi.fn(async (_account, options) => {
      expect(options.queue).toBe(440);
      expect(options.start).toBe(0);
      expect(options.count).toBe(25);
      return ['only'];
    });
    const { deps } = createDeps({ getRecentMatchIds });

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 440,
      maxMatches: 25,
      dryRun: true,
      correlationId: 'corr-q',
    });

    expect(result.discoveredMatchCount).toBe(1);
    expect(getRecentMatchIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ queue: 440, start: 0, count: 25 }),
    );
  });

  it('marks player failed when resolve throws', async () => {
    const { deps } = createDeps({
      resolvePlayer: vi.fn(async () => {
        throw new Error('not found');
      }),
    });

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'Missing', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 10,
      dryRun: true,
      correlationId: 'corr-fail',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.discoveredMatchCount).toBe(0);
  });

  it('dry-run never calls afterSuccessfulUpsert enrollment hook', async () => {
    const afterSuccessfulUpsert = vi.fn(async () => undefined);
    const { deps } = createDeps({ afterSuccessfulUpsert });

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: true,
      correlationId: 'corr-dry-enroll',
    });

    expect(result.ok).toBe(true);
    expect(afterSuccessfulUpsert).not.toHaveBeenCalled();
  });

  it('apply calls afterSuccessfulUpsert with account fields', async () => {
    const afterSuccessfulUpsert = vi.fn(async () => undefined);
    const { deps } = createDeps({ afterSuccessfulUpsert });

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-enroll',
    });

    expect(result.ok).toBe(true);
    expect(afterSuccessfulUpsert).toHaveBeenCalledWith({
      id: 'acct-1',
      provider: 'RIOT',
      platformRoute: 'na1',
    });
  });

  it('afterSuccessfulUpsert throw does not fail bootstrap', async () => {
    const afterSuccessfulUpsert = vi.fn(async () => {
      throw new Error('enrollment exploded');
    });
    const { deps } = createDeps({ afterSuccessfulUpsert });

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-enroll-fail',
    });

    expect(result.ok).toBe(true);
    expect(result.enqueuedCount).toBe(3);
    expect(afterSuccessfulUpsert).toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Bootstrap afterSuccessfulUpsert failed',
        playerAccountId: 'acct-1',
        error: 'enrollment exploded',
      }),
    );
  });

  it('omitted afterSuccessfulUpsert still bootstraps (flag-off / low-level path)', async () => {
    const { deps, spies } = createDeps();

    const result = await bootstrapPlayer(deps, {
      target: { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-no-hook',
    });

    expect(result.ok).toBe(true);
    expect(spies.afterSuccessfulUpsert).toBeUndefined();
  });
});

describe('bootstrapPlayers (file mode)', () => {
  it('processes multiple players successfully (sequential default)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvePlayer = vi.fn(async (input: { gameName: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return {
        ...providerAccount,
        riotId: { gameName: input.gameName, tagLine: 'NA1' },
        externalAccountId: `puuid-${input.gameName}`,
      };
    });
    const { deps } = createDeps({ resolvePlayer });

    const result = await bootstrapPlayers(deps, {
      players: [
        { gameName: 'A', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'B', tagLine: 'NA1', platform: 'na1' },
      ],
      queueId: 420,
      maxMatches: 10,
      dryRun: true,
      concurrency: 1,
      correlationId: 'multi',
    });

    expect(result.ok).toBe(true);
    expect(result.players).toHaveLength(2);
    expect(result.players.every((p) => p.ok)).toBe(true);
    expect(result.totals.players).toBe(2);
    expect(result.totals.playersFailed).toBe(0);
    expect(maxInFlight).toBe(1);
  });

  it('continues after one player failure and sets rollup ok=false', async () => {
    const resolvePlayer = vi.fn(async (input: { gameName: string }) => {
      if (input.gameName === 'Bad') {
        throw new Error('resolve failed');
      }
      return {
        ...providerAccount,
        riotId: { gameName: input.gameName, tagLine: 'NA1' },
        externalAccountId: `puuid-${input.gameName}`,
      };
    });
    const { deps } = createDeps({ resolvePlayer });

    const result = await bootstrapPlayers(deps, {
      players: [
        { gameName: 'Good', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'Bad', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'AlsoGood', tagLine: 'NA1', platform: 'na1' },
      ],
      queueId: 420,
      maxMatches: 5,
      dryRun: true,
      concurrency: 1,
      correlationId: 'partial',
    });

    expect(result.ok).toBe(false);
    expect(result.players.map((p) => p.ok)).toEqual([true, false, true]);
    expect(result.totals.playersFailed).toBe(1);
    expect(result.players[1]?.error).toMatch(/resolve failed/i);
  });

  it('respects concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvePlayer = vi.fn(async (input: { gameName: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      return {
        ...providerAccount,
        riotId: { gameName: input.gameName, tagLine: 'NA1' },
        externalAccountId: `puuid-${input.gameName}`,
      };
    });
    const { deps } = createDeps({ resolvePlayer });

    const result = await bootstrapPlayers(deps, {
      players: [
        { gameName: 'P1', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'P2', tagLine: 'NA1', platform: 'na1' },
        { gameName: 'P3', tagLine: 'NA1', platform: 'na1' },
      ],
      queueId: 420,
      maxMatches: 5,
      dryRun: true,
      concurrency: 2,
      correlationId: 'conc',
    });

    expect(result.ok).toBe(true);
    expect(maxInFlight).toBe(2);
    expect(maxInFlight).toBeLessThanOrEqual(config.maxConcurrency);
  });

  it('rejects oversized player lists before Riot calls', async () => {
    const { deps, spies } = createDeps();
    const players = Array.from({ length: config.fileMaxPlayers + 1 }, (_, i) => ({
      gameName: `P${i}`,
      tagLine: 'NA1',
      platform: 'na1' as const,
    }));

    await expect(
      bootstrapPlayers(deps, {
        players,
        queueId: 420,
        maxMatches: 5,
        dryRun: true,
        concurrency: 1,
        correlationId: 'oversized',
      }),
    ).rejects.toThrow(/fileMaxPlayers|too many|max players/i);

    expect(spies.resolvePlayer).not.toHaveBeenCalled();
  });
});
