import {
  parsePatchVersion,
  type ChampionRankingPosition,
  type ChampionStatsTierFilter,
  type PlayerMetricComparison,
  type PlayerPlaystyleDirection,
  type PlayerPlaystyleMetricId,
  type PlayerPlaystyleSampleBand,
} from '@league-helper/shared';
import { computeAggregateKdaRatio } from '../champion/aggregate-derivations';
import { classifySampleConfidence } from '../statistics/sample-confidence';
import { classifyMetricDirection } from './comparison';
import {
  classifyPlayerPlaystyleSampleBand,
  PLAYER_PLAYSTYLE_EXPLORATORY_MIN,
} from './sample-policy';
import {
  baselineValueForMetric,
  extractPlayerPlaystyleMatchMetrics,
  isBaselineComparableForMetric,
  isFiniteNumber,
  type BaselineLookupResult,
  type PlayerPlaystyleMatchInput,
  type PlayerPlaystyleMatchMetrics,
  type PlayerPlaystyleMatchPosition,
} from './metrics';

export const PLAYER_PLAYSTYLE_OVERALL_METRICS: readonly PlayerPlaystyleMetricId[] = [
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'DAMAGE_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
];

export const PLAYER_PLAYSTYLE_SLICE_METRICS: readonly PlayerPlaystyleMetricId[] = [
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'KDA',
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'DAMAGE_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
];

const RANKING_POSITIONS = new Set<PlayerPlaystyleMatchPosition>([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'SUPPORT',
]);

export type PlayerPlaystyleProfileSkippedInput = {
  remake: number;
  incomplete: number;
  unknownPosition: number;
};

export type PlayerPlaystyleBaselinesByMatchId =
  | Readonly<Record<string, BaselineLookupResult>>
  | ReadonlyMap<string, BaselineLookupResult>;

export type PlayerPlaystyleProfileInput = {
  matches: readonly PlayerPlaystyleMatchInput[];
  baselinesByMatchId: PlayerPlaystyleBaselinesByMatchId;
  skipped: PlayerPlaystyleProfileSkippedInput;
  windowSize?: number;
};

export type PlayerPlaystyleMixEntry = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
  matchCount: number;
};

export type PlayerPlaystyleChampionSlice = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
  matchCount: number;
  sampleBand: PlayerPlaystyleSampleBand;
  comparisons: PlayerMetricComparison[];
};

export type PlayerPlaystyleProfile = {
  windowSize: number;
  matchesAnalyzed: number;
  comparableMatchCount: number;
  wins: number;
  playerSampleBand: PlayerPlaystyleSampleBand;
  patchRange: { min: string; max: string } | null;
  mix: PlayerPlaystyleMixEntry[];
  overall: { comparisons: PlayerMetricComparison[] };
  championSlices: PlayerPlaystyleChampionSlice[];
  skipped: PlayerPlaystyleProfileSkippedInput & { noBaseline: number };
};

type AnalyzedMatch = {
  input: PlayerPlaystyleMatchInput;
  extracted: PlayerPlaystyleMatchMetrics;
  baseline: BaselineLookupResult;
  comparableMetrics: ReadonlySet<PlayerPlaystyleMetricId>;
};

type ChampionGroup = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
  matchCount: number;
  mostRecentGameCreation: number;
  matches: AnalyzedMatch[];
};

function isRankingPosition(
  position: PlayerPlaystyleMatchPosition,
): position is ChampionRankingPosition {
  return RANKING_POSITIONS.has(position);
}

