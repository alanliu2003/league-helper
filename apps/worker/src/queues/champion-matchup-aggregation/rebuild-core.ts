import { MatchIngestionStatus, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  DEFAULT_MATCHUP_AGGREGATION_VERSION,
  accumulateMatchupContribution,
  buildMatchupAggregateDimensionKey,
  emptyMatchupAccumulator,
  expandMatchupRankTiers,
  pairLaneOpponents,
  type LanePairSkipReason,
  type MatchupAggregateAccumulator,
  type MatchupAggregateDimensions,
} from '@league-helper/match-analytics';
import { buildChampionMatchupGenerationKey, type PlatformRoute } from '@league-helper/shared';
import { evaluateMatchEligibility } from '../champion-aggregation/eligibility.js';

export type RebuildChampionMatchupsFilters = {
  patch: string;
  platformRoute: string;
  queueId: number;
  championId?: number;
  position?: string;
};

export type RebuildChampionMatchupsInput = {
  prisma: PrismaClient;
  redis: Redis;
  dryRun: boolean;
  confirmed: boolean;
  batchSize: number;
  offset: number;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  filters: RebuildChampionMatchupsFilters;
};

export type RebuildChampionMatchupsReport = {
  ok: boolean;
  dryRun: boolean;
  patch: string;
  platformRoute: string;
  queueId: number;
  matchesScanned: number;
  eligibleMatches: number;
  matchesWithAllFivePairs: number;
  directionalObservations: number;
  uniqueRows: number;
  upsertsApplied: number;
  deletionsApplied: number;
  cacheGenerationsIncremented: number;
  skips: Record<LanePairSkipReason, number>;
  error?: string;
};

type ScratchRow = {
  dims: MatchupAggregateDimensions;
  accumulator: MatchupAggregateAccumulator;
};

function emptySkips(): Record<LanePairSkipReason, number> {
  return {
    UNKNOWN_POSITION: 0,
    DUPLICATE_POSITION: 0,
    MISSING_OPPONENT: 0,
    MALFORMED_TEAM: 0,
    SAME_CHAMPION_MIRROR: 0,
  };
}

function pairIdentity(dims: Pick<MatchupAggregateDimensions, 'championId' | 'opponentChampionId' | 'position'>): string {
  return `${dims.championId}:${dims.opponentChampionId}:${dims.position}`;
}

