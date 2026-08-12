import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlayerAccount as DbPlayerAccount } from '@prisma/client';
import {
  isRiotRequestBudgetDeferredError,
  withRiotWorkload,
} from '@league-helper/server-riot';
import {
  PlatformRouteSchema,
  ProviderIdSchema,
  ProviderRateLimitedError,
  RegionalRouteSchema,
  parsePlatformRoute,
  type GameDataProvider,
  type PlayerAccount as ProviderAccount,
} from '@league-helper/shared';
import {
  PLAYER_REFRESH_CONFIG,
  type PlayerRefreshConfig,
} from '../../../config/player-refresh.config';
import { GAME_DATA_PROVIDER } from '../../../integrations/riot/riot.tokens';
import { IngestionJobRepository } from '../../../persistence/ingestion-job.repository';
import { MatchRepository } from '../../../persistence/match.repository';
import { PlayerAccountRepository } from '../../../persistence/player-account.repository';
import { RankSnapshotRepository } from '../../../persistence/rank-snapshot.repository';
import { MatchIngestionProducer } from '../../../queues/match-ingestion.producer';
import {
  enqueueDiscoveredMatches as defaultEnqueueDiscoveredMatches,
  type EnqueueDiscoveredMatchesDeps,
  type EnqueueDiscoveredMatchesResult,
} from '../bootstrap/enqueue-discovered-matches';
import { paginateRecentMatchIds } from '../bootstrap/paginate-match-ids';
import { PlayerCacheService } from '../player-cache.service';
import type {
  PlayerMatchDiscoveryAccountInput,
  PlayerMatchDiscoveryCallOptions,
  PlayerMatchDiscoveryInput,
  PlayerMatchDiscoveryResult,
  PlayerMatchDiscoveryRiotIdInput,
} from './player-match-discovery.types';

/**
 * Nest-hosted discovery page size (Riot match-ids max).
 * Intentionally independent of CLI `loadMatchBootstrapConfig` so AppModule boot
 * never validates MATCH_BOOTSTRAP_* env vars.
 */
export const DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE = 100;

/** Optional Nest override for discovery pagination page size. */
export const PLAYER_MATCH_DISCOVERY_PAGE_SIZE = Symbol('PLAYER_MATCH_DISCOVERY_PAGE_SIZE');

const PLAYER_ACCOUNT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlayerMatchDiscoveryRuntimeDeps = {
  resolvePlayer: GameDataProvider['resolvePlayer'];
  getRankedEntries: GameDataProvider['getRankedEntries'];
  getRecentMatchIds: GameDataProvider['getRecentMatchIds'];
  upsertPlayerAccount: PlayerAccountRepository['upsertPlayerAccount'];
  findPlayerAccountById: PlayerAccountRepository['findById'];
  insertRankIfChanged: RankSnapshotRepository['insertIfChanged'];
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
  pageSize: number;
  logger: {
    log: (message: unknown) => void;
    warn?: (message: unknown) => void;
  };
};

function emptyResult(
  overrides: Partial<PlayerMatchDiscoveryResult> = {},
): PlayerMatchDiscoveryResult {
  return {
    ok: false,
    discoveredMatchCount: 0,
    enqueuedCount: 0,
    skippedAlreadyCompleteCount: 0,
    externalMatchIds: [],
    warnings: [],
    ...overrides,
  };
}

function isPlayerAccountIdUuid(value: string): boolean {
  return PLAYER_ACCOUNT_ID_UUID_RE.test(value.trim());
}

function toProviderAccount(account: DbPlayerAccount): ProviderAccount {
  return {
    provider: ProviderIdSchema.parse(account.provider),
    externalAccountId: account.externalAccountId,
    platform: PlatformRouteSchema.parse(account.platformRoute),
    regionalRoute: RegionalRouteSchema.parse(account.regionalRoute),
    riotId: {
      gameName: account.currentGameName,
      tagLine: account.currentTagLine,
    },
    summonerId: account.summonerId,
    accountId: account.accountId,
    profileIconId: account.profileIconId,
    summonerLevel: account.summonerLevel,
  };
}

