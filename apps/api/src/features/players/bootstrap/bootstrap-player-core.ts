import { ValidationFailureError, type GameDataProvider } from '@league-helper/shared';
import type { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import type { RankSnapshotRepository } from '../../../persistence/rank-snapshot.repository';
import {
  runPlayerMatchDiscovery,
  type PlayerMatchDiscoveryRuntimeDeps,
} from '../discovery/player-match-discovery.service';
import type {
  PlayerMatchDiscoveryInput,
  PlayerMatchDiscoveryResult,
} from '../discovery/player-match-discovery.types';
import type { MatchBootstrapConfig } from './bootstrap-player.config';
import type {
  BootstrapPlayerResult,
  BootstrapPlayerTarget,
  BootstrapRunResult,
} from './bootstrap-player.types';
import {
  enqueueDiscoveredMatches as defaultEnqueueDiscoveredMatches,
  type EnqueueDiscoveredMatchesDeps,
  type EnqueueDiscoveredMatchesResult,
} from './enqueue-discovered-matches';

export type BootstrapCoreLogger = {
  log: (message: unknown) => void;
  warn?: (message: unknown) => void;
};

export type BootstrapEnrollmentAccount = {
  id: string;
  provider: string;
  platformRoute: string;
};

type BootstrapCoreShared = {
  config: MatchBootstrapConfig;
  logger: BootstrapCoreLogger;
  /**
   * Optional post-upsert hook (e.g. collector enrollment).
   * Called only after successful non-dry-run discovery with an upserted account.
   * Must not throw into bootstrap result handling — callers should soft-fail.
   */
  afterSuccessfulUpsert?: (account: BootstrapEnrollmentAccount) => Promise<void>;
};

/** Live CLI / Nest path: discovery service is the single source of truth. */
export type BootstrapDiscoveryCoreDeps = BootstrapCoreShared & {
  discoverAndEnqueue: (
    input: PlayerMatchDiscoveryInput,
  ) => Promise<PlayerMatchDiscoveryResult>;
};

/** Unit-test composition path: low-level Riot/DB deps without Nest discovery. */
export type BootstrapLowLevelCoreDeps = BootstrapCoreShared & {
  resolvePlayer: GameDataProvider['resolvePlayer'];
  getRankedEntries: GameDataProvider['getRankedEntries'];
  getRecentMatchIds: GameDataProvider['getRecentMatchIds'];
  upsertPlayerAccount: PlayerAccountRepository['upsertPlayerAccount'];
  insertRankIfChanged: RankSnapshotRepository['insertIfChanged'];
  /** Injectable for tests; defaults to shared enqueue helper. */
  enqueueDiscoveredMatches?: (
    deps: EnqueueDiscoveredMatchesDeps,
    input: {
      account: Parameters<typeof defaultEnqueueDiscoveredMatches>[1]['account'];
      discoveredMatchIds: string[];
      correlationId: string;
      sourceCollectorRunId?: string;
    },
  ) => Promise<EnqueueDiscoveredMatchesResult>;
  enqueueDeps: EnqueueDiscoveredMatchesDeps;
};

export type BootstrapCoreDeps = BootstrapDiscoveryCoreDeps | BootstrapLowLevelCoreDeps;

export type BootstrapPlayerInput = {
  target: BootstrapPlayerTarget;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  correlationId: string;
};

export type BootstrapPlayersInput = {
  players: BootstrapPlayerTarget[];
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  concurrency: number;
  correlationId: string;
};

function emptyPlayerResult(
  target: BootstrapPlayerTarget,
  dryRun: boolean,
  error?: string,
): BootstrapPlayerResult {
  return {
    ok: error === undefined,
    gameName: target.gameName,
    tagLine: target.tagLine,
    platform: target.platform,
    dryRun,
    discoveredMatchCount: 0,
    enqueuedCount: 0,
    skippedAlreadyCompleteCount: 0,
    externalMatchIds: [],
    ...(error !== undefined ? { error } : {}),
  };
}

function hasDiscoveryEntrypoint(
  deps: BootstrapCoreDeps,
): deps is BootstrapDiscoveryCoreDeps {
  return (
    'discoverAndEnqueue' in deps &&
    typeof (deps as BootstrapDiscoveryCoreDeps).discoverAndEnqueue === 'function'
  );
}

function toDiscoveryRuntimeDeps(deps: BootstrapLowLevelCoreDeps): PlayerMatchDiscoveryRuntimeDeps {
  return {
    resolvePlayer: deps.resolvePlayer,
    getRankedEntries: deps.getRankedEntries,
    getRecentMatchIds: deps.getRecentMatchIds,
    upsertPlayerAccount: deps.upsertPlayerAccount,
    findPlayerAccountById: async () => {
      throw new Error(
        'Riot-ID bootstrap path must not load PlayerAccount by id; use PLAYER_ACCOUNT discovery mode.',
      );
    },
    insertRankIfChanged: deps.insertRankIfChanged,
    enqueueDiscoveredMatches: deps.enqueueDiscoveredMatches,
    enqueueDeps: deps.enqueueDeps,
    pageSize: deps.config.pageSize,
    logger: deps.logger,
  };
}

function mapDiscoveryToBootstrapResult(
  target: BootstrapPlayerTarget,
  dryRun: boolean,
  discovery: PlayerMatchDiscoveryResult,
): BootstrapPlayerResult {
  if (!discovery.ok) {
    const message =
      discovery.warnings[0]?.message ??
      discovery.normalizedFailureCode ??
      'Bootstrap player failed';
    return emptyPlayerResult(target, dryRun, message);
  }

  return {
    ok: true,
    gameName: target.gameName,
    tagLine: target.tagLine,
    platform: target.platform,
    dryRun,
    discoveredMatchCount: discovery.discoveredMatchCount,
    ...(dryRun ? { wouldEnqueueCount: discovery.discoveredMatchCount } : {}),
    enqueuedCount: discovery.enqueuedCount,
    skippedAlreadyCompleteCount: discovery.skippedAlreadyCompleteCount,
    externalMatchIds: discovery.externalMatchIds,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index] as T, index);
    }
  }

  const poolSize = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

