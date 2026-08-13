import { MatchIngestionStatus, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
  CHAMPION_BUILD_CATEGORIES,
  DEFAULT_BUILD_AGGREGATION_VERSION,
  assessBuildSourceEligibility,
  deriveParticipantBuildContributions,
  goldTotalFromGoldData,
  type BuildParticipantSource,
  type ChampionBuildCategory,
  type ItemStaticClassificationInput,
} from '@league-helper/match-analytics';
import { buildChampionBuildGenerationKey, type PlatformRoute } from '@league-helper/shared';
import { evaluateMatchEligibility } from '../champion-aggregation/eligibility.js';
import { expandDimensionTuplesForRankClassification } from '../champion-aggregation/rank-dimension-keys.js';
import {
  attachEligibleGames,
  recordBuildContribution,
  type BuildAggregateScratch,
} from './build-accumulation.js';

export type RebuildChampionBuildsFilters = {
  patch: string;
  platformRoute: string;
  queueId: number;
  championId?: number;
  categories?: ChampionBuildCategory[];
};

export type RebuildChampionBuildsInput = {
  prisma: PrismaClient;
  redis: Redis;
  dryRun: boolean;
  confirmed: boolean;
  batchSize: number;
  offset: number;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  filters: RebuildChampionBuildsFilters;
};

export type RebuildChampionBuildsReport = {
  ok: boolean;
  dryRun: boolean;
  patch: string;
  platformRoute: string;
  queueId: number;
  matchesScanned: number;
  eligibleParticipants: number;
  itemTimelineEligibleParticipants: number;
  coreBuildEligibleParticipants: number;
  coreBuildIneligibleShort: number;
  itemCatalogSize: number;
  eligibility: Record<ChampionBuildCategory, number>;
  uniqueRows: number;
  upsertsApplied: number;
  deletionsApplied: number;
  cacheGenerationsIncremented: number;
  error?: string;
};

function emptyEligibility(): Record<ChampionBuildCategory, number> {
  return {
    STARTING_ITEMS: 0,
    CORE_BUILD: 0,
    BOOTS: 0,
    RUNES: 0,
    SUMMONER_SPELLS: 0,
    SKILL_SEQUENCE: 0,
    SKILL_PRIORITY: 0,
  };
}

function allowedCategories(filters: RebuildChampionBuildsFilters): Set<ChampionBuildCategory> {
  if (!filters.categories || filters.categories.length === 0) {
    return new Set(CHAMPION_BUILD_CATEGORIES);
  }
  return new Set(filters.categories);
}

