import {
  DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
  deriveChampionAggregateMetrics,
  type ChampionAggregateAccumulator,
} from '@league-helper/match-analytics';
import {
  AggregateDimensionsSchema,
  ChampionAggregateMetricsSchema,
  ChampionAggregateRowSchema,
  ChampionDetailSchema,
  ChampionSummarySchema,
  extractChampionAbilities,
  type AggregateDimensions,
  type ChampionAggregateMetrics,
  type ChampionAggregateRow,
  type ChampionDetail,
  type ChampionRankingPosition,
  type ChampionSummary,
  type PlatformRoute,
  type RegionalRoute,
} from '@league-helper/shared';
import type { ChampionAggregate } from '@prisma/client';
import type { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import type { ChampionStaticRow } from '../../persistence/champion-static.repository';

export function mapChampionSummary(
  row: ChampionStaticRow,
  media: DataDragonChampionService,
): ChampionSummary {
  const version = row.dataDragonVersion?.trim() || null;
  const iconUrl = version !== null ? media.buildChampionIconUrl(row.championKey, version) : null;
  const splashUrl = media.buildChampionSplashUrl(row.championKey);

  return ChampionSummarySchema.parse({
    championId: row.championId,
    championKey: row.championKey,
    name: row.name,
    title: row.title,
    tags: row.tags,
    iconUrl,
    splashUrl,
    staticDataPatch: row.patchVersion,
    staticDataVersion: version ?? undefined,
  });
}

export function mapChampionDetail(
  row: ChampionStaticRow,
  media: DataDragonChampionService,
  options: { requestedKey?: string } = {},
): ChampionDetail {
  const summary = mapChampionSummary(row, media);
  const requested = options.requestedKey?.trim();
  const canonical =
    requested !== undefined && requested.length > 0 && requested !== row.championKey
      ? row.championKey
      : undefined;

  return ChampionDetailSchema.parse({
    ...summary,
    ...(canonical !== undefined ? { canonicalChampionKey: canonical } : {}),
    ...abilityFields(row, media),
  });
}

function abilityFields(
  row: ChampionStaticRow,
  media: DataDragonChampionService,
): { abilities?: ChampionDetail['abilities'] } {
  const abilities = extractChampionAbilities(
    { passive: row.passive, spells: row.spells },
    {
      version: row.dataDragonVersion,
      buildPassiveIconUrl: (imageFull, version) => media.buildPassiveIconUrl(imageFull, version),
      buildSpellIconUrl: (imageFull, version) => media.buildSpellIconUrl(imageFull, version),
    },
  );
  return abilities.length > 0 ? { abilities } : {};
}

export function toAccumulator(row: ChampionAggregate): ChampionAggregateAccumulator {
  return {
    sampleSize: row.sampleSize,
    wins: row.wins,
    totalKills: row.totalKills,
    totalDeaths: row.totalDeaths,
    totalAssists: row.totalAssists,
    totalCs: row.totalCs,
    totalGameSeconds: row.totalGameSeconds,
    totalDamageToChampions: row.totalDamageToChampions,
    totalVisionScore: row.totalVisionScore,
    totalGoldEarned: row.totalGoldEarned,
    totalGoldDifferenceAt10: row.totalGoldDifferenceAt10,
    goldDifferenceAt10Samples: row.goldDifferenceAt10Samples,
    totalGoldDifferenceAt15: row.totalGoldDifferenceAt15,
    goldDifferenceAt15Samples: row.goldDifferenceAt15Samples,
    totalCsDifferenceAt10: row.totalCsDifferenceAt10,
    csDifferenceAt10Samples: row.csDifferenceAt10Samples,
    totalCsDifferenceAt15: row.totalCsDifferenceAt15,
    csDifferenceAt15Samples: row.csDifferenceAt15Samples,
    latestEligibleMatchAt: row.latestEligibleMatchAt,
  };
}

export function mapAggregateDimensions(
  row: ChampionAggregate,
  regionalRoute: RegionalRoute,
): AggregateDimensions {
  return AggregateDimensionsSchema.parse({
    championId: row.championId,
    patch: row.patch,
    platform: row.platformRoute as PlatformRoute,
    regionalRoute,
    queueId: row.queueId,
    rankTier: row.rankTier,
    position: row.teamPosition as AggregateDimensions['position'],
    sourceNormalizationVersion: row.sourceNormalizationVersion,
    aggregationVersion: row.aggregationVersion,
  });
}

export function mapAggregateMetrics(
  row: ChampionAggregate,
  confidenceLevel: number,
  insufficientBelow: number,
): ChampionAggregateMetrics {
  const derived = deriveChampionAggregateMetrics(toAccumulator(row), {
    confidenceLevel,
    thresholds: {
      ...DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
      insufficientBelow,
    },
  });

  return ChampionAggregateMetricsSchema.parse({
    sampleSize: derived.sampleSize,
    wins: derived.wins,
    winRate: derived.winRate,
    wilsonInterval: derived.wilsonInterval,
    sampleConfidence: derived.sampleConfidence,
    aggregateKdaRatio: derived.aggregateKdaRatio,
    averageCsPerMinute: derived.averageCsPerMinute,
    averageDamagePerMinute: derived.averageDamagePerMinute,
    averageVisionScorePerMinute: derived.averageVisionScorePerMinute,
    averageGoldPerMinute: derived.averageGoldPerMinute,
    averageGoldDifferenceAt10: derived.averageGoldDifferenceAt10,
    averageGoldDifferenceAt15: derived.averageGoldDifferenceAt15,
    averageCsDifferenceAt10: derived.averageCsDifferenceAt10,
    averageCsDifferenceAt15: derived.averageCsDifferenceAt15,
    latestEligibleMatchAt: derived.latestEligibleMatchAt?.toISOString() ?? null,
    calculatedAt: row.calculatedAt.toISOString(),
  });
}

export function mapAggregateRow(input: {
  aggregate: ChampionAggregate;
  champion: ChampionStaticRow;
  media: DataDragonChampionService;
  regionalRoute: RegionalRoute;
  confidenceLevel: number;
  insufficientBelow: number;
}): ChampionAggregateRow {
  return ChampionAggregateRowSchema.parse({
    champion: mapChampionSummary(input.champion, input.media),
    dimensions: mapAggregateDimensions(input.aggregate, input.regionalRoute),
    metrics: mapAggregateMetrics(input.aggregate, input.confidenceLevel, input.insufficientBelow),
  });
}

export const FIVE_RANKING_POSITIONS: ChampionRankingPosition[] = [
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'SUPPORT',
];