async function scanAndAccumulate(input: {
  prisma: PrismaClient;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  filters: RebuildChampionMatchupsFilters;
  batchSize: number;
  offset: number;
}): Promise<{
  scratch: Map<string, ScratchRow>;
  matchesScanned: number;
  eligibleMatches: number;
  matchesWithAllFivePairs: number;
  directionalObservations: number;
  skips: Record<LanePairSkipReason, number>;
}> {
  const scratch = new Map<string, ScratchRow>();
  const skips = emptySkips();
  let matchesScanned = 0;
  let eligibleMatches = 0;
  let matchesWithAllFivePairs = 0;
  let directionalObservations = 0;

  const matches = await input.prisma.match.findMany({
    where: {
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      remake: false,
      normalizationVersion: input.sourceNormalizationVersion,
      normalizedPatch: input.filters.patch,
      platformRoute: input.filters.platformRoute,
      queueId: input.filters.queueId,
    },
    orderBy: { id: 'asc' },
    skip: input.offset,
    take: input.batchSize,
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
        },
      },
    },
  });

  matchesScanned = matches.length;

  for (const match of matches) {
    const eligibility = evaluateMatchEligibility(match, match.participants, {
      sourceNormalizationVersion: input.sourceNormalizationVersion,
      aggregationVersion: input.aggregationVersion,
    });
    if (!eligibility.eligible) {
      continue;
    }
    eligibleMatches += 1;

    const contributorsById = new Map(
      eligibility.contributors.map((contributor) => [contributor.participantId, contributor]),
    );
    const pairingRows = match.participants.flatMap((participant) => {
      const contributor = contributorsById.get(participant.participantId);
      if (!contributor) {
        return [];
      }
      return [
        {
          participantId: participant.participantId,
          teamId: participant.teamId,
          championId: contributor.base.championId,
          position: contributor.base.position,
          win: contributor.won,
          rankClassification: contributor.rankClassification,
          goldDifferenceAt10: contributor.goldDifferenceAt10,
          goldDifferenceAt15: contributor.goldDifferenceAt15,
          csDifferenceAt10: contributor.csDifferenceAt10,
          csDifferenceAt15: contributor.csDifferenceAt15,
          matchEndedAt: contributor.matchEndedAt,
          base: contributor.base,
        },
      ];
    });

    const paired = pairLaneOpponents(pairingRows);
    for (const reason of Object.keys(paired.skips) as LanePairSkipReason[]) {
      skips[reason] += paired.skips[reason];
    }
    if (paired.matchesAllFive) {
      matchesWithAllFivePairs += 1;
    }

    for (const observation of paired.directional) {
      if (
        input.filters.championId !== undefined &&
        observation.subject.championId !== input.filters.championId
      ) {
        continue;
      }
      if (input.filters.position && observation.position !== input.filters.position) {
        continue;
      }
      directionalObservations += 1;
      const rankTiers = expandMatchupRankTiers(observation.subject.rankClassification);
      for (const rankTier of rankTiers) {
        const dims: MatchupAggregateDimensions = {
          patch: observation.subject.base.patch,
          platformRoute: observation.subject.base.platformRoute,
          regionalRoute: observation.subject.base.regionalRoute,
          queueId: observation.subject.base.queueId,
          rankTier,
          position: observation.position,
          championId: observation.subject.championId,
          opponentChampionId: observation.opponent.championId,
          sourceNormalizationVersion: input.sourceNormalizationVersion,
          aggregationVersion: input.aggregationVersion,
        };
        const key = buildMatchupAggregateDimensionKey(dims);
        const current = scratch.get(key)?.accumulator ?? emptyMatchupAccumulator();
        scratch.set(key, {
          dims,
          accumulator: accumulateMatchupContribution(current, {
            championId: observation.subject.championId,
            opponentChampionId: observation.opponent.championId,
            won: observation.won,
            goldDifferenceAt10: observation.subject.goldDifferenceAt10,
            goldDifferenceAt15: observation.subject.goldDifferenceAt15,
            csDifferenceAt10: observation.subject.csDifferenceAt10,
            csDifferenceAt15: observation.subject.csDifferenceAt15,
            matchEndedAt: observation.subject.matchEndedAt,
          }),
        });
      }
    }
  }

  return {
    scratch,
    matchesScanned,
    eligibleMatches,
    matchesWithAllFivePairs,
    directionalObservations,
    skips,
  };
}

