import {
  CHAMPION_STATS_DISCLAIMER,
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  PlayerPlaystylePublicInsightSchema,
  PlayerPlaystyleResponseSchema,
  RANKED_SOLO_QUEUE_ID,
  RANK_TIER_SEMANTICS,
  type PlayerAiInsightStatus,
  type PlayerPlaystyleEmptyReason,
  type PlayerPlaystylePublicInsight,
  type PlayerPlaystyleResponse,
  type PlayerPlaystyleStoredInsight,
} from '@league-helper/shared';
import type { PlayerPlaystyleProfile } from '@league-helper/match-analytics';

export function toPublicPlaystyleInsight(
  stored: PlayerPlaystyleStoredInsight,
  generatedAt: Date | string,
): PlayerPlaystylePublicInsight {
  const generatedAtIso = generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt;

  return PlayerPlaystylePublicInsightSchema.parse({
    summary: stored.summary.text,
    economy: stored.economy?.text ?? null,
    combat: stored.combat?.text ?? null,
    strengths: stored.strengths.map((claim) => claim.text),
    tradeoffs: stored.tradeoffs.map((claim) => claim.text),
    championTendencies: stored.championTendencies.map((row) => ({
      championKey: row.championKey,
      position: row.position,
      text: row.text,
    })),
    generatedAt: generatedAtIso,
  });
}

export function toPlaystyleResponse(input: {
  profile: PlayerPlaystyleProfile;
  ai: {
    status: PlayerAiInsightStatus;
    emptyReason?: PlayerPlaystyleEmptyReason;
    insight: PlayerPlaystylePublicInsight | null;
  };
}): PlayerPlaystyleResponse {
  const { profile } = input;
  return PlayerPlaystyleResponseSchema.parse({
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    aiDisclaimer: PLAYER_PLAYSTYLE_AI_DISCLAIMER,
    rankSemantics: RANK_TIER_SEMANTICS,
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      queueId: RANKED_SOLO_QUEUE_ID,
      matchWindow: 20,
      windowSize: profile.windowSize,
      matchesAnalyzed: profile.matchesAnalyzed,
      comparableMatchCount: profile.comparableMatchCount,
      wins: profile.wins,
      playerSampleBand: profile.playerSampleBand,
      patchRange: profile.patchRange,
    },
    mix: profile.mix,
    overall: profile.overall,
    championSlices: profile.championSlices,
    skipped: profile.skipped,
    ai: {
      status: input.ai.status,
      ...(input.ai.emptyReason !== undefined ? { emptyReason: input.ai.emptyReason } : {}),
      insight: input.ai.insight,
    },
  });
}
