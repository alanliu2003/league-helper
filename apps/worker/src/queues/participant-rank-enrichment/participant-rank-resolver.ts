import {
  isRiotRequestBudgetDeferredError,
  withRiotWorkload,
  type RiotSharedCooldownStore,
} from '@league-helper/server-riot';
import {
  ProviderForbiddenError,
  ProviderRateLimitedError,
  ProviderUnauthorizedError,
  ProviderUnavailableError,
  ResourceNotFoundError,
  getRegionalRouteForPlatform,
  parsePlatformRoute,
  type GameDataProvider,
  type ParticipantRankResolutionStatus,
  type PlayerAccount,
  type RankDivision,
  type RankTier,
} from '@league-helper/shared';
import type { EnrichmentRankedQueueType } from './queue-type.js';

export type ParticipantRankResolveInput = {
  platformRoute: string;
  externalAccountId: string;
  queueType: EnrichmentRankedQueueType;
};

export type ParticipantRankResolveOutcome = {
  resolutionStatus: ParticipantRankResolutionStatus;
  observedTier: RankTier | null;
  observedDivision: RankDivision | null;
  providerResultCode: string;
  /** True when the processor should defer/retry the BullMQ job. */
  retryable: boolean;
  /** True when auth failed closed — do not retry-storm. */
  failClosed: boolean;
  /** True when a Riot HTTP call was attempted. */
  riotCalled: boolean;
  /** Present when a 429 should extend the shared cooldown. */
  rateLimited?: ProviderRateLimitedError;
  /** Suggested BullMQ delay for proactive budget deferral (ms). */
  budgetDeferWaitMs?: number;
};

export type ParticipantRankResolverDeps = {
  provider: Pick<GameDataProvider, 'getRankedEntries'>;
  sharedCooldown: Pick<RiotSharedCooldownStore, 'remainingMs' | 'extendCooldown'> | null;
  riotShared429CooldownMinMs: number;
  now?: () => number;
};

/**
 * Build a minimal PlayerAccount for League-v4 entries/by-puuid.
 * Riot ID is a non-secret stub — Account-v1 is not used for rank resolution.
 */
export function buildRankLookupPlayerAccount(input: {
  platformRoute: string;
  externalAccountId: string;
}): PlayerAccount {
  const platform = parsePlatformRoute(input.platformRoute);
  return {
    provider: 'RIOT',
    externalAccountId: input.externalAccountId,
    riotId: { gameName: 'RankLookup', tagLine: 'NA1' },
    platform,
    regionalRoute: getRegionalRouteForPlatform(platform),
    summonerId: null,
    accountId: null,
    profileIconId: null,
    summonerLevel: null,
  };
}

function retryAfterMsFromRateLimited(error: ProviderRateLimitedError): number | null {
  const details = error.details;
  if (!details || typeof details !== 'object') {
    return null;
  }
  const record = details as Record<string, unknown>;
  const value = record.retryAfterSeconds ?? record.retryAfter;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.ceil(value) * 1000;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.ceil(parsed) * 1000;
    }
  }
  return null;
}

/**
 * Resolve Solo/Flex rank for a participant PUUID via League-v4.
 * Does not require TrackedPlayer / PlayerAccount product roots.
 */
