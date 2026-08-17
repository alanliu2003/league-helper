import {
  getMatchQueueLabel,
  type PlayerMetricComparison,
  type PlayerPlaystyleMetricId,
} from '@league-helper/shared';
import { buildPlayerPlaystyleEvidenceCatalog } from './player-playstyle-evidence';
import type {
  PlayerPlaystyleBuilderInput,
  PlayerPlaystyleBuilderProfile,
  PlayerPlaystyleChampionSlice,
  PlayerPlaystyleInternalContext,
  PlayerPlaystyleMatchIdentity,
  PlayerPlaystyleOutputPolicy,
} from './player-playstyle-types';

const ECONOMY_METRICS = new Set<PlayerPlaystyleMetricId>([
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
]);

const COMBAT_OVERALL_METRICS = new Set<PlayerPlaystyleMetricId>([
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'DAMAGE_PER_MIN',
]);

function copyComparison(comparison: PlayerMetricComparison): PlayerMetricComparison {
  return {
    ...comparison,
    baseline: comparison.baseline ? { ...comparison.baseline } : null,
  };
}

function copySlice(slice: PlayerPlaystyleChampionSlice): PlayerPlaystyleChampionSlice {
  return {
    ...slice,
    comparisons: slice.comparisons.map(copyComparison),
  };
}

function sortMatchIdentity(
  identities: readonly PlayerPlaystyleMatchIdentity[],
): PlayerPlaystyleMatchIdentity[] {
  return [...identities].sort((left, right) => {
    if (left.matchId !== right.matchId) {
      return left.matchId < right.matchId ? -1 : 1;
    }
    return left.participantId - right.participantId;
  });
}

function anyInterpretationAllowed(comparisons: readonly PlayerMetricComparison[]): boolean {
  return comparisons.some((row) => row.interpretationAllowed);
}

function isGenerationEligible(profile: PlayerPlaystyleBuilderProfile): boolean {
  return (
    anyInterpretationAllowed(profile.overall.comparisons) ||
    profile.championSlices.some((slice) => anyInterpretationAllowed(slice.comparisons))
  );
}

function metricAllowed(
  comparisons: readonly PlayerMetricComparison[],
  metrics: ReadonlySet<PlayerPlaystyleMetricId>,
): boolean {
  return comparisons.some((row) => metrics.has(row.metric) && row.interpretationAllowed);
}

export function buildPlayerPlaystyleOutputPolicy(
  profile: PlayerPlaystyleBuilderProfile,
): PlayerPlaystyleOutputPolicy {
  return {
    economyAllowed:
      metricAllowed(profile.overall.comparisons, ECONOMY_METRICS) ||
      profile.championSlices.some((slice) => metricAllowed(slice.comparisons, ECONOMY_METRICS)),
    combatAllowed: metricAllowed(profile.overall.comparisons, COMBAT_OVERALL_METRICS),
    championTendenciesAllowed: profile.championSlices.some((slice) =>
      anyInterpretationAllowed(slice.comparisons),
    ),
  };
}

export function buildPlayerPlaystyleContext(
  input: PlayerPlaystyleBuilderInput,
): PlayerPlaystyleInternalContext {
  const generationEligible = isGenerationEligible(input.profile);

  return {
    subject: { label: 'player' },
    scope: {
      queueId: input.queueId,
      queueLabel: getMatchQueueLabel(input.queueId),
      kind: 'COLLECTED_SAMPLE',
      patchRange: input.profile.patchRange,
    },
    mix: input.profile.mix.map((entry) => ({ ...entry })),
    playerSample: {
      matchesAnalyzed: input.profile.matchesAnalyzed,
      comparableMatchCount: input.profile.comparableMatchCount,
      wins: input.profile.wins,
      playerSampleBand: input.profile.playerSampleBand,
      generationEligible,
    },
    overall: {
      comparisons: input.profile.overall.comparisons.map(copyComparison),
    },
    championSlices: input.profile.championSlices.map(copySlice),
    skipped: { ...input.profile.skipped },
    windowSize: input.profile.windowSize,
    matchIdentity: sortMatchIdentity(input.matchIdentity),
    evidenceCatalog: buildPlayerPlaystyleEvidenceCatalog(input.profile),
    outputPolicy: buildPlayerPlaystyleOutputPolicy(input.profile),
    generationEligible,
  };
}
