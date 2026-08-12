import {
  ChampionAggregationProcessingStatus,
  MatchIngestionStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  ALL_POSITION_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  type ChampionAggregateAccumulator,
  type MaterializedChampionDimensions,
} from '@league-helper/match-analytics';
import type {
  MatchEligibilityRow,
  ParticipantEligibilityRow,
} from './eligibility.js';
import { mergeRecalcScopeKeys } from './previous-keys.js';

export type DimensionKeyBatchGroup = {
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  patch: string;
  platformRoute: string;
  regionalRoute: string;
  queueId: number;
  championIds: number[];
  keys: MaterializedChampionDimensions[];
};

export type ContributorQueryRow = {
  match: MatchEligibilityRow;
  participant: ParticipantEligibilityRow;
};

const PARTICIPANT_SELECT = {
  participantId: true,
  championId: true,
  teamId: true,
  teamPosition: true,
  individualPosition: true,
  lane: true,
  role: true,
  rankTierAtIngestion: true,
  rankResolutionStatus: true,
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
} as const;

const MATCH_SELECT = {
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
} as const;

export function parseChampionAggregateDimensionKey(
  key: string,
): MaterializedChampionDimensions | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 9) {
      return null;
    }
    const [
      patch,
      platformRoute,
      regionalRoute,
      queueId,
      rankTier,
      position,
      championId,
      sourceNormalizationVersion,
      aggregationVersion,
    ] = parsed;
    if (
      typeof patch !== 'string' ||
      typeof platformRoute !== 'string' ||
      typeof regionalRoute !== 'string' ||
      typeof queueId !== 'number' ||
      typeof rankTier !== 'string' ||
      typeof position !== 'string' ||
      typeof championId !== 'number' ||
      typeof sourceNormalizationVersion !== 'string' ||
      typeof aggregationVersion !== 'string'
    ) {
      return null;
    }
    return {
      patch,
      platformRoute,
      regionalRoute,
      queueId,
      rankTier: rankTier as MaterializedChampionDimensions['rankTier'],
      position: position as MaterializedChampionDimensions['position'],
      championId,
      sourceNormalizationVersion,
      aggregationVersion,
    };
  } catch {
    return null;
  }
}

/** Group materialized keys by shared match-level batch dimensions. */
export function groupKeysForBatchedReads(
  keys: MaterializedChampionDimensions[],
): DimensionKeyBatchGroup[] {
  const groups = new Map<string, DimensionKeyBatchGroup>();
  for (const key of keys) {
    const groupKey = JSON.stringify([
      key.sourceNormalizationVersion,
      key.aggregationVersion,
      key.patch,
      key.platformRoute,
      key.regionalRoute,
      key.queueId,
    ]);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.keys.push(key);
      if (!existing.championIds.includes(key.championId)) {
        existing.championIds.push(key.championId);
      }
    } else {
      groups.set(groupKey, {
        sourceNormalizationVersion: key.sourceNormalizationVersion,
        aggregationVersion: key.aggregationVersion,
        patch: key.patch,
        platformRoute: key.platformRoute,
        regionalRoute: key.regionalRoute,
        queueId: key.queueId,
        championIds: [key.championId],
        keys: [key],
      });
    }
  }
  return [...groups.values()];
}

