import { describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '@prisma/client';
import {
  ProviderRateLimitedError,
  type PlayerAccount as ProviderAccount,
  type RankedEntry,
} from '@league-helper/shared';
import { loadMatchBootstrapConfig } from '../bootstrap/bootstrap-player.config';
import type { EnqueueDiscoveredMatchesDeps } from '../bootstrap/enqueue-discovered-matches';
import {
  PlayerMatchDiscoveryService,
  type PlayerMatchDiscoveryRuntimeDeps,
} from './player-match-discovery.service';

const config = loadMatchBootstrapConfig({});

const providerAccount: ProviderAccount = {
  provider: 'RIOT',
  externalAccountId: 'puuid-secret',
  platform: 'na1',
  regionalRoute: 'americas',
  riotId: { gameName: 'PlayerOne', tagLine: 'NA1' },
};

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';

function makeDbAccount(overrides: Partial<PlayerAccount> = {}): PlayerAccount {
  return {
    id: ACCOUNT_ID,
    playerId: 'player-1',
    provider: 'RIOT',
    externalAccountId: 'puuid-secret',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    currentGameName: 'PlayerOne',
    currentTagLine: 'NA1',
    normalizedGameName: 'playerone',
    normalizedTagLine: 'na1',
    summonerId: 'summoner-1',
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

function createRuntimeDeps(overrides: {
  resolvePlayer?: ReturnType<typeof vi.fn>;
  getRankedEntries?: ReturnType<typeof vi.fn>;
  getRecentMatchIds?: ReturnType<typeof vi.fn>;
  upsertPlayerAccount?: ReturnType<typeof vi.fn>;
  findPlayerAccountById?: ReturnType<typeof vi.fn>;
  insertRankIfChanged?: ReturnType<typeof vi.fn>;
  enqueueDiscoveredMatches?: ReturnType<typeof vi.fn>;
} = {}): {
  deps: PlayerMatchDiscoveryRuntimeDeps;
  spies: {
    resolvePlayer: ReturnType<typeof vi.fn>;
    getRankedEntries: ReturnType<typeof vi.fn>;
    getRecentMatchIds: ReturnType<typeof vi.fn>;
    upsertPlayerAccount: ReturnType<typeof vi.fn>;
    findPlayerAccountById: ReturnType<typeof vi.fn>;
    insertRankIfChanged: ReturnType<typeof vi.fn>;
    enqueueDiscoveredMatches: ReturnType<typeof vi.fn>;
  };
} {
  const resolvePlayer = overrides.resolvePlayer ?? vi.fn(async () => providerAccount);
  const getRankedEntries = overrides.getRankedEntries ?? vi.fn(async () => [rankedEntry]);
  const getRecentMatchIds =
    overrides.getRecentMatchIds ??
    vi.fn(async (_account, options: { queue?: number; start?: number; count?: number }) => {
      expect(options.queue).toBe(420);
      const start = options.start ?? 0;
      const count = options.count ?? 100;
      return Array.from({ length: Math.min(count, 3) }, (_, i) => `m-${start + i}`);
    });
  const upsertPlayerAccount =
    overrides.upsertPlayerAccount ?? vi.fn(async () => makeDbAccount());
  const findPlayerAccountById =
    overrides.findPlayerAccountById ?? vi.fn(async () => makeDbAccount());
  const insertRankIfChanged = overrides.insertRankIfChanged ?? vi.fn(async () => null);
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
      findPlayerAccountById,
      insertRankIfChanged,
      enqueueDiscoveredMatches,
      enqueueDeps,
      pageSize: config.pageSize,
      logger: { log: vi.fn(), warn: vi.fn() },
    },
    spies: {
      resolvePlayer,
      getRankedEntries,
      getRecentMatchIds,
      upsertPlayerAccount,
      findPlayerAccountById,
      insertRankIfChanged,
      enqueueDiscoveredMatches,
    },
  };
}

function createService(overrides: Parameters<typeof createRuntimeDeps>[0] = {}) {
  const { deps, spies } = createRuntimeDeps(overrides);
  const service = PlayerMatchDiscoveryService.fromRuntimeDeps(deps);
  return { service, spies, deps };
}

describe('PlayerMatchDiscoveryService', () => {
  it('Riot-ID mode resolves, upserts, soft-fails ranks, paginates, enqueues', async () => {
    const getRankedEntries = vi.fn(async () => {
      throw new Error('rank endpoint down');
    });
    const { service, spies } = createService({ getRankedEntries });

    const result = await service.discoverAndEnqueue({
      mode: 'RIOT_ID',
      gameName: 'PlayerOne',
      tagLine: 'NA1',
      platform: 'na1',
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-riot',
    });

    expect(result.ok).toBe(true);
    expect(result.playerAccountId).toBe(ACCOUNT_ID);
    expect(result.discoveredMatchCount).toBe(3);
    expect(result.enqueuedCount).toBe(3);
    expect(result.externalMatchIds).toEqual(['m-0', 'm-1', 'm-2']);
    expect(result.warnings.some((w) => w.code === 'RANK_SYNC_FAILED')).toBe(true);

    expect(spies.resolvePlayer).toHaveBeenCalledTimes(1);
    expect(spies.upsertPlayerAccount).toHaveBeenCalledTimes(1);
    expect(spies.getRankedEntries).toHaveBeenCalledTimes(1);
    expect(spies.insertRankIfChanged).not.toHaveBeenCalled();
    expect(spies.getRecentMatchIds).toHaveBeenCalled();
    expect(spies.enqueueDiscoveredMatches).toHaveBeenCalledTimes(1);
    expect(spies.enqueueDiscoveredMatches.mock.calls[0]?.[1]).toMatchObject({
      discoveredMatchIds: ['m-0', 'm-1', 'm-2'],
      correlationId: 'corr-riot',
    });
  });

  it('PLAYER_ACCOUNT mode loads account and does not call resolvePlayer', async () => {
    const { service, spies } = createService();

    const result = await service.discoverAndEnqueue({
      mode: 'PLAYER_ACCOUNT',
      playerAccountId: ACCOUNT_ID,
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-acct',
    });

    expect(result.ok).toBe(true);
    expect(result.playerAccountId).toBe(ACCOUNT_ID);
    expect(result.enqueuedCount).toBe(3);
    expect(spies.resolvePlayer).not.toHaveBeenCalled();
    expect(spies.findPlayerAccountById).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(spies.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(spies.getRankedEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        externalAccountId: 'puuid-secret',
        platform: 'na1',
        regionalRoute: 'americas',
        riotId: { gameName: 'PlayerOne', tagLine: 'NA1' },
      }),
    );
    expect(spies.enqueueDiscoveredMatches).toHaveBeenCalledTimes(1);
  });

  it('dryRun=true discovers without enqueue/upsert mutations', async () => {
    const { service: riotService, spies: riotSpies } = createService();
    const riotDry = await riotService.discoverAndEnqueue({
      mode: 'RIOT_ID',
      gameName: 'PlayerOne',
      tagLine: 'NA1',
      platform: 'na1',
      queueId: 420,
      maxMatches: 100,
      dryRun: true,
      correlationId: 'corr-dry-riot',
    });

    expect(riotDry.ok).toBe(true);
    expect(riotDry.discoveredMatchCount).toBe(3);
    expect(riotDry.enqueuedCount).toBe(0);
    expect(riotSpies.resolvePlayer).toHaveBeenCalled();
    expect(riotSpies.getRecentMatchIds).toHaveBeenCalled();
    expect(riotSpies.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(riotSpies.insertRankIfChanged).not.toHaveBeenCalled();
    expect(riotSpies.enqueueDiscoveredMatches).not.toHaveBeenCalled();

    const { service: accountService, spies: accountSpies } = createService();
    const accountDry = await accountService.discoverAndEnqueue({
      mode: 'PLAYER_ACCOUNT',
      playerAccountId: ACCOUNT_ID,
      queueId: 420,
      maxMatches: 100,
      dryRun: true,
      correlationId: 'corr-dry-acct',
    });

    expect(accountDry.ok).toBe(true);
    expect(accountDry.discoveredMatchCount).toBe(3);
    expect(accountDry.enqueuedCount).toBe(0);
    expect(accountSpies.resolvePlayer).not.toHaveBeenCalled();
    expect(accountSpies.findPlayerAccountById).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(accountSpies.getRecentMatchIds).toHaveBeenCalled();
    expect(accountSpies.upsertPlayerAccount).not.toHaveBeenCalled();
    expect(accountSpies.getRankedEntries).not.toHaveBeenCalled();
    expect(accountSpies.insertRankIfChanged).not.toHaveBeenCalled();
    expect(accountSpies.enqueueDiscoveredMatches).not.toHaveBeenCalled();
  });

  it('maps provider rate-limit errors to rateLimited + RATE_LIMITED', async () => {
    const { service } = createService({
      getRecentMatchIds: vi.fn(async () => {
        throw new ProviderRateLimitedError('Riot rate limit exceeded.', {
          status: 429,
          retryAfterSeconds: 2,
        });
      }),
    });

    const result = await service.discoverAndEnqueue({
      mode: 'RIOT_ID',
      gameName: 'PlayerOne',
      tagLine: 'NA1',
      platform: 'na1',
      queueId: 420,
      maxMatches: 10,
      dryRun: true,
      correlationId: 'corr-429',
    });

    expect(result.ok).toBe(false);
    expect(result.rateLimited).toBe(true);
    expect(result.normalizedFailureCode).toBe('RATE_LIMITED');
    expect(result.retryAfterMs).toBe(2_000);
    expect(result.discoveredMatchCount).toBe(0);
    expect(result.enqueuedCount).toBe(0);
  });

  it('returns TRACKED_ACCOUNT_MISSING when player account id is absent', async () => {
    const { service, spies } = createService({
      findPlayerAccountById: vi.fn(async () => null),
    });

    const result = await service.discoverAndEnqueue({
      mode: 'PLAYER_ACCOUNT',
      playerAccountId: '00000000-0000-4000-8000-000000000099',
      queueId: 420,
      maxMatches: 10,
      dryRun: false,
      correlationId: 'corr-missing',
    });

    expect(result.ok).toBe(false);
    expect(result.normalizedFailureCode).toBe('TRACKED_ACCOUNT_MISSING');
    expect(spies.resolvePlayer).not.toHaveBeenCalled();
    expect(spies.enqueueDiscoveredMatches).not.toHaveBeenCalled();
  });

  it('returns ACCOUNT_REFERENCE_INVALID for malformed player account id', async () => {
    const { service, spies } = createService();

    const result = await service.discoverAndEnqueue({
      mode: 'PLAYER_ACCOUNT',
      playerAccountId: 'not-a-uuid',
      queueId: 420,
      maxMatches: 10,
      dryRun: false,
      correlationId: 'corr-bad-id',
    });

    expect(result.ok).toBe(false);
    expect(result.normalizedFailureCode).toBe('ACCOUNT_REFERENCE_INVALID');
    expect(spies.findPlayerAccountById).not.toHaveBeenCalled();
    expect(spies.resolvePlayer).not.toHaveBeenCalled();
  });

  it('passes sourceCollectorRunId to enqueue in PLAYER_ACCOUNT mode', async () => {
    const sourceCollectorRunId = '33333333-3333-4333-8333-333333333333';
    const { service, spies } = createService();

    await service.discoverAndEnqueue({
      mode: 'PLAYER_ACCOUNT',
      playerAccountId: ACCOUNT_ID,
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-collector',
      sourceCollectorRunId,
    });

    expect(spies.enqueueDiscoveredMatches).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceCollectorRunId }),
    );
  });

  it('does not pass sourceCollectorRunId for RIOT_ID mode', async () => {
    const { service, spies } = createService();

    await service.discoverAndEnqueue({
      mode: 'RIOT_ID',
      gameName: 'PlayerOne',
      tagLine: 'NA1',
      platform: 'na1',
      queueId: 420,
      maxMatches: 100,
      dryRun: false,
      correlationId: 'corr-search',
    });

    expect(spies.enqueueDiscoveredMatches.mock.calls[0]?.[1]).not.toHaveProperty(
      'sourceCollectorRunId',
    );
  });

  it('honors per-call pageSize override over Nest/runtime default', async () => {
    const getRecentMatchIds = vi.fn(async () => ['m-0']);
    const { service, deps } = createService({ getRecentMatchIds });
    expect(deps.pageSize).toBe(100);

    await service.discoverAndEnqueue(
      {
        mode: 'RIOT_ID',
        gameName: 'PlayerOne',
        tagLine: 'NA1',
        platform: 'na1',
        queueId: 420,
        maxMatches: 100,
        dryRun: true,
        correlationId: 'corr-page',
      },
      { pageSize: 25 },
    );

    expect(getRecentMatchIds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ queue: 420, start: 0, count: 25 }),
    );
  });
});
