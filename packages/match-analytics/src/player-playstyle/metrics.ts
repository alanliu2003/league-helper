import type { ChampionStatsTierFilter, PlayerPlaystyleMetricId } from '@league-helper/shared';
import {
  computeAggregateKdaRatio,
  type DerivedChampionAggregateMetrics,
} from '../champion/aggregate-derivations';
import { safeDivide } from '../statistics/safe-math';
import type { SampleConfidence } from '../statistics/sample-confidence';

export type PlayerPlaystyleMatchPosition =
  | 'TOP'
  | 'JUNGLE'
  | 'MIDDLE'
  | 'BOTTOM'
  | 'SUPPORT'
  | 'UNKNOWN';

export type PlayerPlaystyleMatchInput = {
  matchId: string;
  participantId: number;
  championId: number;
  championKey: string;
  championName: string;
  position: PlayerPlaystyleMatchPosition;
  patch: string;
  platformRoute: string;
  queueId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalCs: number;
  goldEarned: number;
  damageToChampions: number;
  visionScore: number;
  timePlayedSeconds: number;
  gameDurationSeconds: number;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  rankTier: string | null;
  rankResolutionStatus: string;
  gameCreation: Date | number;
};

export type PlayerPlaystyleMatchMetricValues = Record<PlayerPlaystyleMetricId, number | null>;

export type PlayerPlaystyleMatchMetrics = {
  readonly matchId: string;
  readonly seconds: number;
  readonly values: PlayerPlaystyleMatchMetricValues;
};

export type PlayerPlaystyleBaselineMetrics = {
  sampleSize: number;
  sampleConfidence: SampleConfidence;
  aggregateKdaRatio: number | null;
  averageKillsPerGame: number | null;
  averageDeathsPerGame: number | null;
  averageAssistsPerGame: number | null;
  averageCsPerMinute: number | null;
  averageGoldPerMinute: number | null;
  averageDamagePerMinute: number | null;
  averageVisionScorePerMinute: number | null;
  averageGoldDifferenceAt10: number | null;
  averageGoldDifferenceAt15: number | null;
  averageCsDifferenceAt10: number | null;
  averageCsDifferenceAt15: number | null;
};

export type BaselineLookupResult = {
  metrics: PlayerPlaystyleBaselineMetrics;
  rankTier: ChampionStatsTierFilter;
  usedAllTierFallback: boolean;
} | null;

export const PLAYER_PLAYSTYLE_BASELINE_FIELDS = {
  KILLS_PER_GAME: 'averageKillsPerGame',
  DEATHS_PER_GAME: 'averageDeathsPerGame',
  ASSISTS_PER_GAME: 'averageAssistsPerGame',
  KDA: 'aggregateKdaRatio',
  CS_PER_MIN: 'averageCsPerMinute',
  GOLD_PER_MIN: 'averageGoldPerMinute',
  DAMAGE_PER_MIN: 'averageDamagePerMinute',
  VISION_PER_MIN: 'averageVisionScorePerMinute',
  GOLD_DIFF_AT_10: 'averageGoldDifferenceAt10',
  GOLD_DIFF_AT_15: 'averageGoldDifferenceAt15',
  CS_DIFF_AT_10: 'averageCsDifferenceAt10',
  CS_DIFF_AT_15: 'averageCsDifferenceAt15',
} as const satisfies Record<PlayerPlaystyleMetricId, keyof PlayerPlaystyleBaselineMetrics>;

export function resolvePlaystyleDurationSeconds(match: PlayerPlaystyleMatchInput): number {
  return match.timePlayedSeconds > 0 ? match.timePlayedSeconds : match.gameDurationSeconds;
}

function perMinute(value: number, seconds: number): number | null {
  if (seconds <= 0) {
    return null;
  }
  return safeDivide(value, seconds / 60);
}

export function extractPlayerPlaystyleMatchMetrics(
  match: PlayerPlaystyleMatchInput,
): PlayerPlaystyleMatchMetrics {
  const seconds = resolvePlaystyleDurationSeconds(match);
  return {
    matchId: match.matchId,
    seconds,
    values: {
      KILLS_PER_GAME: match.kills,
      DEATHS_PER_GAME: match.deaths,
      ASSISTS_PER_GAME: match.assists,
      KDA: computeAggregateKdaRatio(1, match.kills, match.deaths, match.assists),
      CS_PER_MIN: perMinute(match.totalCs, seconds),
      GOLD_PER_MIN: perMinute(match.goldEarned, seconds),
      DAMAGE_PER_MIN: perMinute(match.damageToChampions, seconds),
      VISION_PER_MIN: perMinute(match.visionScore, seconds),
      GOLD_DIFF_AT_10: match.goldDifferenceAt10,
      GOLD_DIFF_AT_15: match.goldDifferenceAt15,
      CS_DIFF_AT_10: match.csDifferenceAt10,
      CS_DIFF_AT_15: match.csDifferenceAt15,
    },
  };
}

export function toPlayerPlaystyleBaselineMetrics(
  derived: DerivedChampionAggregateMetrics,
): PlayerPlaystyleBaselineMetrics {
  return {
    sampleSize: derived.sampleSize,
    sampleConfidence: derived.sampleConfidence,
    aggregateKdaRatio: derived.aggregateKdaRatio,
    averageKillsPerGame: derived.averageKillsPerGame,
    averageDeathsPerGame: derived.averageDeathsPerGame,
    averageAssistsPerGame: derived.averageAssistsPerGame,
    averageCsPerMinute: derived.averageCsPerMinute,
    averageGoldPerMinute: derived.averageGoldPerMinute,
    averageDamagePerMinute: derived.averageDamagePerMinute,
    averageVisionScorePerMinute: derived.averageVisionScorePerMinute,
    averageGoldDifferenceAt10: derived.averageGoldDifferenceAt10,
    averageGoldDifferenceAt15: derived.averageGoldDifferenceAt15,
    averageCsDifferenceAt10: derived.averageCsDifferenceAt10,
    averageCsDifferenceAt15: derived.averageCsDifferenceAt15,
  };
}

export function baselineValueForMetric(
  metrics: PlayerPlaystyleBaselineMetrics,
  metric: PlayerPlaystyleMetricId,
): number | null {
  return metrics[PLAYER_PLAYSTYLE_BASELINE_FIELDS[metric]];
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isBaselineComparableForMetric(
  baseline: BaselineLookupResult,
  metric: PlayerPlaystyleMetricId,
): baseline is Exclude<BaselineLookupResult, null> {
  if (baseline === null) {
    return false;
  }
  if (baseline.metrics.sampleConfidence === 'INSUFFICIENT') {
    return false;
  }
  return isFiniteNumber(baselineValueForMetric(baseline.metrics, metric));
}
