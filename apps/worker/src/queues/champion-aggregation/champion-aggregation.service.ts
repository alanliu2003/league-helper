import type { Redis } from 'ioredis';
import {
  accumulateContribution,
  buildChampionAggregateDimensionKey,
  emptyAccumulator,
  type ChampionAggregateAccumulator,
  type MaterializedChampionDimensions,
} from '@league-helper/match-analytics';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import {
  distinctCacheGenerationScopes,
  incrementChampionStatsCacheGenerations,
} from './cache-generation-invalidator.js';
import {
  evaluateMatchEligibility,
  type EligibleContributor,
} from './eligibility.js';
import {
  groupKeysForBatchedReads,
  parseChampionAggregateDimensionKey,
  type ChampionAggregationRepository,
} from './champion-aggregation.repository.js';
import {
  expandCurrentDimensionKeys,
  unionDimensionKeys,
} from './previous-keys.js';
import { contributorFeedsKeyForRankClassification } from './rank-dimension-keys.js';

export type RecalculateForMatchResult =
  | {
      outcome: 'skipped_permanently_ineligible';
      reason: string;
      wrote: boolean;
      rowsDeleted: number;
      cacheGenerationsIncremented: number;
      /** True when a concurrent upsert left newer previous keys after this job. */
      scopeRemains: boolean;
    }
  | {
      outcome: 'skipped_version_mismatch';
      reason: string;
      wrote: false;
      scopeRemains: false;
    }
  | {
      outcome: 'completed';
      keysRecalculated: number;
      rowsUpserted: number;
      rowsDeleted: number;
      cacheGenerationsIncremented: number;
      wrote: boolean;
      /** True when a concurrent upsert left newer previous keys after this job. */
      scopeRemains: boolean;
    };

export type ChampionAggregationServiceDeps = {
  repository: ChampionAggregationRepository;
  redis: Redis;
  config: ChampionAggregationWorkerConfig;
};

function contributorFeedsKey(
  contributor: EligibleContributor,
  key: MaterializedChampionDimensions,
): boolean {
  return contributorFeedsKeyForRankClassification(
    contributor.base,
    contributor.rankClassification,
    key,
  );
}

async function foldAffectedKeys(input: {
  repository: ChampionAggregationRepository;
  affectedDims: MaterializedChampionDimensions[];
  versions: { sourceNormalizationVersion: string; aggregationVersion: string };
}): Promise<{
  upserts: Array<{ dims: MaterializedChampionDimensions; accumulator: ChampionAggregateAccumulator }>;
  deletes: MaterializedChampionDimensions[];
}> {
  const accumulators = new Map<string, ChampionAggregateAccumulator>();
  for (const dims of input.affectedDims) {
    accumulators.set(buildChampionAggregateDimensionKey(dims), emptyAccumulator());
  }

  const groups = groupKeysForBatchedReads(input.affectedDims);
  for (const group of groups) {
    const candidates = await input.repository.fetchEligibleContributorCandidates(group);
    for (const row of candidates) {
      const rowEligibility = evaluateMatchEligibility(row.match, [row.participant], input.versions);
      if (!rowEligibility.eligible) {
        continue;
      }
      for (const contributor of rowEligibility.contributors) {
        for (const key of group.keys) {
          if (!contributorFeedsKey(contributor, key)) {
            continue;
          }
          const keyString = buildChampionAggregateDimensionKey(key);
          const current = accumulators.get(keyString) ?? emptyAccumulator();
          accumulators.set(
            keyString,
            accumulateContribution(current, {
              championId: contributor.exact.championId,
              won: contributor.won,
              kills: contributor.kills,
              deaths: contributor.deaths,
              assists: contributor.assists,
              totalCs: contributor.totalCs,
              gameSeconds: contributor.gameSeconds,
              damageToChampions: contributor.damageToChampions,
              visionScore: contributor.visionScore,
              goldEarned: contributor.goldEarned,
              goldDifferenceAt10: contributor.goldDifferenceAt10,
              goldDifferenceAt15: contributor.goldDifferenceAt15,
              csDifferenceAt10: contributor.csDifferenceAt10,
              csDifferenceAt15: contributor.csDifferenceAt15,
              matchEndedAt: contributor.matchEndedAt,
            }),
          );
        }
      }
    }
  }

  const upserts: Array<{
    dims: MaterializedChampionDimensions;
    accumulator: ChampionAggregateAccumulator;
  }> = [];
  const deletes: MaterializedChampionDimensions[] = [];

  for (const dims of input.affectedDims) {
    const keyString = buildChampionAggregateDimensionKey(dims);
    const accumulator = accumulators.get(keyString) ?? emptyAccumulator();
    if (accumulator.sampleSize > 0) {
      upserts.push({ dims, accumulator });
    } else {
      deletes.push(dims);
    }
  }

  return { upserts, deletes };
}

