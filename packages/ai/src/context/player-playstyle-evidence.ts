import type { PlayerMetricComparison } from '@league-helper/shared';
import {
  evidenceKind,
  evidenceTopicLabel,
  type EvidenceHandleEntry,
  type EvidenceHandleMapping,
} from './evidence-handles';
import type {
  PlayerPlaystyleBuilderProfile,
  PlayerPlaystyleEvidenceEntry,
  PlayerPlaystyleGenerationComparison,
  PlayerPlaystyleGenerationPayload,
  PlayerPlaystyleInternalContext,
} from './player-playstyle-types';

const GENERATION_MIX_LIMIT = 8;

function isDirectedComparison(comparison: PlayerMetricComparison): boolean {
  return (
    comparison.direction === 'ABOVE_BASELINE' ||
    comparison.direction === 'NEAR_BASELINE' ||
    comparison.direction === 'BELOW_BASELINE'
  );
}

function toQualitativeComparison(
  comparison: PlayerMetricComparison,
): PlayerPlaystyleGenerationComparison {
  return {
    metric: comparison.metric,
    direction: comparison.direction,
    interpretationAllowed: comparison.interpretationAllowed,
    usedAllTierFallback: comparison.baseline?.usedAllTierFallback ?? false,
  };
}

export function buildPlayerPlaystyleEvidenceCatalog(
  profile: PlayerPlaystyleBuilderProfile,
): PlayerPlaystyleEvidenceEntry[] {
  const catalog: PlayerPlaystyleEvidenceEntry[] = [
    { id: 'SCOPE_QUEUE', interpretationAllowed: true },
    { id: 'SCOPE_PATCH_RANGE', interpretationAllowed: true },
    { id: 'SCOPE_MIX', interpretationAllowed: true },
  ];

  if (profile.playerSampleBand === 'EXPLORATORY' || profile.playerSampleBand === 'INSUFFICIENT') {
    catalog.push({ id: 'CONFIDENCE_WARNING', interpretationAllowed: true });
  }

  for (const comparison of profile.overall.comparisons) {
    if (comparison.metric === 'KDA') {
      continue;
    }
    catalog.push({
      id: `OVERALL_${comparison.metric}`,
      interpretationAllowed: comparison.interpretationAllowed,
    });
  }

  for (const slice of profile.championSlices) {
    for (const comparison of slice.comparisons) {
      catalog.push({
        id: `SLICE_${slice.championKey}_${slice.position}_${comparison.metric}`,
        interpretationAllowed: comparison.interpretationAllowed,
      });
    }
  }

  return catalog;
}

export function buildPlayerPlaystyleEvidenceHandleMapping(
  catalog: PlayerPlaystyleEvidenceEntry[],
): EvidenceHandleMapping {
  const allowed = catalog.filter((entry) => entry.interpretationAllowed);
  const entries: EvidenceHandleEntry[] = allowed.map((entry, index) => ({
    handle: `E${index + 1}`,
    id: entry.id,
    interpretationAllowed: true,
  }));

  return {
    entries,
    handleToId: new Map(entries.map((entry) => [entry.handle, entry.id])),
    idToHandle: new Map(entries.map((entry) => [entry.id, entry.handle])),
    catalogIds: new Set(catalog.map((entry) => entry.id)),
  };
}

function metricTopic(metric: string): string {
  return metric.toLowerCase().replaceAll('_', ' ');
}

export function playerPlaystyleEvidenceTopic(id: string): string {
  if (id === 'SCOPE_QUEUE') {
    return 'scope queue identity';
  }
  if (id === 'SCOPE_PATCH_RANGE') {
    return 'scope patch range';
  }
  if (id === 'SCOPE_MIX') {
    return 'scope champion mix';
  }
  if (id === 'CONFIDENCE_WARNING') {
    return evidenceTopicLabel(id);
  }

  const overall = /^OVERALL_(.+)$/.exec(id);
  if (overall?.[1]) {
    return `overall ${metricTopic(overall[1])}`;
  }

  const slice = /^SLICE_(.+)_(TOP|JUNGLE|MIDDLE|BOTTOM|SUPPORT)_(.+)$/.exec(id);
  if (slice?.[1] && slice[2] && slice[3]) {
    return `${slice[1]} ${slice[2]} ${metricTopic(slice[3])}`;
  }

  return evidenceTopicLabel(id);
}

export function buildPlayerPlaystyleGenerationPayload(
  context: PlayerPlaystyleInternalContext,
): PlayerPlaystyleGenerationPayload {
  const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);

  return {
    subject: { label: 'player' },
    scope: {
      queueId: context.scope.queueId,
      queueLabel: context.scope.queueLabel,
      kind: context.scope.kind,
      patchRange: context.scope.patchRange,
    },
    mix: context.mix.slice(0, GENERATION_MIX_LIMIT).map((entry) => ({
      championKey: entry.championKey,
      championName: entry.championName,
      position: entry.position,
    })),
    playerSample: {
      playerSampleBand: context.playerSample.playerSampleBand,
      generationEligible: context.playerSample.generationEligible,
    },
    overall: {
      comparisons: context.overall.comparisons
        .filter((row) => row.metric !== 'KDA' && isDirectedComparison(row))
        .map(toQualitativeComparison),
    },
    championSlices: context.championSlices.map((slice) => ({
      championKey: slice.championKey,
      championName: slice.championName,
      position: slice.position,
      sampleBand: slice.sampleBand,
      comparisons: slice.comparisons.filter(isDirectedComparison).map(toQualitativeComparison),
    })),
    outputPolicy: { ...context.outputPolicy },
    generationEligible: context.generationEligible,
    evidence: mapping.entries.map((entry) => ({
      handle: entry.handle,
      kind: evidenceKind(entry.id),
      topic: playerPlaystyleEvidenceTopic(entry.id),
    })),
  };
}