function extractRetryAfterMs(error: ProviderRateLimitedError): number | undefined {
  const details = error.details;
  if (
    details !== null &&
    typeof details === 'object' &&
    'retryAfterSeconds' in details &&
    typeof (details as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number'
  ) {
    const seconds = (details as { retryAfterSeconds: number }).retryAfterSeconds;
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1_000);
    }
  }
  return undefined;
}

function failureFromError(error: unknown): PlayerMatchDiscoveryResult {
  if (error instanceof ProviderRateLimitedError) {
    const retryAfterMs = extractRetryAfterMs(error);
    return emptyResult({
      normalizedFailureCode: 'RATE_LIMITED',
      rateLimited: true,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      warnings: [{ code: 'RATE_LIMITED', message: error.message }],
    });
  }

  if (isRiotRequestBudgetDeferredError(error)) {
    return emptyResult({
      normalizedFailureCode: 'RIOT_REQUEST_BUDGET_DEFERRED',
      budgetDeferred: true,
      retryAfterMs: error.waitMs,
      warnings: [{ code: 'RIOT_REQUEST_BUDGET_DEFERRED', message: error.message }],
    });
  }

  const message = error instanceof Error ? error.message : 'Player match discovery failed';
  return emptyResult({
    normalizedFailureCode: 'DISCOVERY_FAILED',
    warnings: [{ code: 'DISCOVERY_FAILED', message }],
  });
}

async function softSyncRanks(
  deps: PlayerMatchDiscoveryRuntimeDeps,
  input: {
    account: DbPlayerAccount;
    providerAccount: ProviderAccount;
    correlationId: string;
    warnings: Array<{ code: string; message: string }>;
  },
): Promise<void> {
  try {
    const ranks = await deps.getRankedEntries(input.providerAccount);
    for (const entry of ranks) {
      await deps.insertRankIfChanged({
        playerAccountId: input.account.id,
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
    const message = error instanceof Error ? error.message : 'Rank sync failed';
    input.warnings.push({ code: 'RANK_SYNC_FAILED', message });
    deps.logger.warn?.({
      message: 'Discovery rank sync failed; continuing with match enqueue',
      correlationId: input.correlationId,
      playerId: input.account.playerId,
      error: message,
    });
  }
}

async function discoverRiotIdMode(
  deps: PlayerMatchDiscoveryRuntimeDeps,
  input: PlayerMatchDiscoveryRiotIdInput,
): Promise<PlayerMatchDiscoveryResult> {
  const warnings: Array<{ code: string; message: string }> = [];
  const enqueue = deps.enqueueDiscoveredMatches ?? defaultEnqueueDiscoveredMatches;
  const platform = parsePlatformRoute(input.platform);
  const resolved = await deps.resolvePlayer({
    gameName: input.gameName,
    tagLine: input.tagLine,
    platform,
  });

  if (input.dryRun) {
    const discoveredMatchIds = await paginateRecentMatchIds({
      getRecentMatchIds: deps.getRecentMatchIds,
      account: resolved,
      queueId: input.queueId,
      maxMatches: input.maxMatches,
      pageSize: deps.pageSize,
    });
    return {
      ok: true,
      discoveredMatchCount: discoveredMatchIds.length,
      enqueuedCount: 0,
      skippedAlreadyCompleteCount: 0,
      externalMatchIds: discoveredMatchIds,
      warnings,
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
    message: 'Discovery player account upserted',
    correlationId: input.correlationId,
    playerId: account.playerId,
    platform: account.platformRoute,
  });

  await softSyncRanks(deps, {
    account,
    providerAccount: resolved,
    correlationId: input.correlationId,
    warnings,
  });

  const discoveredMatchIds = await paginateRecentMatchIds({
    getRecentMatchIds: deps.getRecentMatchIds,
    account: resolved,
    queueId: input.queueId,
    maxMatches: input.maxMatches,
    pageSize: deps.pageSize,
  });

  const enqueueResult = await enqueue(deps.enqueueDeps, {
    account,
    discoveredMatchIds,
    correlationId: input.correlationId,
  });

  return {
    ok: true,
    playerAccountId: account.id,
    provider: account.provider,
    platformRoute: account.platformRoute,
    discoveredMatchCount: discoveredMatchIds.length,
    enqueuedCount: enqueueResult.enqueuedCount,
    skippedAlreadyCompleteCount: enqueueResult.skippedAlreadyCompleteCount,
    externalMatchIds: discoveredMatchIds,
    warnings: [
      ...warnings,
      ...enqueueResult.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
      })),
    ],
  };
}