async function clearLoadedScope(input: {
  repository: ChampionAggregationRepository;
  matchId: string;
  versions: { sourceNormalizationVersion: string; aggregationVersion: string };
  expectedPreviousDimensionKeys: string[];
  correlationId?: string;
}): Promise<boolean> {
  const result = await input.repository.clearRecalcScope({
    matchId: input.matchId,
    sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
    aggregationVersion: input.versions.aggregationVersion,
    expectedPreviousDimensionKeys: input.expectedPreviousDimensionKeys,
  });
  if (result.scopeStillPresent) {
    logger.info('champion_aggregation_scope_retained', {
      matchId: input.matchId,
      correlationId: input.correlationId,
      code: 'SCOPE_CONCURRENTLY_UPDATED',
      sourceNormalizationVersion: input.versions.sourceNormalizationVersion,
      aggregationVersion: input.versions.aggregationVersion,
    });
  }
  return result.scopeStillPresent;
}

/**
 * Full recalculation for affected keys = previous ∪ current.
 * No increments. Read contributors outside write tx; short write for upserts/deletes/marker.
 *
 * Transaction order:
 * 1) Validate + load scope (outside long tx)
 * 2) Read contributors outside write tx
 * 3) Build accumulators
 * 4) Short write tx: upserts + deletes + COMPLETED marker (eligible only)
 * 5) Commit
 * 6) Cache generation INCR after commit
 * 7) Conditionally clear durable recalc scope (only if unchanged since load)
 */