export async function runRebuildChampionMatchups(
  input: RebuildChampionMatchupsInput,
): Promise<{ exitCode: number; report: RebuildChampionMatchupsReport }> {
  const report: RebuildChampionMatchupsReport = {
    ok: false,
    dryRun: input.dryRun,
    patch: input.filters.patch,
    platformRoute: input.filters.platformRoute,
    queueId: input.filters.queueId,
    matchesScanned: 0,
    eligibleMatches: 0,
    matchesWithAllFivePairs: 0,
    directionalObservations: 0,
    uniqueRows: 0,
    upsertsApplied: 0,
    deletionsApplied: 0,
    cacheGenerationsIncremented: 0,
    skips: emptySkips(),
  };

  if (!input.dryRun && !input.confirmed) {
    report.error =
      'Mutating rebuild requires --confirm or AGGREGATES_REBUILD_MATCHUPS_CONFIRM=YES';
    return { exitCode: 1, report };
  }

  const scanned = await scanAndAccumulate(input);
  report.matchesScanned = scanned.matchesScanned;
  report.eligibleMatches = scanned.eligibleMatches;
  report.matchesWithAllFivePairs = scanned.matchesWithAllFivePairs;
  report.directionalObservations = scanned.directionalObservations;
  report.skips = scanned.skips;
  const materialized = [...scanned.scratch.values()].filter((row) => row.accumulator.sampleSize > 0);
  report.uniqueRows = materialized.length;

  if (input.dryRun) {
    report.ok = true;
    return { exitCode: 0, report };
  }

  const deleted = await input.prisma.matchupAggregate.deleteMany({
    where: {
      patch: input.filters.patch,
      platformRoute: input.filters.platformRoute,
      queueId: input.filters.queueId,
      sourceNormalizationVersion: input.sourceNormalizationVersion,
      aggregationVersion: input.aggregationVersion,
      ...(input.filters.championId !== undefined ? { championId: input.filters.championId } : {}),
      ...(input.filters.position ? { teamPosition: input.filters.position } : {}),
    },
  });
  report.deletionsApplied = deleted.count;

  const now = new Date();
  if (materialized.length > 0) {
    await input.prisma.matchupAggregate.createMany({
      data: materialized.map((row) => ({
        patch: row.dims.patch,
        platformRoute: row.dims.platformRoute,
        regionalRoute: row.dims.regionalRoute,
        queueId: row.dims.queueId,
        rankTier: row.dims.rankTier,
        teamPosition: row.dims.position,
        championId: row.dims.championId,
        opponentChampionId: row.dims.opponentChampionId,
        sampleSize: row.accumulator.sampleSize,
        wins: row.accumulator.wins,
        totalGoldDifferenceAt10: row.accumulator.totalGoldDifferenceAt10,
        goldDifferenceAt10Samples: row.accumulator.goldDifferenceAt10Samples,
        totalGoldDifferenceAt15: row.accumulator.totalGoldDifferenceAt15,
        goldDifferenceAt15Samples: row.accumulator.goldDifferenceAt15Samples,
        totalCsDifferenceAt10: row.accumulator.totalCsDifferenceAt10,
        csDifferenceAt10Samples: row.accumulator.csDifferenceAt10Samples,
        totalCsDifferenceAt15: row.accumulator.totalCsDifferenceAt15,
        csDifferenceAt15Samples: row.accumulator.csDifferenceAt15Samples,
        aggregationVersion: row.dims.aggregationVersion,
        sourceNormalizationVersion: row.dims.sourceNormalizationVersion,
        latestEligibleMatchAt: row.accumulator.latestEligibleMatchAt,
        calculatedAt: now,
      })),
    });
    report.upsertsApplied = materialized.length;
  }

  try {
    await input.redis.incr(
      buildChampionMatchupGenerationKey({
        sourceNormalizationVersion: input.sourceNormalizationVersion,
        aggregationVersion: input.aggregationVersion,
        platform: input.filters.platformRoute as PlatformRoute,
        patch: input.filters.patch,
        queueId: input.filters.queueId,
      }),
    );
    report.cacheGenerationsIncremented = 1;
  } catch {
    report.cacheGenerationsIncremented = 0;
  }

  report.ok = true;
  return { exitCode: 0, report };
}

export type RecalculateMatchupsForMatchInput = {
  prisma: PrismaClient;
  redis: Redis;
  matchId: string;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
};

/**
 * Source-derived affected-key recompute for one ingested match.
 * Scans the match's patch/platform/queue once, then upserts/deletes only pair
 * identities touched by this match (including existing rank rows for those pairs).
 */
