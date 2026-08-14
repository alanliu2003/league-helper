import { z } from 'zod';
import {
  ChampionAbilitySlotSchema,
  ChampionBuildSampleBandSchema,
  ChampionRankingPositionSchema,
  ConfidenceIntervalSchema,
  SampleConfidenceSchema,
  type ChampionAbilitySummary,
  type ChampionAggregateMetrics,
  type ChampionBootRow,
  type ChampionCoreBuild,
  type ChampionExactStats,
  type ChampionMatchupRow,
  type ChampionRankingPosition,
  type ChampionRuneSetup,
  type ChampionSkillOrderRow,
  type ChampionSpellPair,
  type ChampionStartingItemSet,
} from '@league-helper/shared';

export type ChampionInsightBuildsInput = {
  coreBuilds: ChampionCoreBuild[];
  startingItems: ChampionStartingItemSet[];
  boots: ChampionBootRow[];
  runes: ChampionRuneSetup[];
  summonerSpells: ChampionSpellPair[];
  skillOrder: ChampionSkillOrderRow[];
};

export type ChampionInsightContextInput = {
  champion: {
    championId: number;
    championKey: string;
    name: string;
    position: ChampionRankingPosition;
  };
  scope: {
    patch: string;
    platform: string;
    queueId: number;
    tier: string;
    kind?: 'COLLECTED_SAMPLE';
  };
  stats: ChampionExactStats | ChampionAggregateMetrics | null;
  builds: ChampionInsightBuildsInput;
  matchups: {
    strongAgainst: ChampionMatchupRow[];
    weakAgainst: ChampionMatchupRow[];
  };
  abilities: ChampionAbilitySummary[];
  opponentAbilities?: Array<{
    championKey: string;
    abilities: ChampionAbilitySummary[];
  }>;
};

const FiniteNumberSchema = z.number().finite();

export const ChampionInsightEvidenceEntrySchema = z.object({
  id: z.string().min(1),
  interpretationAllowed: z.boolean(),
});
export type ChampionInsightEvidenceEntry = z.infer<typeof ChampionInsightEvidenceEntrySchema>;

export const ChampionInsightPerformanceSchema = z.object({
  sampleSize: z.number().int().nonnegative().optional(),
  wins: z.number().int().nonnegative().optional(),
  winRate: FiniteNumberSchema.nullable().optional(),
  sampleConfidence: SampleConfidenceSchema.optional(),
  wilsonInterval: ConfidenceIntervalSchema.optional(),
  aggregateKdaRatio: FiniteNumberSchema.optional(),
  averageCsPerMinute: FiniteNumberSchema.optional(),
  averageDamagePerMinute: FiniteNumberSchema.optional(),
  averageVisionScorePerMinute: FiniteNumberSchema.optional(),
  averageGoldDifferenceAt10: FiniteNumberSchema.optional(),
  averageGoldDifferenceAt15: FiniteNumberSchema.optional(),
  averageCsDifferenceAt10: FiniteNumberSchema.optional(),
  averageCsDifferenceAt15: FiniteNumberSchema.optional(),
  interpretationAllowed: z.boolean(),
});
export type ChampionInsightPerformance = z.infer<typeof ChampionInsightPerformanceSchema>;

export const ChampionInsightBuildRowSchema = z.object({
  name: z.string().min(1),
  sampleSize: z.number().int().nonnegative(),
  pickRate: FiniteNumberSchema.nullable(),
  winRate: FiniteNumberSchema.nullable(),
  sampleBand: ChampionBuildSampleBandSchema,
  interpretationAllowed: z.boolean(),
});
export type ChampionInsightBuildRow = z.infer<typeof ChampionInsightBuildRowSchema>;

export const ChampionInsightMatchupRowSchema = z.object({
  opponentChampionKey: z.string().min(1),
  opponentName: z.string().min(1),
  sampleSize: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  winRate: FiniteNumberSchema.nullable(),
  lowSample: z.boolean(),
  sampleConfidence: SampleConfidenceSchema,
  averageGoldDifferenceAt10: FiniteNumberSchema.optional(),
  averageGoldDifferenceAt15: FiniteNumberSchema.optional(),
  averageCsDifferenceAt10: FiniteNumberSchema.optional(),
  averageCsDifferenceAt15: FiniteNumberSchema.optional(),
  interpretationAllowed: z.boolean(),
});
export type ChampionInsightMatchupRow = z.infer<typeof ChampionInsightMatchupRowSchema>;

export const ChampionInsightAbilitySchema = z.object({
  championKey: z.string().min(1),
  slot: ChampionAbilitySlotSchema,
  name: z.string().min(1),
  description: z.string(),
  cooldown: z.string().min(1).optional(),
  cost: z.string().min(1).optional(),
  range: z.string().min(1).optional(),
});
export type ChampionInsightAbility = z.infer<typeof ChampionInsightAbilitySchema>;

export const ChampionInsightContextSchema = z.object({
  champion: z.object({
    championId: z.number().int(),
    championKey: z.string().min(1),
    name: z.string().min(1),
    position: ChampionRankingPositionSchema,
  }),
  scope: z.object({
    patch: z.string().min(1),
    platform: z.string().min(1),
    queueId: z.number().int().nonnegative(),
    tier: z.string().min(1),
    kind: z.literal('COLLECTED_SAMPLE'),
  }),
  performance: ChampionInsightPerformanceSchema,
  builds: z.object({
    coreBuilds: z.array(ChampionInsightBuildRowSchema).max(2),
    startingItems: z.array(ChampionInsightBuildRowSchema).max(1),
    boots: z.array(ChampionInsightBuildRowSchema).max(1),
    runes: z.array(ChampionInsightBuildRowSchema).max(1),
    summonerSpells: z.array(ChampionInsightBuildRowSchema).max(1),
    skillOrder: z.array(ChampionInsightBuildRowSchema).max(1),
  }),
  matchups: z.object({
    strongAgainst: z.array(ChampionInsightMatchupRowSchema).max(3),
    weakAgainst: z.array(ChampionInsightMatchupRowSchema).max(3),
  }),
  abilities: z.array(ChampionInsightAbilitySchema),
  opponentAbilities: z.array(
    z.object({
      championKey: z.string().min(1),
      abilities: z.array(ChampionInsightAbilitySchema),
    }),
  ),
  generationEligible: z.boolean(),
  performanceConclusionsAllowed: z.boolean(),
  buildInsightAllowed: z.boolean(),
  matchupExplanationsAllowed: z.boolean(),
  evidenceCatalog: z.array(ChampionInsightEvidenceEntrySchema),
});
export type ChampionInsightContext = z.infer<typeof ChampionInsightContextSchema>;