async function discoverAccountMode(
  deps: PlayerMatchDiscoveryRuntimeDeps,
  input: PlayerMatchDiscoveryAccountInput,
): Promise<PlayerMatchDiscoveryResult> {
  if (!isPlayerAccountIdUuid(input.playerAccountId)) {
    return emptyResult({
      normalizedFailureCode: 'ACCOUNT_REFERENCE_INVALID',
      warnings: [
        {
          code: 'ACCOUNT_REFERENCE_INVALID',
          message: 'playerAccountId must be a valid UUID.',
        },
      ],
    });
  }

  const account = await deps.findPlayerAccountById(input.playerAccountId);
  if (!account) {
    return emptyResult({
      normalizedFailureCode: 'TRACKED_ACCOUNT_MISSING',
      warnings: [
        {
          code: 'TRACKED_ACCOUNT_MISSING',
          message: 'Player account was not found for discovery.',
        },
      ],
    });
  }

  const warnings: Array<{ code: string; message: string }> = [];
  const providerAccount = toProviderAccount(account);
  const enqueue = deps.enqueueDiscoveredMatches ?? defaultEnqueueDiscoveredMatches;

  if (input.dryRun) {
    const discoveredMatchIds = await paginateRecentMatchIds({
      getRecentMatchIds: deps.getRecentMatchIds,
      account: providerAccount,
      queueId: input.queueId,
      maxMatches: input.maxMatches,
      pageSize: deps.pageSize,
    });
    return {
      ok: true,
      playerAccountId: account.id,
      provider: account.provider,
      platformRoute: account.platformRoute,
      discoveredMatchCount: discoveredMatchIds.length,
      enqueuedCount: 0,
      skippedAlreadyCompleteCount: 0,
      externalMatchIds: discoveredMatchIds,
      warnings,
    };
  }

  await softSyncRanks(deps, {
    account,
    providerAccount,
    correlationId: input.correlationId,
    warnings,
  });

  const discoveredMatchIds = await paginateRecentMatchIds({
    getRecentMatchIds: deps.getRecentMatchIds,
    account: providerAccount,
    queueId: input.queueId,
    maxMatches: input.maxMatches,
    pageSize: deps.pageSize,
  });

  const enqueueResult = await enqueue(deps.enqueueDeps, {
    account,
    discoveredMatchIds,
    correlationId: input.correlationId,
    ...(input.sourceCollectorRunId !== undefined
      ? { sourceCollectorRunId: input.sourceCollectorRunId }
      : {}),
  });

  return {
    ok: true,
    playerAccountId: account.id,
    provider: account.provider,
    platformRoute: account.platformRoute,
    discoveredMatchCount: discoveredMatchIds.length,
    enqueuedCount: enqueueResult.enqueuedCount,
    skippedAlreadyCompleteCount: enqueueResult.skippedAlreadyCompleteCount,
    externalMatchIds: discoveredMatchIds,
    warnings: [
      ...warnings,
      ...enqueueResult.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
      })),
    ],
  };
}

function withCallOptions(
  deps: PlayerMatchDiscoveryRuntimeDeps,
  options?: PlayerMatchDiscoveryCallOptions,
): PlayerMatchDiscoveryRuntimeDeps {
  if (options?.pageSize === undefined) {
    return deps;
  }
  return { ...deps, pageSize: options.pageSize };
}

