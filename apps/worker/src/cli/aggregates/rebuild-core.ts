import type { PrismaClient } from '@prisma/client';
import { MatchIngestionStatus } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  accumulateContribution,
  buildChampionAggregateDimensionKey,
  emptyAccumulator,
  expandChampionDimensionTuples,
  type ChampionAggregateAccumulator,
  type ChampionRollupPolicy,
  type MaterializedChampionDimensions,
} from '@league-helper/match-analytics';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import {
  contributorMatchesMaterializedKey,
  createChampionAggregationRepository,
  groupKeysForBatchedReads,
  type ChampionAggregationRepository,
} from '../../queues/champion-aggregation/champion-aggregation.repository.js';
import {
  distinctCacheGenerationScopes,
  incrementChampionStatsCacheGenerations,
} from '../../queues/champion-aggregation/cache-generation-invalidator.js';
import { evaluateMatchEligibility } from '../../queues/champion-aggregation/eligibility.js';
import type { AggregateCliFilters } from './parse-args.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

/**
 * Placeholder matchId for rebuild batch writes.
 * `writeCompletedMarker: false` means the repository never touches processing markers,
 * so this value is unused for marker FK semantics — only satisfies the write API shape.
 * Do not treat this as a real match.
 */
export const REBUILD_WRITE_MATCH_ID = '00000000-0000-4000-8000-00000000f11d';

export type RebuildChampionAggregatesInput = {
  prisma: PrismaClient;
  redis: Redis;
  config: ChampionAggregationWorkerConfig;
  dryRun: boolean;
  confirmed: boolean;
  batchSize: number;
  filters: AggregateCliFilters;
  rollupPolicy: ChampionRollupPolicy;
  /** Explicit versions for this rebuild (defaults to config). */
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  /** Configured incremental version — used to guard non-default rollups. */
  currentIncrementalAggregationVersion: string;
  nonDefaultRollupRequested: boolean;
};

export type RebuildChampionAggregatesReport = {
  ok: boolean;
  dryRun: boolean;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  eligibleMatches: number;
  eligibleParticipants: number;
  estimatedMaterializedTuples: number;
  affectedAggregateKeys: number;
  expectedUpserts: number;
  expectedDeletions: number;
  upsertsApplied: number;
  deletionsApplied: number;
  cacheGenerationsIncremented: number;
  batchesCompleted: number;
  markersUpdated: number;
  /** Set when --champion filter skips processing-marker updates (partial match rebuild). */
  markersSkippedReason?: string;
  scopesCleared: number;
  error?: string;
};

export type RebuildChampionAggregatesResult = {
  exitCode: number;
  report: RebuildChampionAggregatesReport;
};

function matchWhere(filters: AggregateCliFilters, sourceNormalizationVersion: string) {
  return {
    ingestionStatus: MatchIngestionStatus.COMPLETED,
    remake: false,
    normalizationVersion: sourceNormalizationVersion,
    ...(filters.patch ? { normalizedPatch: filters.patch } : {}),
    ...(filters.queueId !== undefined ? { queueId: filters.queueId } : {}),
    ...(filters.platformRoute ? { platformRoute: filters.platformRoute } : {}),
  };
}

function aggregateWhere(
  filters: AggregateCliFilters,
  sourceNormalizationVersion: string,
  aggregationVersion: string,
) {
  return {
    sourceNormalizationVersion,
    aggregationVersion,
    ...(filters.patch ? { patch: filters.patch } : {}),
    ...(filters.queueId !== undefined ? { queueId: filters.queueId } : {}),
    ...(filters.platformRoute ? { platformRoute: filters.platformRoute } : {}),
    ...(filters.championId !== undefined ? { championId: filters.championId } : {}),
  };
}

function contributorFeedsKey(
  exact: {
    patch: string;
    platformRoute: string;
    regionalRoute: string;
    queueId: number;
    rankTier: string;
    position: string;
    championId: number;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
  },
  key: MaterializedChampionDimensions,
): boolean {
  if (
    exact.patch !== key.patch ||
    exact.platformRoute !== key.platformRoute ||
    exact.regionalRoute !== key.regionalRoute ||
    exact.queueId !== key.queueId ||
    exact.sourceNormalizationVersion !== key.sourceNormalizationVersion ||
    exact.aggregationVersion !== key.aggregationVersion
  ) {
    return false;
  }
  return contributorMatchesMaterializedKey(
    exact.rankTier,
    exact.position,
    exact.championId,
    key,
  );
}