export type ChampionAggregationRepository = {
  loadMatchWithParticipants(matchId: string): Promise<{
    match: MatchEligibilityRow | null;
    participants: ParticipantEligibilityRow[];
  }>;
  loadRecalcScope(input: {
    matchId: string;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
  }): Promise<{ previousDimensionKeys: string[] } | null>;
  /**
   * Upsert durable previous keys, **unioning** with any existing row keys.
   * Never discards prior pending keys from a concurrent enqueue.
   */
  upsertRecalcScope(input: {
    matchId: string;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
    previousDimensionKeys: string[];
  }): Promise<{ previousDimensionKeys: string[] }>;
  /**
   * Clear scope only when stored keys still equal the snapshot this job loaded.
   * Concurrent upserts that add keys are preserved (`scopeStillPresent: true`).
   */
  clearRecalcScope(input: {
    matchId: string;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
    expectedPreviousDimensionKeys: string[];
  }): Promise<{ cleared: boolean; scopeStillPresent: boolean }>;
  /** Batched contributor fetch for one shared (versions/patch/platform/region/queue) group. */
  fetchEligibleContributorCandidates(group: DimensionKeyBatchGroup): Promise<ContributorQueryRow[]>;
  writeRecalculation(input: {
    matchId: string;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
    upserts: Array<{ dims: MaterializedChampionDimensions; accumulator: ChampionAggregateAccumulator }>;
    deletes: MaterializedChampionDimensions[];
    calculatedAt: Date;
    /** When false, apply upserts/deletes only (permanently ineligible cleanup). Default true. */
    writeCompletedMarker?: boolean;
  }): Promise<void>;
  markProcessingFailed(input: {
    matchId: string;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
    lastErrorCode: string;
  }): Promise<void>;
  findProcessingMarker(input: {
    matchId: string;
    sourceNormalizationVersion: string;
    aggregationVersion: string;
  }): Promise<{ status: ChampionAggregationProcessingStatus; processedAt: Date } | null>;
};

function parseStoredDimensionKeys(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('INVALID_RECALC_SCOPE_KEYS');
  }
  return mergeRecalcScopeKeys([], value);
}

function assertAccumulatorInvariants(accumulator: ChampionAggregateAccumulator): void {
  if (accumulator.sampleSize < 0 || accumulator.wins < 0 || accumulator.wins > accumulator.sampleSize) {
    throw new Error('AGGREGATE_INVARIANT_VIOLATION');
  }
  if (
    accumulator.goldDifferenceAt10Samples < 0 ||
    accumulator.goldDifferenceAt15Samples < 0 ||
    accumulator.csDifferenceAt10Samples < 0 ||
    accumulator.csDifferenceAt15Samples < 0
  ) {
    throw new Error('AGGREGATE_INVARIANT_VIOLATION');
  }
  if (
    (accumulator.goldDifferenceAt10Samples === 0 && accumulator.totalGoldDifferenceAt10 !== null) ||
    (accumulator.goldDifferenceAt15Samples === 0 && accumulator.totalGoldDifferenceAt15 !== null) ||
    (accumulator.csDifferenceAt10Samples === 0 && accumulator.totalCsDifferenceAt10 !== null) ||
    (accumulator.csDifferenceAt15Samples === 0 && accumulator.totalCsDifferenceAt15 !== null)
  ) {
    throw new Error('AGGREGATE_INVARIANT_VIOLATION');
  }
}

