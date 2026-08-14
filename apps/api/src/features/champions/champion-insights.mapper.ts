import {
  CHAMPION_AI_DISCLAIMER,
  CHAMPION_STATS_DISCLAIMER,
  ChampionAiInsightsResponseSchema,
  ChampionAiPublicInsightSchema,
  type ChampionAiInsightsEmptyReason,
  type ChampionAiInsightStatus,
  type ChampionAiInsightsResponse,
  type ChampionAiPublicInsight,
  type ChampionAiStoredInsight,
  type ChampionStatsResolvedFilters,
  type SampleScope,
} from '@league-helper/shared';

export function toPublicInsight(
  stored: ChampionAiStoredInsight,
  generatedAt: Date | string,
): ChampionAiPublicInsight {
  const generatedAtIso = generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt;

  return ChampionAiPublicInsightSchema.parse({
    summary: stored.summary.text,
    strengths: stored.strengths.map((claim) => claim.text),
    weaknesses: stored.weaknesses.map((claim) => claim.text),
    buildInsight: stored.buildInsight?.text ?? null,
    matchupInsights: stored.matchupInsights.map((row) => ({
      opponentChampionKey: row.opponentChampionKey,
      side: row.side,
      text: row.text,
    })),
    generatedAt: generatedAtIso,
  });
}

export function toInsightsResponse(input: {
  status: ChampionAiInsightStatus;
  emptyReason?: ChampionAiInsightsEmptyReason;
  insight: ChampionAiPublicInsight | null;
  sampleScope: SampleScope;
  resolvedFilters: ChampionStatsResolvedFilters;
}): ChampionAiInsightsResponse {
  return ChampionAiInsightsResponseSchema.parse({
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    aiDisclaimer: CHAMPION_AI_DISCLAIMER,
    sampleScope: input.sampleScope,
    resolvedFilters: input.resolvedFilters,
    status: input.status,
    ...(input.emptyReason !== undefined ? { emptyReason: input.emptyReason } : {}),
    insight: input.insight,
  });
}