async function foldKeys(input: {
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
      const eligibility = evaluateMatchEligibility(row.match, [row.participant], input.versions);
      if (!eligibility.eligible) {
        continue;
      }
      for (const contributor of eligibility.contributors) {
        for (const key of group.keys) {
          if (!contributorFeedsKey(contributor.exact, key)) {
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Rebuild champion aggregates for the selected filter/version scope.
 *
 * Deletion scope is limited to rows matching selected versions + filters.
 * Older aggregationVersion rows are never touched.
 */
export async function runRebuildChampionAggregates(
  input: RebuildChampionAggregatesInput,
): Promise<RebuildChampionAggregatesResult> {
  const versions = {
    sourceNormalizationVersion: input.sourceNormalizationVersion,
    aggregationVersion: input.aggregationVersion,
  };

  const baseReport: RebuildChampionAggregatesReport = {
    ok: false,
    dryRun: input.dryRun,
    sourceNormalizationVersion: versions.sourceNormalizationVersion,
    aggregationVersion: versions.aggregationVersion,
    eligibleMatches: 0,
    eligibleParticipants: 0,
    estimatedMaterializedTuples: 0,
    affectedAggregateKeys: 0,
    expectedUpserts: 0,
    expectedDeletions: 0,
    upsertsApplied: 0,
    deletionsApplied: 0,
    cacheGenerationsIncremented: 0,
    batchesCompleted: 0,
    markersUpdated: 0,
    scopesCleared: 0,
  };

  if (
    input.nonDefaultRollupRequested &&
    !input.dryRun &&
    input.aggregationVersion === input.currentIncrementalAggregationVersion
  ) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ...baseReport,
        error:
          'Non-default ALL rollup flags require --dry-run or --aggregation-version different from the current incremental version.',
      },
    };
  }

  if (
    (input.rollupPolicy.includeAllPlatform ||
      input.rollupPolicy.includeAllRegionalRoute ||
      input.rollupPolicy.includeAllQueue) &&
    !input.dryRun
  ) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ...baseReport,
        error:
          'ALL platform/regionalRoute/queue materialization is reserved and cannot be applied. Use --dry-run only.',
      },
    };
  }

  if (!input.dryRun && !input.confirmed) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ...baseReport,
        error:
          'Rebuild apply requires --confirm or AGGREGATES_REBUILD_CHAMPIONS_CONFIRM=YES.',
      },
    };
  }

  const repository = createChampionAggregationRepository(input.prisma);

  const matches = await input.prisma.match.findMany({
    where: matchWhere(input.filters, versions.sourceNormalizationVersion),
    select: {
      id: true,
      ingestionStatus: true,
      remake: true,
      normalizationVersion: true,
      normalizedPatch: true,
      platformRoute: true,
      regionalRoute: true,
      queueId: true,
      mapId: true,
      gameMode: true,
      gameCreation: true,
      gameEndTimestamp: true,
      gameDurationSeconds: true,
      participants: {
        select: {
          participantId: true,
          championId: true,
          teamId: true,
          teamPosition: true,
          individualPosition: true,
          lane: true,
          role: true,
          rankTierAtIngestion: true,
          win: true,
          kills: true,
          deaths: true,
          assists: true,
          totalCs: true,
          timePlayedSeconds: true,
          totalDamageDealtToChampions: true,
          visionScore: true,
          goldDifferenceAt10: true,
          goldDifferenceAt15: true,
          csDifferenceAt10: true,
          csDifferenceAt15: true,
        },
        ...(input.filters.championId !== undefined
          ? { where: { championId: input.filters.championId } }
          : {}),
      },
    },
  });

  const keyMap = new Map<string, MaterializedChampionDimensions>();
  const eligibleMatchIds: string[] = [];
  let eligibleParticipants = 0;

  for (const match of matches) {
    const { participants, ...matchRow } = match;
    const eligibility = evaluateMatchEligibility(matchRow, participants, versions);
    if (!eligibility.eligible) {
      continue;
    }
    eligibleMatchIds.push(match.id);
    eligibleParticipants += eligibility.contributors.length;
    for (const contributor of eligibility.contributors) {
      if (
        input.filters.championId !== undefined &&
        contributor.exact.championId !== input.filters.championId
      ) {
        continue;
      }
      try {
        for (const materialized of expandChampionDimensionTuples(
          contributor.exact,
          input.rollupPolicy,
        )) {
          keyMap.set(buildChampionAggregateDimensionKey(materialized), materialized);
        }
      } catch {
        // Reserved ALL dims throw during expand — skip for dry-run estimate of supported keys.
        if (!input.dryRun) {
          throw new Error('ROLLUP_EXPAND_FAILED');
        }
      }
    }
  }

  // Existing rows in scope may need deletion even if no current contributor emits the key.
  const existingRows = await input.prisma.championAggregate.findMany({
    where: aggregateWhere(
      input.filters,
      versions.sourceNormalizationVersion,
      versions.aggregationVersion,
    ),
    select: {
      patch: true,
      platformRoute: true,
      regionalRoute: true,
      queueId: true,
      rankTier: true,
      teamPosition: true,
      championId: true,
      sourceNormalizationVersion: true,
      aggregationVersion: true,
    },
  });

  for (const row of existingRows) {
    const dims: MaterializedChampionDimensions = {
      patch: row.patch,
      platformRoute: row.platformRoute as MaterializedChampionDimensions['platformRoute'],
      regionalRoute: row.regionalRoute as MaterializedChampionDimensions['regionalRoute'],
      queueId: row.queueId,
      rankTier: row.rankTier as MaterializedChampionDimensions['rankTier'],
      position: row.teamPosition as MaterializedChampionDimensions['position'],
      championId: row.championId,
      sourceNormalizationVersion: row.sourceNormalizationVersion,
      aggregationVersion: row.aggregationVersion,
    };
    keyMap.set(buildChampionAggregateDimensionKey(dims), dims);
  }

  const affectedDims = [...keyMap.values()];
  const { upserts, deletes } = await foldKeys({
    repository,
    affectedDims,
    versions,
  });

  const report: RebuildChampionAggregatesReport = {
    ...baseReport,
    ok: true,
    eligibleMatches: eligibleMatchIds.length,
    eligibleParticipants,
    estimatedMaterializedTuples: affectedDims.length,
    affectedAggregateKeys: affectedDims.length,
    expectedUpserts: upserts.length,
    expectedDeletions: deletes.length,
  };

  if (input.dryRun) {
    return { exitCode: EXIT_SUCCESS, report };
  }

  const batches = chunk(affectedDims, input.batchSize);
  let upsertsApplied = 0;
  let deletionsApplied = 0;
  let cacheGenerationsIncremented = 0;
  let batchesCompleted = 0;
  // Participant-level --champion filter rebuilds only a subset of keys for a match.
  // Writing COMPLETED would falsely tell reconcile the whole match is current.
  const matchCompleteForMarkers = input.filters.championId === undefined;

  try {
    for (const batch of batches) {
      const folded = await foldKeys({ repository, affectedDims: batch, versions });
      const calculatedAt = new Date();
      await repository.writeRecalculation({
        matchId: REBUILD_WRITE_MATCH_ID,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
        upserts: folded.upserts,
        deletes: folded.deletes,
        calculatedAt,
        writeCompletedMarker: false,
      });

      if (folded.upserts.length > 0 || folded.deletes.length > 0) {
        const touched = [
          ...folded.upserts.map((entry) => entry.dims),
          ...folded.deletes,
        ];
        cacheGenerationsIncremented += await incrementChampionStatsCacheGenerations({
          redis: input.redis,
          scopes: distinctCacheGenerationScopes(touched),
          matchId: REBUILD_WRITE_MATCH_ID,
          correlationId: 'aggregates-rebuild-champions',
        });
      }

      upsertsApplied += folded.upserts.length;
      deletionsApplied += folded.deletes.length;
      batchesCompleted += 1;
    }

    let markersUpdated = 0;
    let scopesCleared = 0;
    let markersSkippedReason: string | undefined;

    if (!matchCompleteForMarkers) {
      markersSkippedReason =
        'champion filter is participant-scoped; processing markers are not updated';
    } else {
      const now = new Date();
      for (const matchId of eligibleMatchIds) {
        await input.prisma.championAggregationProcessing.upsert({
          where: {
            matchId_sourceNormalizationVersion_aggregationVersion: {
              matchId,
              sourceNormalizationVersion: versions.sourceNormalizationVersion,
              aggregationVersion: versions.aggregationVersion,
            },
          },
          create: {
            matchId,
            sourceNormalizationVersion: versions.sourceNormalizationVersion,
            aggregationVersion: versions.aggregationVersion,
            status: 'COMPLETED',
            processedAt: now,
            lastErrorCode: null,
          },
          update: {
            status: 'COMPLETED',
            processedAt: now,
            lastErrorCode: null,
          },
        });
        markersUpdated += 1;
      }

      // Match-complete rebuild supersedes pending per-match recalc scopes for these versions.
      if (eligibleMatchIds.length > 0) {
        const cleared = await input.prisma.championAggregationRecalcScope.deleteMany({
          where: {
            matchId: { in: eligibleMatchIds },
            sourceNormalizationVersion: versions.sourceNormalizationVersion,
            aggregationVersion: versions.aggregationVersion,
          },
        });
        scopesCleared = cleared.count;
      }
    }

    return {
      exitCode: EXIT_SUCCESS,
      report: {
        ...report,
        upsertsApplied,
        deletionsApplied,
        cacheGenerationsIncremented,
        batchesCompleted,
        markersUpdated,
        ...(markersSkippedReason ? { markersSkippedReason } : {}),
        scopesCleared,
      },
    };
  } catch (error: unknown) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ...report,
        ok: false,
        upsertsApplied,
        deletionsApplied,
        cacheGenerationsIncremented,
        batchesCompleted,
        error: error instanceof Error ? error.message.slice(0, 200) : 'BATCH_FAILURE',
      },
    };
  }
}