export function createChampionAggregationRepository(
  prisma: PrismaClient,
): ChampionAggregationRepository {
  return {
    async loadMatchWithParticipants(matchId) {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: {
          ...MATCH_SELECT,
          participants: { select: PARTICIPANT_SELECT },
        },
      });
      if (!match) {
        return { match: null, participants: [] };
      }
      const { participants, ...matchRow } = match;
      return {
        match: matchRow as MatchEligibilityRow,
        participants: participants as ParticipantEligibilityRow[],
      };
    },

    async loadRecalcScope(input) {
      const row = await prisma.championAggregationRecalcScope.findUnique({
        where: {
          matchId_sourceNormalizationVersion_aggregationVersion: {
            matchId: input.matchId,
            sourceNormalizationVersion: input.sourceNormalizationVersion,
            aggregationVersion: input.aggregationVersion,
          },
        },
        select: { previousDimensionKeys: true },
      });
      if (!row) {
        return null;
      }
      return { previousDimensionKeys: parseStoredDimensionKeys(row.previousDimensionKeys) };
    },

    async upsertRecalcScope(input) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.championAggregationRecalcScope.findUnique({
          where: {
            matchId_sourceNormalizationVersion_aggregationVersion: {
              matchId: input.matchId,
              sourceNormalizationVersion: input.sourceNormalizationVersion,
              aggregationVersion: input.aggregationVersion,
            },
          },
          select: { previousDimensionKeys: true },
        });
        const existingKeys = existing
          ? parseStoredDimensionKeys(existing.previousDimensionKeys)
          : [];
        const merged = mergeRecalcScopeKeys(existingKeys, input.previousDimensionKeys);

        await tx.championAggregationRecalcScope.upsert({
          where: {
            matchId_sourceNormalizationVersion_aggregationVersion: {
              matchId: input.matchId,
              sourceNormalizationVersion: input.sourceNormalizationVersion,
              aggregationVersion: input.aggregationVersion,
            },
          },
          create: {
            matchId: input.matchId,
            sourceNormalizationVersion: input.sourceNormalizationVersion,
            aggregationVersion: input.aggregationVersion,
            previousDimensionKeys: merged,
          },
          update: {
            previousDimensionKeys: merged,
          },
        });

        return { previousDimensionKeys: merged };
      });
    },

    async clearRecalcScope(input) {
      const expected = mergeRecalcScopeKeys([], input.expectedPreviousDimensionKeys);
      // Conditional delete: only remove the row if keys still match what this job loaded.
      const deleted = await prisma.championAggregationRecalcScope.deleteMany({
        where: {
          matchId: input.matchId,
          sourceNormalizationVersion: input.sourceNormalizationVersion,
          aggregationVersion: input.aggregationVersion,
          previousDimensionKeys: { equals: expected },
        },
      });
      if (deleted.count > 0) {
        return { cleared: true, scopeStillPresent: false };
      }
      const remaining = await prisma.championAggregationRecalcScope.findUnique({
        where: {
          matchId_sourceNormalizationVersion_aggregationVersion: {
            matchId: input.matchId,
            sourceNormalizationVersion: input.sourceNormalizationVersion,
            aggregationVersion: input.aggregationVersion,
          },
        },
        select: { id: true },
      });
      return { cleared: false, scopeStillPresent: remaining !== null };
    },

    async fetchEligibleContributorCandidates(group) {
      if (group.championIds.length === 0) {
        return [];
      }
      const rows = await prisma.matchParticipant.findMany({
        where: {
          championId: { in: group.championIds },
          match: {
            ingestionStatus: MatchIngestionStatus.COMPLETED,
            remake: false,
            normalizationVersion: group.sourceNormalizationVersion,
            normalizedPatch: group.patch,
            platformRoute: group.platformRoute,
            regionalRoute: group.regionalRoute,
            queueId: group.queueId,
          },
        },
        select: {
          ...PARTICIPANT_SELECT,
          match: { select: MATCH_SELECT },
        },
      });
      return rows.map((row) => {
        const { match, ...participant } = row;
        return {
          match: match as MatchEligibilityRow,
          participant: participant as ParticipantEligibilityRow,
        };
      });
    },

    async writeRecalculation(input) {
      await prisma.$transaction(async (tx) => {
        for (const upsert of input.upserts) {
          assertAccumulatorInvariants(upsert.accumulator);
          const dims = upsert.dims;
          const data = {
            sampleSize: upsert.accumulator.sampleSize,
            wins: upsert.accumulator.wins,
            totalKills: upsert.accumulator.totalKills,
            totalDeaths: upsert.accumulator.totalDeaths,
            totalAssists: upsert.accumulator.totalAssists,
            totalCs: upsert.accumulator.totalCs,
            totalGameSeconds: upsert.accumulator.totalGameSeconds,
            totalDamageToChampions: upsert.accumulator.totalDamageToChampions,
            totalVisionScore: upsert.accumulator.totalVisionScore,
            totalGoldDifferenceAt10: upsert.accumulator.totalGoldDifferenceAt10,
            goldDifferenceAt10Samples: upsert.accumulator.goldDifferenceAt10Samples,
            totalGoldDifferenceAt15: upsert.accumulator.totalGoldDifferenceAt15,
            goldDifferenceAt15Samples: upsert.accumulator.goldDifferenceAt15Samples,
            totalCsDifferenceAt10: upsert.accumulator.totalCsDifferenceAt10,
            csDifferenceAt10Samples: upsert.accumulator.csDifferenceAt10Samples,
            totalCsDifferenceAt15: upsert.accumulator.totalCsDifferenceAt15,
            csDifferenceAt15Samples: upsert.accumulator.csDifferenceAt15Samples,
            latestEligibleMatchAt: upsert.accumulator.latestEligibleMatchAt,
            calculatedAt: input.calculatedAt,
            sourceNormalizationVersion: dims.sourceNormalizationVersion,
            aggregationVersion: dims.aggregationVersion,
          };
          await tx.championAggregate.upsert({
            where: {
              patch_platformRoute_regionalRoute_queueId_rankTier_teamPosition_championId_sourceNormalizationVersion_aggregationVersion:
                {
                  patch: dims.patch,
                  platformRoute: dims.platformRoute,
                  regionalRoute: dims.regionalRoute,
                  queueId: dims.queueId,
                  rankTier: dims.rankTier,
                  teamPosition: dims.position,
                  championId: dims.championId,
                  sourceNormalizationVersion: dims.sourceNormalizationVersion,
                  aggregationVersion: dims.aggregationVersion,
                },
            },
            create: {
              patch: dims.patch,
              platformRoute: dims.platformRoute,
              regionalRoute: dims.regionalRoute,
              queueId: dims.queueId,
              rankTier: dims.rankTier,
              teamPosition: dims.position,
              championId: dims.championId,
              ...data,
            },
            update: data,
          });
        }

        for (const dims of input.deletes) {
          await tx.championAggregate.deleteMany({
            where: {
              patch: dims.patch,
              platformRoute: dims.platformRoute,
              regionalRoute: dims.regionalRoute,
              queueId: dims.queueId,
              rankTier: dims.rankTier,
              teamPosition: dims.position,
              championId: dims.championId,
              sourceNormalizationVersion: dims.sourceNormalizationVersion,
              aggregationVersion: dims.aggregationVersion,
            },
          });
        }

        if (input.writeCompletedMarker !== false) {
          await tx.championAggregationProcessing.upsert({
            where: {
              matchId_sourceNormalizationVersion_aggregationVersion: {
                matchId: input.matchId,
                sourceNormalizationVersion: input.sourceNormalizationVersion,
                aggregationVersion: input.aggregationVersion,
              },
            },
            create: {
              matchId: input.matchId,
              sourceNormalizationVersion: input.sourceNormalizationVersion,
              aggregationVersion: input.aggregationVersion,
              status: ChampionAggregationProcessingStatus.COMPLETED,
              processedAt: input.calculatedAt,
              lastErrorCode: null,
            },
            update: {
              status: ChampionAggregationProcessingStatus.COMPLETED,
              processedAt: input.calculatedAt,
              lastErrorCode: null,
            },
          });
        }
      });
    },

    async markProcessingFailed(input) {
      const now = new Date();
      await prisma.championAggregationProcessing.upsert({
        where: {
          matchId_sourceNormalizationVersion_aggregationVersion: {
            matchId: input.matchId,
            sourceNormalizationVersion: input.sourceNormalizationVersion,
            aggregationVersion: input.aggregationVersion,
          },
        },
        create: {
          matchId: input.matchId,
          sourceNormalizationVersion: input.sourceNormalizationVersion,
          aggregationVersion: input.aggregationVersion,
          status: ChampionAggregationProcessingStatus.FAILED,
          processedAt: now,
          lastErrorCode: input.lastErrorCode,
        },
        update: {
          status: ChampionAggregationProcessingStatus.FAILED,
          processedAt: now,
          lastErrorCode: input.lastErrorCode,
        },
      });
    },

    async findProcessingMarker(input) {
      const row = await prisma.championAggregationProcessing.findUnique({
        where: {
          matchId_sourceNormalizationVersion_aggregationVersion: {
            matchId: input.matchId,
            sourceNormalizationVersion: input.sourceNormalizationVersion,
            aggregationVersion: input.aggregationVersion,
          },
        },
        select: { status: true, processedAt: true },
      });
      return row;
    },
  };
}

/** Whether a contributor's exact dims feed a materialized key (including ALL rollups). */
export function contributorMatchesMaterializedKey(
  exactRankTier: string,
  exactPosition: string,
  exactChampionId: number,
  key: MaterializedChampionDimensions,
): boolean {
  if (exactChampionId !== key.championId) {
    return false;
  }
  const tierOk = key.rankTier === ALL_RANK_TIER_SENTINEL || key.rankTier === exactRankTier;
  const positionOk = key.position === ALL_POSITION_SENTINEL || key.position === exactPosition;
  return tierOk && positionOk;
}

export type { Prisma };