async function loadItemCatalog(
  prisma: PrismaClient,
  patch: string,
): Promise<Map<number, ItemStaticClassificationInput>> {
  const patchRow = await prisma.patch.findFirst({
    where: { normalizedMajorMinor: patch },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  if (!patchRow) {
    return new Map();
  }
  const items = await prisma.itemStaticData.findMany({
    where: { patchId: patchRow.id },
    select: {
      itemId: true,
      tags: true,
      goldData: true,
      purchasable: true,
      fromItemIds: true,
      intoItemIds: true,
      consumed: true,
    },
  });
  return new Map(
    items.map((item) => [
      item.itemId,
      {
        itemId: item.itemId,
        tags: item.tags,
        goldTotal: goldTotalFromGoldData(item.goldData),
        purchasable: item.purchasable,
        fromItemIds: item.fromItemIds,
        intoItemIds: item.intoItemIds,
        consumed: item.consumed,
      },
    ]),
  );
}

function toSource(participant: {
  itemIds: number[];
  perkIds: number[];
  statPerkIds: number[];
  primaryPerkStyleId: number | null;
  secondaryPerkStyleId: number | null;
  summonerSpell1Id: number;
  summonerSpell2Id: number;
  skillOrder: number[];
  events: Array<{
    type: string;
    timestampMs: number;
    eventIndex: number;
    itemId: number | null;
    beforeItemId: number | null;
    afterItemId: number | null;
    skillSlot: number | null;
    levelUpType: string | null;
    participantId: number | null;
  }>;
}): BuildParticipantSource {
  return {
    itemIds: participant.itemIds,
    perkIds: participant.perkIds,
    statPerkIds: participant.statPerkIds,
    primaryPerkStyleId: participant.primaryPerkStyleId,
    secondaryPerkStyleId: participant.secondaryPerkStyleId,
    summonerSpell1Id: participant.summonerSpell1Id,
    summonerSpell2Id: participant.summonerSpell2Id,
    skillOrder: participant.skillOrder,
    timelineEvents: participant.events,
  };
}

export async function runRebuildChampionBuilds(
  input: RebuildChampionBuildsInput,
): Promise<{ exitCode: number; report: RebuildChampionBuildsReport }> {
  const report: RebuildChampionBuildsReport = {
    ok: false,
    dryRun: input.dryRun,
    patch: input.filters.patch,
    platformRoute: input.filters.platformRoute,
    queueId: input.filters.queueId,
    matchesScanned: 0,
    eligibleParticipants: 0,
    itemTimelineEligibleParticipants: 0,
    coreBuildEligibleParticipants: 0,
    coreBuildIneligibleShort: 0,
    itemCatalogSize: 0,
    eligibility: emptyEligibility(),
    uniqueRows: 0,
    upsertsApplied: 0,
    deletionsApplied: 0,
    cacheGenerationsIncremented: 0,
  };

  if (!input.dryRun && !input.confirmed) {
    report.error = 'Mutating rebuild requires --confirm or AGGREGATES_REBUILD_BUILDS_CONFIRM=YES';
    return { exitCode: 1, report };
  }

  const catalog = await loadItemCatalog(input.prisma, input.filters.patch);
  report.itemCatalogSize = catalog.size;
  const categories = allowedCategories(input.filters);
  const scratch: BuildAggregateScratch = { rows: new Map(), pools: new Map() };

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
          itemIds: true,
          perkIds: true,
          statPerkIds: true,
          primaryPerkStyleId: true,
          secondaryPerkStyleId: true,
          summonerSpell1Id: true,
          summonerSpell2Id: true,
          skillOrder: true,
        },
      },
      timelineEvents: {
        select: {
          type: true,
          timestampMs: true,
          eventIndex: true,
          participantId: true,
          itemId: true,
          beforeItemId: true,
          afterItemId: true,
          skillSlot: true,
          levelUpType: true,
        },
      },
    },
  });

  report.matchesScanned = matches.length;
  const versions = {
    sourceNormalizationVersion: input.sourceNormalizationVersion,
    aggregationVersion: input.aggregationVersion,
  };

  for (const match of matches) {
    const eligibility = evaluateMatchEligibility(
      {
        id: match.id,
        ingestionStatus: match.ingestionStatus,
        remake: match.remake,
        normalizationVersion: match.normalizationVersion,
        normalizedPatch: match.normalizedPatch,
        platformRoute: match.platformRoute,
        regionalRoute: match.regionalRoute,
        queueId: match.queueId,
        mapId: match.mapId,
        gameMode: match.gameMode,
        gameCreation: match.gameCreation,
        gameEndTimestamp: match.gameEndTimestamp,
        gameDurationSeconds: match.gameDurationSeconds,
      },
      match.participants,
      versions,
    );
    if (!eligibility.eligible) {
      continue;
    }

    const eventsByParticipant = new Map<number, typeof match.timelineEvents>();
    for (const event of match.timelineEvents) {
      if (event.participantId === null) {
        continue;
      }
      const list = eventsByParticipant.get(event.participantId) ?? [];
      list.push(event);
      eventsByParticipant.set(event.participantId, list);
    }

    for (const contributor of eligibility.contributors) {
      if (
        input.filters.championId !== undefined &&
        contributor.base.championId !== input.filters.championId
      ) {
        continue;
      }
      const participant = match.participants.find(
        (row) => row.participantId === contributor.participantId,
      );
      if (!participant) {
        continue;
      }
      if (
        input.filters.championId !== undefined &&
        participant.championId !== input.filters.championId
      ) {
        continue;
      }

      report.eligibleParticipants += 1;
      const source = toSource({
        ...participant,
        events: eventsByParticipant.get(participant.participantId) ?? [],
      });
      const allContributions = deriveParticipantBuildContributions({
        source,
        itemCatalog: catalog,
      });
      if (catalog.size > 0 && assessBuildSourceEligibility(source).itemTimelineEligible) {
        report.itemTimelineEligibleParticipants += 1;
        if (allContributions.some((row) => row.category === 'CORE_BUILD')) {
          report.coreBuildEligibleParticipants += 1;
        } else {
          report.coreBuildIneligibleShort += 1;
        }
      }
      const contributions = allContributions.filter((row) => categories.has(row.category));

      for (const contribution of contributions) {
        report.eligibility[contribution.category] += 1;
        const dimsList = expandDimensionTuplesForRankClassification(
          {
            ...contributor.base,
            aggregationVersion: input.aggregationVersion,
          },
          contributor.rankClassification,
        );
        for (const dims of dimsList) {
          recordBuildContribution(scratch, {
            dims,
            category: contribution.category,
            signature: contribution.signature,
            entityIds: contribution.entityIds,
            auxIds: contribution.auxIds,
            primaryStyleId: contribution.primaryStyleId,
            secondaryStyleId: contribution.secondaryStyleId,
            won: contributor.won,
            matchEndedAt: contributor.matchEndedAt,
          });
        }
      }
    }
  }

  const materialized = attachEligibleGames(scratch);
  report.uniqueRows = materialized.length;

  if (input.dryRun) {
    report.ok = true;
    return { exitCode: 0, report };
  }

  const deleted = await input.prisma.championBuildAggregate.deleteMany({
    where: {
      patch: input.filters.patch,
      platformRoute: input.filters.platformRoute,
      queueId: input.filters.queueId,
      sourceNormalizationVersion: input.sourceNormalizationVersion,
      aggregationVersion: input.aggregationVersion,
      ...(input.filters.championId !== undefined ? { championId: input.filters.championId } : {}),
      ...(input.filters.categories && input.filters.categories.length > 0
        ? {
            category: {
              in: [
                ...categories,
                ...(categories.has('SKILL_PRIORITY') ? (['SKILL_MAX_ORDER'] as const) : []),
              ],
            },
          }
        : {}),
    },
  });
  report.deletionsApplied = deleted.count;

  const now = new Date();
  if (materialized.length > 0) {
    await input.prisma.championBuildAggregate.createMany({
      data: materialized.map((row) => ({
        patch: row.dims.patch,
        platformRoute: row.dims.platformRoute,
        regionalRoute: row.dims.regionalRoute,
        queueId: row.dims.queueId,
        rankTier: row.dims.rankTier,
        teamPosition: row.dims.position,
        championId: row.dims.championId,
        category: row.category,
        signature: row.signature,
        entityIds: row.entityIds,
        auxIds: row.auxIds,
        primaryStyleId: row.primaryStyleId,
        secondaryStyleId: row.secondaryStyleId,
        sampleSize: row.sampleSize,
        wins: row.wins,
        eligibleGames: row.eligibleGames,
        aggregationVersion: row.dims.aggregationVersion,
        sourceNormalizationVersion: row.dims.sourceNormalizationVersion,
        latestEligibleMatchAt: row.latestEligibleMatchAt,
        calculatedAt: now,
      })),
    });
    report.upsertsApplied = materialized.length;
  }

  const genKey = buildChampionBuildGenerationKey({
    sourceNormalizationVersion: input.sourceNormalizationVersion,
    aggregationVersion: input.aggregationVersion,
    platform: input.filters.platformRoute as PlatformRoute,
    patch: input.filters.patch,
    queueId: input.filters.queueId,
  });
  try {
    await input.redis.incr(genKey);
    report.cacheGenerationsIncremented = 1;
  } catch {
    report.cacheGenerationsIncremented = 0;
  }

  report.ok = true;
  return { exitCode: 0, report };
}

export { DEFAULT_BUILD_AGGREGATION_VERSION };