function toEpoch(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function lookupBaseline(
  baselines: PlayerPlaystyleBaselinesByMatchId,
  matchId: string,
): BaselineLookupResult {
  if (baselines instanceof Map) {
    return baselines.get(matchId) ?? null;
  }
  const record = baselines as Readonly<Record<string, BaselineLookupResult>>;
  return Object.prototype.hasOwnProperty.call(record, matchId) ? (record[matchId] ?? null) : null;
}

function comparableMetricsForMatch(
  extracted: PlayerPlaystyleMatchMetrics,
  baseline: BaselineLookupResult,
): Set<PlayerPlaystyleMetricId> {
  const comparable = new Set<PlayerPlaystyleMetricId>();
  for (const metric of PLAYER_PLAYSTYLE_SLICE_METRICS) {
    if (
      isFiniteNumber(extracted.values[metric]) &&
      isBaselineComparableForMetric(baseline, metric)
    ) {
      comparable.add(metric);
    }
  }
  return comparable;
}

function resolveComparisonRankTier(
  usedAllTierFallback: boolean,
  rankTiers: readonly ChampionStatsTierFilter[],
): ChampionStatsTierFilter {
  if (usedAllTierFallback) {
    return 'ALL';
  }
  const unique = new Set(rankTiers);
  if (unique.size === 1) {
    return rankTiers[0] ?? 'ALL';
  }
  return 'ALL';
}

function notComparableRow(
  metric: PlayerPlaystyleMetricId,
  comparableMatchCount: number,
): PlayerMetricComparison {
  return {
    metric,
    playerValue: null,
    baseline: null,
    delta: null,
    comparableMatchCount,
    direction: 'NOT_COMPARABLE',
    interpretationAllowed: false,
  };
}

function classifyComparisonDirection(
  metric: PlayerPlaystyleMetricId,
  delta: number,
  comparableMatchCount: number,
): PlayerPlaystyleDirection {
  if (comparableMatchCount < PLAYER_PLAYSTYLE_EXPLORATORY_MIN) {
    return 'NOT_COMPARABLE';
  }
  return classifyMetricDirection(metric, delta);
}

function isCitableDirection(direction: PlayerPlaystyleDirection): boolean {
  return (
    direction === 'ABOVE_BASELINE' ||
    direction === 'NEAR_BASELINE' ||
    direction === 'BELOW_BASELINE'
  );
}

function buildComparison(options: {
  metric: PlayerPlaystyleMetricId;
  comparable: readonly AnalyzedMatch[];
  playerValue: number | null;
  baselineValue: number | null;
  delta: number | null;
  hideRawValues: boolean;
  sliceMatchCount?: number;
}): PlayerMetricComparison {
  const { metric, comparable, hideRawValues } = options;
  if (comparable.length === 0 || options.delta === null) {
    return notComparableRow(metric, comparable.length);
  }

  const minSampleSize = Math.min(...comparable.map((row) => row.baseline!.metrics.sampleSize));
  const sampleConfidence = classifySampleConfidence(minSampleSize);
  const usedAllTierFallback = comparable.some((row) => row.baseline!.usedAllTierFallback);
  const rankTier = resolveComparisonRankTier(
    usedAllTierFallback,
    comparable.map((row) => row.baseline!.rankTier),
  );
  const direction = classifyComparisonDirection(metric, options.delta, comparable.length);
  const sliceEligible =
    options.sliceMatchCount === undefined ||
    options.sliceMatchCount >= PLAYER_PLAYSTYLE_EXPLORATORY_MIN;
  const interpretationAllowed =
    isCitableDirection(direction) &&
    comparable.length >= PLAYER_PLAYSTYLE_EXPLORATORY_MIN &&
    sampleConfidence !== 'INSUFFICIENT' &&
    sliceEligible;

  return {
    metric,
    playerValue: hideRawValues ? null : options.playerValue,
    baseline: {
      value: hideRawValues ? null : options.baselineValue,
      sampleSize: minSampleSize,
      sampleConfidence,
      rankTier,
      usedAllTierFallback,
    },
    delta: options.delta,
    comparableMatchCount: comparable.length,
    direction,
    interpretationAllowed,
  };
}

function comparableMatchesForMetric(
  matches: readonly AnalyzedMatch[],
  metric: PlayerPlaystyleMetricId,
): AnalyzedMatch[] {
  return matches.filter((row) => row.comparableMetrics.has(metric));
}

function overallComparison(
  matches: readonly AnalyzedMatch[],
  metric: PlayerPlaystyleMetricId,
): PlayerMetricComparison {
  const comparable = comparableMatchesForMetric(matches, metric);
  if (comparable.length === 0) {
    return notComparableRow(metric, 0);
  }

  const deltas: number[] = [];
  for (const row of comparable) {
    const playerValue = row.extracted.values[metric];
    const baselineValue = baselineValueForMetric(row.baseline!.metrics, metric);
    if (!isFiniteNumber(playerValue) || !isFiniteNumber(baselineValue)) {
      continue;
    }
    deltas.push(playerValue - baselineValue);
  }

  return buildComparison({
    metric,
    comparable,
    playerValue: null,
    baselineValue: null,
    delta: mean(deltas),
    hideRawValues: true,
  });
}

function sliceComparison(
  matches: readonly AnalyzedMatch[],
  metric: PlayerPlaystyleMetricId,
  sliceMatchCount: number,
): PlayerMetricComparison {
  const comparable = comparableMatchesForMetric(matches, metric);
  if (comparable.length === 0) {
    return notComparableRow(metric, 0);
  }

  if (metric === 'KDA') {
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    const baselineValues: number[] = [];
    for (const row of comparable) {
      totalKills += row.input.kills;
      totalDeaths += row.input.deaths;
      totalAssists += row.input.assists;
      const baselineValue = baselineValueForMetric(row.baseline!.metrics, metric);
      if (isFiniteNumber(baselineValue)) {
        baselineValues.push(baselineValue);
      }
    }
    const playerValue = computeAggregateKdaRatio(
      comparable.length,
      totalKills,
      totalDeaths,
      totalAssists,
    );
    const baselineValue = mean(baselineValues);
    const delta =
      isFiniteNumber(playerValue) && isFiniteNumber(baselineValue)
        ? playerValue - baselineValue
        : null;
    return buildComparison({
      metric,
      comparable,
      playerValue,
      baselineValue,
      delta,
      hideRawValues: false,
      sliceMatchCount,
    });
  }

  const playerValues: number[] = [];
  const baselineValues: number[] = [];
  const deltas: number[] = [];
  for (const row of comparable) {
    const playerValue = row.extracted.values[metric];
    const baselineValue = baselineValueForMetric(row.baseline!.metrics, metric);
    if (!isFiniteNumber(playerValue) || !isFiniteNumber(baselineValue)) {
      continue;
    }
    playerValues.push(playerValue);
    baselineValues.push(baselineValue);
    deltas.push(playerValue - baselineValue);
  }

  return buildComparison({
    metric,
    comparable,
    playerValue: mean(playerValues),
    baselineValue: mean(baselineValues),
    delta: mean(deltas),
    hideRawValues: false,
    sliceMatchCount,
  });
}

function patchRangeFor(matches: readonly PlayerPlaystyleMatchInput[]): {
  min: string;
  max: string;
} | null {
  let minPatch: { raw: string; major: number; minor: number } | null = null;
  let maxPatch: { raw: string; major: number; minor: number } | null = null;

  for (const row of matches) {
    const parsed = parsePatchVersion(row.patch);
    if (parsed === null) {
      continue;
    }
    if (
      minPatch === null ||
      parsed.major < minPatch.major ||
      (parsed.major === minPatch.major && parsed.minor < minPatch.minor)
    ) {
      minPatch = { raw: row.patch, major: parsed.major, minor: parsed.minor };
    }
    if (
      maxPatch === null ||
      parsed.major > maxPatch.major ||
      (parsed.major === maxPatch.major && parsed.minor > maxPatch.minor)
    ) {
      maxPatch = { raw: row.patch, major: parsed.major, minor: parsed.minor };
    }
  }

  if (minPatch === null || maxPatch === null) {
    return null;
  }
  return { min: minPatch.raw, max: maxPatch.raw };
}

function groupAnalyzedMatches(matches: readonly AnalyzedMatch[]): ChampionGroup[] {
  const groups = new Map<string, ChampionGroup>();
  for (const row of matches) {
    if (!isRankingPosition(row.input.position)) {
      continue;
    }
    const key = `${row.input.championKey}\0${row.input.position}`;
    const gameCreation = toEpoch(row.input.gameCreation);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        championKey: row.input.championKey,
        championName: row.input.championName,
        position: row.input.position,
        matchCount: 1,
        mostRecentGameCreation: gameCreation,
        matches: [row],
      });
      continue;
    }
    existing.matchCount += 1;
    existing.matches.push(row);
    if (gameCreation >= existing.mostRecentGameCreation) {
      existing.mostRecentGameCreation = gameCreation;
      existing.championName = row.input.championName;
    }
  }

  return [...groups.values()].sort((left, right) => {
    if (right.matchCount !== left.matchCount) {
      return right.matchCount - left.matchCount;
    }
    return right.mostRecentGameCreation - left.mostRecentGameCreation;
  });
}

