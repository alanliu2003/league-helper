import { z } from 'zod';
import {
  ChampionAbilitySummarySchema,
  ChampionAggregateMetricsSchema,
  ChampionBootRowSchema,
  ChampionCoreBuildSchema,
  ChampionMatchupRowSchema,
  ChampionRankingPositionSchema,
  ChampionRuneSetupSchema,
  ChampionSkillOrderRowSchema,
  ChampionSpellPairSchema,
  ChampionStartingItemSetSchema,
} from '@league-helper/shared';

const ChampionInsightEvalOpponentAbilitiesSchema = z.object({
  championKey: z.string().min(1),
  abilities: z.array(ChampionAbilitySummarySchema),
});

export const ChampionInsightContextInputSchema = z.object({
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
    kind: z.literal('COLLECTED_SAMPLE').optional(),
  }),
  stats: ChampionAggregateMetricsSchema.nullable(),
  builds: z.object({
    coreBuilds: z.array(ChampionCoreBuildSchema),
    startingItems: z.array(ChampionStartingItemSetSchema),
    boots: z.array(ChampionBootRowSchema),
    runes: z.array(ChampionRuneSetupSchema),
    summonerSpells: z.array(ChampionSpellPairSchema),
    skillOrder: z.array(ChampionSkillOrderRowSchema),
  }),
  matchups: z.object({
    strongAgainst: z.array(ChampionMatchupRowSchema),
    weakAgainst: z.array(ChampionMatchupRowSchema),
  }),
  abilities: z.array(ChampionAbilitySummarySchema),
  opponentAbilities: z.array(ChampionInsightEvalOpponentAbilitiesSchema).optional(),
});

export const ChampionInsightEvalFixtureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).optional(),
  expectGenerationEligible: z.boolean(),
  expectPerformanceConclusionsAllowed: z.boolean(),
  expectBuildInsightAllowed: z.boolean(),
  expectMatchupExplanationsAllowed: z.boolean().optional(),
  expectEvidenceContains: z.array(z.string().min(1)).optional(),
  expectEvidenceNotCitable: z.array(z.string().min(1)).optional(),
  input: ChampionInsightContextInputSchema,
});

export type ChampionInsightEvalFixture = z.infer<typeof ChampionInsightEvalFixtureSchema>;
