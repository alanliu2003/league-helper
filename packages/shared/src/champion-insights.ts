import { z } from 'zod';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionStatsResolvedFiltersSchema,
  SampleScopeSchema,
} from './champion-api';
import { ChampionBuildsQuerySchema } from './champion-builds';

export const CHAMPION_AI_DISCLAIMER =
  'AI explanations are generated from League Helper statistical data and champion ability information.';

export const CHAMPION_AI_PROMPT_VERSION = 'champion-insight-v1.3' as const;

export const ChampionAiInsightStatusSchema = z.enum([
  'DISABLED',
  'PENDING',
  'AVAILABLE',
  'UNAVAILABLE',
  'LOW_CONFIDENCE',
]);
export type ChampionAiInsightStatus = z.infer<typeof ChampionAiInsightStatusSchema>;

export const ChampionAiInsightsEmptyReasonSchema = z.enum([
  'UNKNOWN_RANK_HIDDEN',
  'INSUFFICIENT_EVIDENCE',
  'GENERATION_FAILED',
  'QUEUE_UNAVAILABLE',
  'AI_DISABLED',
]);
export type ChampionAiInsightsEmptyReason = z.infer<typeof ChampionAiInsightsEmptyReasonSchema>;

export const ChampionAiInsightsQuerySchema = ChampionBuildsQuerySchema;
export type ChampionAiInsightsQuery = z.infer<typeof ChampionAiInsightsQuerySchema>;

const ChampionAiMatchupSideSchema = z.enum(['STRONG', 'WEAK']);

export const ChampionAiPublicInsightSchema = z.object({
  summary: z.string().min(80).max(600),
  strengths: z.array(z.string().min(40).max(400)).max(3),
  weaknesses: z.array(z.string().min(40).max(400)).max(3),
  buildInsight: z.string().min(40).max(400).nullable(),
  matchupInsights: z
    .array(
      z.object({
        opponentChampionKey: z.string().min(1),
        side: ChampionAiMatchupSideSchema,
        text: z.string().min(40).max(500),
      }),
    )
    .max(6),
  generatedAt: z.string().datetime(),
});
export type ChampionAiPublicInsight = z.infer<typeof ChampionAiPublicInsightSchema>;

export const ChampionAiInsightsResponseSchema = z.object({
  disclaimer: z.literal(CHAMPION_STATS_DISCLAIMER),
  aiDisclaimer: z.literal(CHAMPION_AI_DISCLAIMER),
  sampleScope: SampleScopeSchema,
  resolvedFilters: ChampionStatsResolvedFiltersSchema,
  status: ChampionAiInsightStatusSchema,
  emptyReason: ChampionAiInsightsEmptyReasonSchema.optional(),
  insight: ChampionAiPublicInsightSchema.nullable(),
});
export type ChampionAiInsightsResponse = z.infer<typeof ChampionAiInsightsResponseSchema>;

const ChampionAiEvidenceIdsSchema = z.array(z.string().min(1)).min(1);

export const ChampionAiGroundedClaimSchema = z.object({
  text: z.string().min(40).max(400),
  evidence: ChampionAiEvidenceIdsSchema,
});
export type ChampionAiGroundedClaim = z.infer<typeof ChampionAiGroundedClaimSchema>;

export const ChampionAiStoredInsightSchema = z.object({
  summary: z.object({
    text: z.string().min(80).max(600),
    evidence: ChampionAiEvidenceIdsSchema,
  }),
  strengths: z.array(ChampionAiGroundedClaimSchema).max(3),
  weaknesses: z.array(ChampionAiGroundedClaimSchema).max(3),
  buildInsight: ChampionAiGroundedClaimSchema.nullable(),
  matchupInsights: z
    .array(
      z.object({
        opponentChampionKey: z.string().min(1),
        side: ChampionAiMatchupSideSchema,
        text: z.string().min(40).max(500),
        evidence: ChampionAiEvidenceIdsSchema,
      }),
    )
    .max(6),
});
export type ChampionAiStoredInsight = z.infer<typeof ChampionAiStoredInsightSchema>;
