import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlayerAccount as DbPlayerAccount } from '@prisma/client';
import {
  PlatformRouteSchema,
  ProviderIdSchema,
  RegionalRouteSchema,
  type GameDataProvider,
  type PlayerAccount as ProviderAccount,
} from '@league-helper/shared';
import { GAME_DATA_PROVIDER } from '../../integrations/riot/riot.tokens';
import { PlayerAccountRepository } from '../../persistence/player-account.repository';
import {
  DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
  PLAYER_MATCH_DISCOVERY_PAGE_SIZE,
} from '../players/discovery/player-match-discovery.service';
import { paginateRecentMatchIds } from '../players/bootstrap/paginate-match-ids';
import { loadCollectorConfig, type CollectorConfig } from './collector.config';
import { COLLECTOR_CONFIG } from './collector-enrollment.service';
import { COLLECTOR_PROVIDER, type CollectorPreviewInput, type CollectorPreviewResult } from './collector.types';
import { TrackedPlayerRepository } from './tracked-player.repository';

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

export function computeEffectivePlatforms(
  allowlist: string[],
  platformFilter?: string | null,
): string[] {
  if (platformFilter == null || platformFilter === '') {
    return [...allowlist];
  }
  return allowlist.filter((platform) => platform === platformFilter);
}

@Injectable()
export class CollectorEligibilityService {
  private readonly config: CollectorConfig;
  private readonly pageSize: number;

  constructor(
    @Inject(TrackedPlayerRepository) private readonly trackedPlayers: TrackedPlayerRepository,
    @Inject(PlayerAccountRepository) private readonly playerAccounts: PlayerAccountRepository,
    @Inject(GAME_DATA_PROVIDER) private readonly gameData: GameDataProvider,
    @Optional() @Inject(COLLECTOR_CONFIG) config?: CollectorConfig,
    @Optional() @Inject(PLAYER_MATCH_DISCOVERY_PAGE_SIZE) pageSize?: number,
  ) {
    this.config = config ?? loadCollectorConfig(process.env);
    this.pageSize =
      typeof pageSize === 'number' &&
      Number.isInteger(pageSize) &&
      pageSize >= 1 &&
      pageSize <= 100
        ? pageSize
        : DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE;
  }

  /** Test factory — bypasses Nest DI. */
  static create(deps: {
    trackedPlayers: TrackedPlayerRepository;
    playerAccounts: PlayerAccountRepository;
    gameData: Pick<GameDataProvider, 'getRecentMatchIds'>;
    config: CollectorConfig;
    pageSize?: number;
  }): CollectorEligibilityService {
    return new CollectorEligibilityService(
      deps.trackedPlayers,
      deps.playerAccounts,
      deps.gameData as GameDataProvider,
      deps.config,
      deps.pageSize ?? DEFAULT_DISCOVERY_MATCH_ID_PAGE_SIZE,
    );
  }

  /**
   * Strictly read-only eligibility preview.
   * No CollectorRun, no lease/schedule mutations, no enqueue, no account upsert.
   */
  async preview(input: CollectorPreviewInput): Promise<CollectorPreviewResult> {
    const effectivePlatforms = computeEffectivePlatforms(
      this.config.platformAllowlist,
      input.platformFilter,
    );

    const candidateLimit = Math.max(
      1,
      input.candidateLimit ?? this.config.batchSize,
    );

    const [eligibleCount, rows] = await Promise.all([
      this.trackedPlayers.countEligible({
        platformRoutes: effectivePlatforms,
        provider: COLLECTOR_PROVIDER,
      }),
      this.trackedPlayers.listEligiblePreview({
        platformRoutes: effectivePlatforms,
        provider: COLLECTOR_PROVIDER,
        limit: candidateLimit,
      }),
    ]);

    const candidates = rows.map((row) => ({
      trackedPlayerId: row.id,
      playerAccountId: row.playerAccountId,
      platformRoute: row.platformRoute,
      priority: row.priority,
      nextEligibleAt: row.nextEligibleAt,
      lastSuccessfulRefreshAt: row.lastSuccessfulRefreshAt,
      consecutiveZeroNewMatchRuns: row.consecutiveZeroNewMatchRuns,
    }));

    const result: CollectorPreviewResult = {
      eligibleCount,
      effectivePlatforms,
      queueId: input.queueId,
      candidates,
    };

    if (input.sampleDiscovery == null || input.sampleDiscovery <= 0) {
      return result;
    }

    const sampleLimit = Math.min(input.sampleDiscovery, candidates.length);
    const maxMatches = Math.max(1, input.maxMatches ?? this.config.matchesPerPlayer);
    const sampleDiscovery = [];

    for (let i = 0; i < sampleLimit; i += 1) {
      const candidate = candidates[i]!;
      const account = await this.playerAccounts.findById(candidate.playerAccountId);
      if (!account) {
        sampleDiscovery.push({
          trackedPlayerId: candidate.trackedPlayerId,
          playerAccountId: candidate.playerAccountId,
          platformRoute: candidate.platformRoute,
          discoveredMatchCount: 0,
          wouldEnqueueCount: 0,
        });
        continue;
      }

      const discoveredMatchIds = await paginateRecentMatchIds({
        getRecentMatchIds: (providerAccount, options) =>
          this.gameData.getRecentMatchIds(providerAccount, options),
        account: toProviderAccount(account),
        queueId: input.queueId,
        maxMatches,
        pageSize: this.pageSize,
      });

      sampleDiscovery.push({
        trackedPlayerId: candidate.trackedPlayerId,
        playerAccountId: candidate.playerAccountId,
        platformRoute: candidate.platformRoute,
        discoveredMatchCount: discoveredMatchIds.length,
        // Advisory only — no enqueue classification writes.
        wouldEnqueueCount: discoveredMatchIds.length,
      });
    }

    return { ...result, sampleDiscovery };
  }
}