/**
 * Bootstrap a single player via shared discovery/enqueue (Riot-ID mode).
 * Dry-run may call Riot for resolve + discovery; it must not write DB or enqueue.
 */
export async function bootstrapPlayer(
  deps: BootstrapCoreDeps,
  input: BootstrapPlayerInput,
): Promise<BootstrapPlayerResult> {
  const { target, queueId, maxMatches, dryRun, correlationId } = input;

  const discoveryInput: PlayerMatchDiscoveryInput = {
    mode: 'RIOT_ID',
    gameName: target.gameName,
    tagLine: target.tagLine,
    platform: target.platform,
    queueId,
    maxMatches,
    dryRun,
    correlationId,
  };

  const discovery = hasDiscoveryEntrypoint(deps)
    ? await deps.discoverAndEnqueue(discoveryInput)
    : await runPlayerMatchDiscovery(toDiscoveryRuntimeDeps(deps), discoveryInput);

  const result = mapDiscoveryToBootstrapResult(target, dryRun, discovery);

  if (
    !dryRun &&
    discovery.ok &&
    discovery.playerAccountId &&
    discovery.provider &&
    discovery.platformRoute &&
    deps.afterSuccessfulUpsert
  ) {
    try {
      await deps.afterSuccessfulUpsert({
        id: discovery.playerAccountId,
        provider: discovery.provider,
        platformRoute: discovery.platformRoute,
      });
    } catch (error: unknown) {
      deps.logger.warn?.({
        message: 'Bootstrap afterSuccessfulUpsert failed',
        playerAccountId: discovery.playerAccountId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return result;
}

/**
 * Bootstrap many players (file mode). Sequential by default; bounded concurrency optional.
 * Validates list size before any Riot calls. One failure does not stop others.
 */
export async function bootstrapPlayers(
  deps: BootstrapCoreDeps,
  input: BootstrapPlayersInput,
): Promise<BootstrapRunResult> {
  const { players, queueId, maxMatches, dryRun, correlationId } = input;

  if (players.length > deps.config.fileMaxPlayers) {
    throw new ValidationFailureError(
      `Too many players: ${players.length} exceeds fileMaxPlayers (${deps.config.fileMaxPlayers}).`,
      { received: String(players.length) },
    );
  }

  if (players.length === 0) {
    throw new ValidationFailureError('Bootstrap requires at least one player.');
  }

  const concurrency = Math.min(
    Math.max(1, input.concurrency),
    deps.config.maxConcurrency,
  );

  const playerResults = await mapPool(players, concurrency, async (target, index) =>
    bootstrapPlayer(deps, {
      target,
      queueId,
      maxMatches,
      dryRun,
      correlationId: `${correlationId}:${index}`,
    }),
  );

  const playersFailed = playerResults.filter((p) => !p.ok).length;
  const totals = {
    players: playerResults.length,
    playersFailed,
    discoveredMatchCount: playerResults.reduce((sum, p) => sum + p.discoveredMatchCount, 0),
    enqueuedCount: playerResults.reduce((sum, p) => sum + p.enqueuedCount, 0),
  };

  return {
    ok: playersFailed === 0,
    dryRun,
    players: playerResults,
    totals,
  };
}
