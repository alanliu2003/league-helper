import { z } from 'zod';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionRankingPositionSchema,
  ChampionStatsTierFilterSchema,
  RANK_TIER_SEMANTICS,
  SampleConfidenceSchema,
} from './champion-api';
import { RANKED_SOLO_QUEUE_ID } from './match-queues';

export const PLAYER_PLAYSTYLE_AI_DISCLAIMER =
  'AI playstyle explanations are generated from League Helper statistical comparisons. They do not replace the numbers shown on this page.';

export const PLAYER_PLAYSTYLE_PROMPT_VERSION = 'player-playstyle-v1' as const;

export const PlayerPlaystyleMetricIdSchema = z.enum([
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
  'KDA',
]);
export type PlayerPlaystyleMetricId = z.infer<typeof PlayerPlaystyleMetricIdSchema>;

export const PlayerPlaystyleDirectionSchema = z.enum([
  'ABOVE_BASELINE',
  'NEAR_BASELINE',
  'BELOW_BASELINE',
  'NOT_COMPARABLE',
]);
export type PlayerPlaystyleDirection = z.infer<typeof PlayerPlaystyleDirectionSchema>;

export const PlayerPlaystyleSampleBandSchema = z.enum([
  'INSUFFICIENT',
  'EXPLORATORY',
  'CREDIBLE',
  'STRONG',
]);
export type PlayerPlaystyleSampleBand = z.infer<typeof PlayerPlaystyleSampleBandSchema>;

export const PlayerAiInsightStatusSchema = z.enum([
  'DISABLED',
  'PENDING',
  'AVAILABLE',
  'UNAVAILABLE',
  'LOW_CONFIDENCE',
]);
export type PlayerAiInsightStatus = z.infer<typeof PlayerAiInsightStatusSchema>;

export const PlayerPlaystyleEmptyReasonSchema = z.enum([
  'INSUFFICIENT_SAMPLE',
  'INSUFFICIENT_EVIDENCE',
  'GENERATION_FAILED',
  'QUEUE_UNAVAILABLE',
  'AI_DISABLED',
]);
export type PlayerPlaystyleEmptyReason = z.infer<typeof PlayerPlaystyleEmptyReasonSchema>;

export const PlayerPlaystyleBaselineSchema = z.object({
  value: z.number().finite().nullable(),
  sampleSize: z.number().int().min(0),
  sampleConfidence: SampleConfidenceSchema,
  rankTier: ChampionStatsTierFilterSchema,
  usedAllTierFallback: z.boolean(),
});
export type PlayerPlaystyleBaseline = z.infer<typeof PlayerPlaystyleBaselineSchema>;

export const PlayerMetricComparisonSchema = z.object({
  metric: PlayerPlaystyleMetricIdSchema,
  playerValue: z.number().finite().nullable(),
  baseline: PlayerPlaystyleBaselineSchema.nullable(),
  delta: z.number().finite().nullable(),
  comparableMatchCount: z.number().int().min(0),
  direction: PlayerPlaystyleDirectionSchema,
  interpretationAllowed: z.boolean(),
});
export type PlayerMetricComparison = z.infer<typeof PlayerMetricComparisonSchema>;

const PlayerPlaystyleMixEntrySchema = z.object({
  championKey: z.string().min(1),
  championName: z.string().min(1),
  position: ChampionRankingPositionSchema,
  matchCount: z.number().int().min(0),
});

const PlayerPlaystyleChampionSliceSchema = z.object({
  championKey: z.string().min(1),
  championName: z.string().min(1),
  position: ChampionRankingPositionSchema,
  matchCount: z.number().int().min(0),
  sampleBand: PlayerPlaystyleSampleBandSchema,
  comparisons: z.array(PlayerMetricComparisonSchema),
});

const PlayerPlaystyleSampleScopeSchema = z.object({
  kind: z.literal('COLLECTED_SAMPLE'),
  queueId: z.literal(RANKED_SOLO_QUEUE_ID),
  matchWindow: z.literal(20),
  windowSize: z.number().int().min(0).max(20),
  matchesAnalyzed: z.number().int().min(0),
  comparableMatchCount: z.number().int().min(0),
  wins: z.number().int().min(0),
  playerSampleBand: PlayerPlaystyleSampleBandSchema,
  patchRange: z
    .object({
      min: z.string().min(1),
      max: z.string().min(1),
    })
    .nullable(),
});

export const PlayerPlaystylePublicInsightSchema = z.object({
  summary: z.string().min(80).max(600),
  economy: z.string().min(40).max(400).nullable(),
  combat: z.string().min(40).max(400).nullable(),
  strengths: z.array(z.string().min(40).max(400)).max(3),
  tradeoffs: z.array(z.string().min(40).max(400)).max(3),
  championTendencies: z
    .array(
      z.object({
        championKey: z.string().min(1),
        position: ChampionRankingPositionSchema,
        text: z.string().min(40).max(500),
      }),
    )
    .max(3),
  generatedAt: z.string().datetime(),
});
export type PlayerPlaystylePublicInsight = z.infer<typeof PlayerPlaystylePublicInsightSchema>;

export const PlayerPlaystyleResponseSchema = z.object({
  disclaimer: z.literal(CHAMPION_STATS_DISCLAIMER),
  aiDisclaimer: z.literal(PLAYER_PLAYSTYLE_AI_DISCLAIMER),
  rankSemantics: z.literal(RANK_TIER_SEMANTICS),
  sampleScope: PlayerPlaystyleSampleScopeSchema,
  mix: z.array(PlayerPlaystyleMixEntrySchema),
  overall: z.object({
    comparisons: z.array(PlayerMetricComparisonSchema),
  }),
  championSlices: z.array(PlayerPlaystyleChampionSliceSchema),
  skipped: z.object({
    remake: z.number().int().min(0),
    incomplete: z.number().int().min(0),
    unknownPosition: z.number().int().min(0),
    noBaseline: z.number().int().min(0),
  }),
  ai: z.object({
    status: PlayerAiInsightStatusSchema,
    emptyReason: PlayerPlaystyleEmptyReasonSchema.optional(),
    insight: PlayerPlaystylePublicInsightSchema.nullable(),
  }),
});
export type PlayerPlaystyleResponse = z.infer<typeof PlayerPlaystyleResponseSchema>;

const PlayerPlaystyleEvidenceIdsSchema = z.array(z.string().min(1)).min(1);

export const PlayerPlaystyleGroundedClaimSchema = z.object({
  text: z.string().min(40).max(400),
  evidence: PlayerPlaystyleEvidenceIdsSchema,
});
export type PlayerPlaystyleGroundedClaim = z.infer<typeof PlayerPlaystyleGroundedClaimSchema>;

export const PlayerPlaystyleStoredInsightSchema = z.object({
  summary: z.object({
    text: z.string().min(80).max(600),
    evidence: PlayerPlaystyleEvidenceIdsSchema,
  }),
  economy: PlayerPlaystyleGroundedClaimSchema.nullable(),
  combat: PlayerPlaystyleGroundedClaimSchema.nullable(),
  strengths: z.array(PlayerPlaystyleGroundedClaimSchema).max(3),
  tradeoffs: z.array(PlayerPlaystyleGroundedClaimSchema).max(3),
  championTendencies: z
    .array(
      z.object({
        championKey: z.string().min(1),
        position: ChampionRankingPositionSchema,
        text: z.string().min(40).max(500),
        evidence: PlayerPlaystyleEvidenceIdsSchema,
      }),
    )
    .max(3),
});
export type PlayerPlaystyleStoredInsight = z.infer<typeof PlayerPlaystyleStoredInsightSchema>;
