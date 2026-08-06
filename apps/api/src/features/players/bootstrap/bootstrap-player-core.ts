import {
  ValidationFailureError,
  parsePlatformRoute,
  type GameDataProvider,
} from '@league-helper/shared';
import type { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import type { RankSnapshotRepository } from '../../../persistence/rank-snapshot.repository';
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
import { paginateRecentMatchIds } from './paginate-match-ids';

export type BootstrapCoreDeps = {
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
    },
  ) => Promise<EnqueueDiscoveredMatchesResult>;
  enqueueDeps: EnqueueDiscoveredMatchesDeps;
  config: MatchBootstrapConfig;
  logger: {
    log: (message: unknown) => void;
    warn?: (message: unknown) => void;
  };
};

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
 * Bootstrap a single player: resolve → (apply: upsert + ranks) → paginate → enqueue.
 * Dry-run may call Riot for resolve + discovery; it must not write DB or enqueue.
 */
export async function bootstrapPlayer(
  deps: BootstrapCoreDeps,
  input: BootstrapPlayerInput,
): Promise<BootstrapPlayerResult> {
  const { target, queueId, maxMatches, dryRun, correlationId } = input;
  const enqueue = deps.enqueueDiscoveredMatches ?? defaultEnqueueDiscoveredMatches;

  try {
    const platform = parsePlatformRoute(target.platform);
    const resolved = await deps.resolvePlayer({
      gameName: target.gameName,
      tagLine: target.tagLine,
      platform,
    });

    if (dryRun) {
      const discoveredMatchIds = await paginateRecentMatchIds({
        getRecentMatchIds: deps.getRecentMatchIds,
        account: resolved,
        queueId,
        maxMatches,
        pageSize: deps.config.pageSize,
      });
      return {
        ok: true,
        gameName: target.gameName,
        tagLine: target.tagLine,
        platform: target.platform,
        dryRun: true,
        discoveredMatchCount: discoveredMatchIds.length,
        wouldEnqueueCount: discoveredMatchIds.length,
        enqueuedCount: 0,
        skippedAlreadyCompleteCount: 0,
        externalMatchIds: discoveredMatchIds,
      };
    }

    const account = await deps.upsertPlayerAccount({
      provider: resolved.provider,
      externalAccountId: resolved.externalAccountId,
      platformRoute: resolved.platform,
      regionalRoute: resolved.regionalRoute,
      gameName: resolved.riotId.gameName,
      tagLine: resolved.riotId.tagLine,
      summonerId: resolved.summonerId ?? null,
      accountId: resolved.accountId ?? null,
      profileIconId: resolved.profileIconId ?? null,
      summonerLevel: resolved.summonerLevel ?? null,
      lastResolvedAt: new Date(),
    });

    deps.logger.log({
      message: 'Bootstrap player account upserted',
      correlationId,
      playerId: account.playerId,
      platform: account.platformRoute,
    });

    try {
      const ranks = await deps.getRankedEntries(resolved);
      for (const entry of ranks) {
        await deps.insertRankIfChanged({
          playerAccountId: account.id,
          queueType: entry.queueType,
          tier: entry.tier,
          division: entry.division,
          leaguePoints: entry.leaguePoints,
          wins: entry.wins,
          losses: entry.losses,
          veteran: entry.veteran,
          inactive: entry.inactive,
          freshBlood: entry.freshBlood,
          hotStreak: entry.hotStreak,
        });
      }
    } catch (error: unknown) {
      deps.logger.warn?.({
        message: 'Bootstrap rank sync failed; continuing with match enqueue',
        correlationId,
        playerId: account.playerId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    const discoveredMatchIds = await paginateRecentMatchIds({
      getRecentMatchIds: deps.getRecentMatchIds,
      account: resolved,
      queueId,
      maxMatches,
      pageSize: deps.config.pageSize,
    });

    const enqueueResult = await enqueue(deps.enqueueDeps, {
      account,
      discoveredMatchIds,
      correlationId,
    });

    return {
      ok: true,
      gameName: target.gameName,
      tagLine: target.tagLine,
      platform: target.platform,
      dryRun: false,
      discoveredMatchCount: discoveredMatchIds.length,
      enqueuedCount: enqueueResult.enqueuedCount,
      skippedAlreadyCompleteCount: enqueueResult.skippedAlreadyCompleteCount,
      externalMatchIds: discoveredMatchIds,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Bootstrap player failed';
    return emptyPlayerResult(target, dryRun, message);
  }
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