export function buildPlayerPlaystyleProfile(
  input: PlayerPlaystyleProfileInput,
): PlayerPlaystyleProfile {
  const analyzed: AnalyzedMatch[] = input.matches.map((match) => {
    const extracted = extractPlayerPlaystyleMatchMetrics(match);
    const baseline = lookupBaseline(input.baselinesByMatchId, match.matchId);
    return {
      input: match,
      extracted,
      baseline,
      comparableMetrics: comparableMetricsForMatch(extracted, baseline),
    };
  });

  const noBaseline = analyzed.filter((row) => row.comparableMetrics.size === 0).length;
  const matchesAnalyzed = analyzed.length;
  const comparableMatchCount = matchesAnalyzed - noBaseline;
  const windowSize =
    input.skipped.remake +
    input.skipped.incomplete +
    input.skipped.unknownPosition +
    matchesAnalyzed;
  const groups = groupAnalyzedMatches(analyzed);

  return {
    windowSize,
    matchesAnalyzed,
    comparableMatchCount,
    wins: analyzed.filter((row) => row.input.win).length,
    playerSampleBand: classifyPlayerPlaystyleSampleBand(comparableMatchCount),
    patchRange: patchRangeFor(input.matches),
    mix: groups.map((group) => ({
      championKey: group.championKey,
      championName: group.championName,
      position: group.position,
      matchCount: group.matchCount,
    })),
    overall: {
      comparisons: PLAYER_PLAYSTYLE_OVERALL_METRICS.map((metric) =>
        overallComparison(analyzed, metric),
      ),
    },
    championSlices: groups
      .filter((group) => group.matchCount >= PLAYER_PLAYSTYLE_EXPLORATORY_MIN)
      .slice(0, 3)
      .map((group) => ({
        championKey: group.championKey,
        championName: group.championName,
        position: group.position,
        matchCount: group.matchCount,
        sampleBand: classifyPlayerPlaystyleSampleBand(group.matchCount),
        comparisons: PLAYER_PLAYSTYLE_SLICE_METRICS.map((metric) =>
          sliceComparison(group.matches, metric, group.matchCount),
        ),
      })),
    skipped: {
      remake: input.skipped.remake,
      incomplete: input.skipped.incomplete,
      unknownPosition: input.skipped.unknownPosition,
      noBaseline,
    },
  };
}