export async function resolveParticipantRankViaLeagueV4(
  deps: ParticipantRankResolverDeps,
  input: ParticipantRankResolveInput,
): Promise<ParticipantRankResolveOutcome> {
  const puuid = input.externalAccountId.trim();
  if (puuid.length === 0) {
    return {
      resolutionStatus: 'FAILED_PERMANENT',
      observedTier: null,
      observedDivision: null,
      providerResultCode: 'MISSING_PUUID',
      retryable: false,
      failClosed: false,
      riotCalled: false,
    };
  }

  const now = deps.now?.() ?? Date.now();
  if (deps.sharedCooldown) {
    const remainingMs = await deps.sharedCooldown.remainingMs(now);
    if (remainingMs > 0) {
      return {
        resolutionStatus: 'FAILED_RETRYABLE',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'SHARED_COOLDOWN_ACTIVE',
        retryable: true,
        failClosed: false,
        riotCalled: false,
      };
    }
  }

  const player = buildRankLookupPlayerAccount({
    platformRoute: input.platformRoute,
    externalAccountId: puuid,
  });

  try {
    const entries = await withRiotWorkload('enrichment', () =>
      deps.provider.getRankedEntries(player),
    );
    const applicable = entries.find((entry) => entry.queueType === input.queueType);
    if (applicable) {
      return {
        resolutionStatus: 'RESOLVED_RANKED',
        observedTier: applicable.tier,
        observedDivision: applicable.division,
        providerResultCode: 'HTTP_200_RANKED',
        retryable: false,
        failClosed: false,
        riotCalled: true,
      };
    }
    return {
      resolutionStatus: 'RESOLVED_UNRANKED',
      observedTier: null,
      observedDivision: null,
      providerResultCode: 'HTTP_200_NO_APPLICABLE_ENTRY',
      retryable: false,
      failClosed: false,
      riotCalled: true,
    };
  } catch (error: unknown) {
    if (isRiotRequestBudgetDeferredError(error)) {
      return {
        resolutionStatus: 'FAILED_RETRYABLE',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'RIOT_REQUEST_BUDGET_DEFERRED',
        retryable: true,
        failClosed: false,
        riotCalled: false,
        budgetDeferWaitMs: Math.max(1_000, error.waitMs),
      };
    }

    if (error instanceof ProviderRateLimitedError) {
      if (deps.sharedCooldown) {
        await deps.sharedCooldown.extendCooldown({
          now: deps.now?.() ?? Date.now(),
          configuredFloorMs: deps.riotShared429CooldownMinMs,
          retryAfterMs: retryAfterMsFromRateLimited(error),
          source: 'participant-rank-enrichment',
        });
      }
      return {
        resolutionStatus: 'FAILED_RETRYABLE',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'HTTP_429',
        retryable: true,
        failClosed: false,
        riotCalled: true,
        rateLimited: error,
      };
    }

    if (error instanceof ProviderUnauthorizedError || error instanceof ProviderForbiddenError) {
      return {
        resolutionStatus: 'FAILED_RETRYABLE',
        observedTier: null,
        observedDivision: null,
        providerResultCode:
          error instanceof ProviderUnauthorizedError ? 'HTTP_401' : 'HTTP_403',
        retryable: false,
        failClosed: true,
        riotCalled: true,
      };
    }

    // Empty / missing ranked list is treated as finalized unranked (lookup succeeded).
    if (error instanceof ResourceNotFoundError) {
      return {
        resolutionStatus: 'RESOLVED_UNRANKED',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'HTTP_404_NO_ENTRIES',
        retryable: false,
        failClosed: false,
        riotCalled: true,
      };
    }

    if (error instanceof ProviderUnavailableError) {
      return {
        resolutionStatus: 'FAILED_RETRYABLE',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'HTTP_5XX_OR_NETWORK',
        retryable: true,
        failClosed: false,
        riotCalled: true,
      };
    }

    const message = error instanceof Error ? error.message : '';
    if (/\b5\d\d\b/.test(message) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(message)) {
      return {
        resolutionStatus: 'FAILED_RETRYABLE',
        observedTier: null,
        observedDivision: null,
        providerResultCode: 'HTTP_5XX_OR_NETWORK',
        retryable: true,
        failClosed: false,
        riotCalled: true,
      };
    }

    return {
      resolutionStatus: 'FAILED_RETRYABLE',
      observedTier: null,
      observedDivision: null,
      providerResultCode: 'PROVIDER_ERROR',
      retryable: true,
      failClosed: false,
      riotCalled: true,
    };
  }
}