/**
 * Shared single-player discovery/enqueue (Riot-ID + existing PlayerAccount modes).
 * Collector-agnostic: no leases, runs, priority, or backoff.
 */
export async function runPlayerMatchDiscovery(
  deps: PlayerMatchDiscoveryRuntimeDeps,
  input: PlayerMatchDiscoveryInput,
  options?: PlayerMatchDiscoveryCallOptions,
): Promise<PlayerMatchDiscoveryResult> {
  return withRiotWorkload('refresh', async () => {
    const effectiveDeps = withCallOptions(deps, options);
    try {
      if (input.mode === 'RIOT_ID') {
        return await discoverRiotIdMode(effectiveDeps, input);
      }
      return await discoverAccountMode(effectiveDeps, input);
    } catch (error: unknown) {
      return failureFromError(error);
    }
  });
}

@Injectable()
export class PlayerMatchDiscoveryService {
  private readonly logger = new Logger(PlayerMatchDiscoveryService.name);
  private readonly runtimeDeps: PlayerMatchDiscoveryRuntimeDeps;

  constructor(
    @Inject(GAME_DATA_PROVIDER) gameData: GameDataProvider,
    @Inject(PlayerAccountRepository) playerAccounts: PlayerAccountRepository,
    @Inject(RankSnapshotRepository) rankSnapshots: RankSnapshotRepository,
    @Inject(MatchRepository) matches: MatchRepository,
    @Inject(IngestionJobRepository) ingestionJobs: IngestionJobRepository,
    @Inject(MatchIngestionProducer) producer: MatchIngestionProducer,
    @Inject(PLAYER_REFRESH_CONFIG) refreshConfig: PlayerRefreshConfig,
    @Inject(PlayerCacheService) cache: PlayerCacheService,
    @Optional()
    @Inject(PLAYER_MATCH_DISCOVERY_PAGE_SIZE)
    pageSize: number = DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
  ) {
    const resolvedPageSize =
      typeof pageSize === 'number' &&
      Number.isInteger(pageSize) &&
      pageSize >= 1 &&
      pageSize <= 100
        ? pageSize
        : DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE;

    this.runtimeDeps = {
      resolvePlayer: (input) => gameData.resolvePlayer(input),
      getRankedEntries: (account) => gameData.getRankedEntries(account),
      getRecentMatchIds: (account, options) => gameData.getRecentMatchIds(account, options),
      upsertPlayerAccount: (input) => playerAccounts.upsertPlayerAccount(input),
      findPlayerAccountById: (id) => playerAccounts.findById(id),
      insertRankIfChanged: (input) => rankSnapshots.insertIfChanged(input),
      enqueueDeps: {
        matches,
        ingestionJobs,
        producer,
        matchIngestionJobAttempts: refreshConfig.matchIngestionJobAttempts,
        logger: this.logger,
        invalidatePlayerCache: (playerId) => cache.invalidate(playerId),
      },
      pageSize: resolvedPageSize,
      logger: this.logger,
    };
  }

  /** Test factory — bypasses Nest DI. */
  static fromRuntimeDeps(deps: PlayerMatchDiscoveryRuntimeDeps): PlayerMatchDiscoveryService {
    const instance = Object.create(
      PlayerMatchDiscoveryService.prototype,
    ) as PlayerMatchDiscoveryService;
    Object.defineProperty(instance, 'logger', {
      value: new Logger(PlayerMatchDiscoveryService.name),
      writable: false,
    });
    Object.defineProperty(instance, 'runtimeDeps', {
      value: deps,
      writable: false,
    });
    return instance;
  }

  discoverAndEnqueue(
    input: PlayerMatchDiscoveryInput,
    options?: PlayerMatchDiscoveryCallOptions,
  ): Promise<PlayerMatchDiscoveryResult> {
    return runPlayerMatchDiscovery(this.runtimeDeps, input, options);
  }
}