export async function recalculateForMatch(
  matchId: string,
  versions: { sourceNormalizationVersion: string; aggregationVersion: string },
  deps: ChampionAggregationServiceDeps,
  options?: { correlationId?: string },
): Promise<RecalculateForMatchResult> {
  const { repository, redis, config } = deps;
  const correlationId = options?.correlationId;

  if (
    versions.sourceNormalizationVersion !== config.sourceNormalizationVersion ||
    versions.aggregationVersion !== config.aggregationVersion
  ) {
    logger.info('champion_aggregation_job_skipped', {
      matchId,
      correlationId,
      reason: 'VERSION_MISMATCH',
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      supportedSourceNormalizationVersion: config.sourceNormalizationVersion,
      supportedAggregationVersion: config.aggregationVersion,
    });
    return {
      outcome: 'skipped_version_mismatch',
      reason: 'VERSION_MISMATCH',
      wrote: false,
      scopeRemains: false,
    };
  }

  const scope = await repository.loadRecalcScope({
    matchId,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
  });
  if (!scope) {
    const error = new Error('RECALC_SCOPE_MISSING');
    error.name = 'RECALC_SCOPE_MISSING';
    throw error;
  }
  const previousKeys = scope.previousDimensionKeys;

  const { match, participants } = await repository.loadMatchWithParticipants(matchId);
  const eligibility = evaluateMatchEligibility(match, participants, versions);

  if (eligibility.eligible && eligibility.invalidRankTierCount > 0) {
    logger.warn('champion_aggregation_invalid_rank_tier', {
      matchId,
      correlationId,
      count: eligibility.invalidRankTierCount,
      code: 'INVALID_RANK_TIER_COERCED_UNKNOWN',
    });
  }

  const currentKeys = eligibility.eligible
    ? expandCurrentDimensionKeys(eligibility.contributors)
    : [];
  const affectedKeyStrings = unionDimensionKeys(previousKeys, currentKeys);
  const affectedDims = affectedKeyStrings
    .map((key) => parseChampionAggregateDimensionKey(key))
    .filter((dims): dims is MaterializedChampionDimensions => dims !== null);

  if (affectedDims.length === 0) {
    if (!eligibility.eligible) {
      const scopeRemains = await clearLoadedScope({
        repository,
        matchId,
        versions,
        expectedPreviousDimensionKeys: previousKeys,
        correlationId,
      });
      logger.info('champion_aggregation_job_skipped', {
        matchId,
        correlationId,
        reason: eligibility.reason,
        scopeRemains,
      });
      return {
        outcome: 'skipped_permanently_ineligible',
        reason: eligibility.reason,
        wrote: false,
        rowsDeleted: 0,
        cacheGenerationsIncremented: 0,
        scopeRemains,
      };
    }

    // Eligible with zero keys (should be rare): COMPLETED marker after empty write.
    await repository.writeRecalculation({
      matchId,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      upserts: [],
      deletes: [],
      calculatedAt: new Date(),
      writeCompletedMarker: true,
    });
    const scopeRemains = await clearLoadedScope({
      repository,
      matchId,
      versions,
      expectedPreviousDimensionKeys: previousKeys,
      correlationId,
    });
    return {
      outcome: 'completed',
      keysRecalculated: 0,
      rowsUpserted: 0,
      rowsDeleted: 0,
      cacheGenerationsIncremented: 0,
      wrote: true,
      scopeRemains,
    };
  }

  const { upserts, deletes } = await foldAffectedKeys({
    repository,
    affectedDims,
    versions,
  });

  const calculatedAt = new Date();
  // Always apply full recalc of affected keys (other matches may still contribute).
  // COMPLETED marker only when this match itself is eligible.
  await repository.writeRecalculation({
    matchId,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
    upserts,
    deletes,
    calculatedAt,
    writeCompletedMarker: eligibility.eligible,
  });

  const scopeRemains = await clearLoadedScope({
    repository,
    matchId,
    versions,
    expectedPreviousDimensionKeys: previousKeys,
    correlationId,
  });

  const rowsUpserted = upserts.length;
  const rowsDeleted = deletes.length;

  let cacheGenerationsIncremented = 0;
  if (rowsUpserted > 0 || rowsDeleted > 0) {
    const touched = [...upserts.map((entry) => entry.dims), ...deletes];
    cacheGenerationsIncremented = await incrementChampionStatsCacheGenerations({
      redis,
      scopes: distinctCacheGenerationScopes(touched),
      matchId,
      correlationId,
    });
  }

  if (!eligibility.eligible) {
    logger.info('champion_aggregation_job_skipped', {
      matchId,
      correlationId,
      reason: eligibility.reason,
      rowsUpserted,
      rowsDeleted,
      scopeRemains,
    });
    return {
      outcome: 'skipped_permanently_ineligible',
      reason: eligibility.reason,
      wrote: rowsUpserted > 0 || rowsDeleted > 0,
      rowsDeleted,
      cacheGenerationsIncremented,
      scopeRemains,
    };
  }

  logger.info('champion_aggregation_job_completed', {
    matchId,
    correlationId,
    keysRecalculated: affectedDims.length,
    rowsUpserted,
    rowsDeleted,
    cacheGenerationsIncremented,
    scopeRemains,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
  });

  return {
    outcome: 'completed',
    keysRecalculated: affectedDims.length,
    rowsUpserted,
    rowsDeleted,
    cacheGenerationsIncremented,
    wrote: true,
    scopeRemains,
  };
}