export async function recalculateMatchupsForMatch(
  input: RecalculateMatchupsForMatchInput,
): Promise<{ upserts: number; deletions: number }> {
  const match = await input.prisma.match.findUnique({
    where: { id: input.matchId },
    select: {
      id: true,
      ingestionStatus: true,
      remake: true,
      normalizationVersion: true,
      normalizedPatch: true,
      platformRoute: true,
      queueId: true,
      regionalRoute: true,
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
        },
      },
    },
  });
  if (!match?.normalizedPatch || !match.platformRoute) {
    return { upserts: 0, deletions: 0 };
  }

  const eligibility = evaluateMatchEligibility(match, match.participants, {
    sourceNormalizationVersion: input.sourceNormalizationVersion,
    aggregationVersion: input.aggregationVersion,
  });
  if (!eligibility.eligible) {
    return { upserts: 0, deletions: 0 };
  }

  const contributorsById = new Map(
    eligibility.contributors.map((contributor) => [contributor.participantId, contributor]),
  );
  const pairingRows = match.participants.flatMap((participant) => {
    const contributor = contributorsById.get(participant.participantId);
    if (!contributor) {
      return [];
    }
    return [
      {
        participantId: participant.participantId,
        teamId: participant.teamId,
        championId: contributor.base.championId,
        position: contributor.base.position,
        win: contributor.won,
      },
    ];
  });
  const paired = pairLaneOpponents(pairingRows);
  const identities = new Set(
    paired.directional.map((row) =>
      pairIdentity({
        championId: row.subject.championId,
        opponentChampionId: row.opponent.championId,
        position: row.position,
      }),
    ),
  );
  if (identities.size === 0) {
    return { upserts: 0, deletions: 0 };
  }

  const existing = await input.prisma.matchupAggregate.findMany({
    where: {
      patch: match.normalizedPatch,
      platformRoute: match.platformRoute,
      queueId: match.queueId,
      sourceNormalizationVersion: input.sourceNormalizationVersion,
      aggregationVersion: input.aggregationVersion,
      OR: paired.directional.map((row) => ({
        championId: row.subject.championId,
        opponentChampionId: row.opponent.championId,
        teamPosition: row.position,
      })),
    },
    select: { championId: true, opponentChampionId: true, teamPosition: true, rankTier: true },
  });
  for (const row of existing) {
    identities.add(
      pairIdentity({
        championId: row.championId,
        opponentChampionId: row.opponentChampionId,
        position: row.teamPosition,
      }),
    );
  }

  const scanned = await scanAndAccumulate({
    prisma: input.prisma,
    sourceNormalizationVersion: input.sourceNormalizationVersion,
    aggregationVersion: input.aggregationVersion,
    filters: {
      patch: match.normalizedPatch,
      platformRoute: match.platformRoute,
      queueId: match.queueId,
    },
    batchSize: 50_000,
    offset: 0,
  });

  const now = new Date();
  const affectedRows = [...scanned.scratch.values()].filter(
    (row) => identities.has(pairIdentity(row.dims)) && row.accumulator.sampleSize > 0,
  );
  const deleted = await input.prisma.matchupAggregate.deleteMany({
    where: {
      patch: match.normalizedPatch,
      platformRoute: match.platformRoute,
      queueId: match.queueId,
      sourceNormalizationVersion: input.sourceNormalizationVersion,
      aggregationVersion: input.aggregationVersion,
      OR: [...identities].map((identity) => {
        const [championId, opponentChampionId, position] = identity.split(':');
        return {
          championId: Number(championId),
          opponentChampionId: Number(opponentChampionId),
          teamPosition: position ?? '',
        };
      }),
    },
  });
  const deletions = deleted.count;
  if (affectedRows.length > 0) {
    await input.prisma.matchupAggregate.createMany({
      data: affectedRows.map((row) => ({
        patch: row.dims.patch,
        platformRoute: row.dims.platformRoute,
        regionalRoute: row.dims.regionalRoute,
        queueId: row.dims.queueId,
        rankTier: row.dims.rankTier,
        teamPosition: row.dims.position,
        championId: row.dims.championId,
        opponentChampionId: row.dims.opponentChampionId,
        sampleSize: row.accumulator.sampleSize,
        wins: row.accumulator.wins,
        totalGoldDifferenceAt10: row.accumulator.totalGoldDifferenceAt10,
        goldDifferenceAt10Samples: row.accumulator.goldDifferenceAt10Samples,
        totalGoldDifferenceAt15: row.accumulator.totalGoldDifferenceAt15,
        goldDifferenceAt15Samples: row.accumulator.goldDifferenceAt15Samples,
        totalCsDifferenceAt10: row.accumulator.totalCsDifferenceAt10,
        csDifferenceAt10Samples: row.accumulator.csDifferenceAt10Samples,
        totalCsDifferenceAt15: row.accumulator.totalCsDifferenceAt15,
        csDifferenceAt15Samples: row.accumulator.csDifferenceAt15Samples,
        aggregationVersion: row.dims.aggregationVersion,
        sourceNormalizationVersion: row.dims.sourceNormalizationVersion,
        latestEligibleMatchAt: row.accumulator.latestEligibleMatchAt,
        calculatedAt: now,
      })),
    });
  }
  const upserts = affectedRows.length;

  try {
    await input.redis.incr(
      buildChampionMatchupGenerationKey({
        sourceNormalizationVersion: input.sourceNormalizationVersion,
        aggregationVersion: input.aggregationVersion,
        platform: match.platformRoute as PlatformRoute,
        patch: match.normalizedPatch,
        queueId: match.queueId,
      }),
    );
  } catch {
    // Cache generation is best-effort, matching champion/build aggregation.
  }

  return { upserts, deletions };
}

export { DEFAULT_MATCHUP_AGGREGATION_VERSION };
