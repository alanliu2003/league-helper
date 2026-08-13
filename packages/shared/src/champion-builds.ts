import { z } from 'zod';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionRankingPositionSchema,
  ChampionStatsQuerySchema,
  ChampionStatsResolvedFiltersSchema,
  RANK_TIER_SEMANTICS,
  SampleScopeSchema,
} from './champion-api';

const FiniteNumberSchema = z.number().finite();

export const ChampionBuildSampleBandSchema = z.enum([
  'BELOW_DISPLAY',
  'EXPLORATORY',
  'CREDIBLE',
  'STRONG',
]);
export type ChampionBuildSampleBand = z.infer<typeof ChampionBuildSampleBandSchema>;

export const ChampionBuildStaticIdentitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  iconUrl: z.string().url().nullable(),
});
export type ChampionBuildStaticIdentity = z.infer<typeof ChampionBuildStaticIdentitySchema>;

export const ChampionBuildRowMetricsSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  pickRate: FiniteNumberSchema.nullable(),
  wins: z.number().int().nonnegative(),
  winRate: FiniteNumberSchema.nullable(),
  lowSample: z.boolean(),
  sampleBand: ChampionBuildSampleBandSchema,
});
export type ChampionBuildRowMetrics = z.infer<typeof ChampionBuildRowMetricsSchema>;

export const ChampionStartingItemSetSchema = ChampionBuildRowMetricsSchema.extend({
  items: z.array(ChampionBuildStaticIdentitySchema),
});
export type ChampionStartingItemSet = z.infer<typeof ChampionStartingItemSetSchema>;

export const ChampionCoreBuildSchema = ChampionBuildRowMetricsSchema.extend({
  items: z.array(ChampionBuildStaticIdentitySchema).length(3),
});
export type ChampionCoreBuild = z.infer<typeof ChampionCoreBuildSchema>;

export const ChampionBootRowSchema = ChampionBuildRowMetricsSchema.extend({
  item: ChampionBuildStaticIdentitySchema,
});
export type ChampionBootRow = z.infer<typeof ChampionBootRowSchema>;

export const ChampionRuneSetupSchema = ChampionBuildRowMetricsSchema.extend({
  keystone: ChampionBuildStaticIdentitySchema.nullable(),
  primaryPerks: z.array(ChampionBuildStaticIdentitySchema),
  secondaryPerks: z.array(ChampionBuildStaticIdentitySchema),
  statShards: z.array(ChampionBuildStaticIdentitySchema),
  primaryStyleName: z.string().min(1).nullable(),
  secondaryStyleName: z.string().min(1).nullable(),
  stylesComplete: z.boolean(),
});
export type ChampionRuneSetup = z.infer<typeof ChampionRuneSetupSchema>;

export const ChampionSpellPairSchema = ChampionBuildRowMetricsSchema.extend({
  spells: z.tuple([ChampionBuildStaticIdentitySchema, ChampionBuildStaticIdentitySchema]),
});
export type ChampionSpellPair = z.infer<typeof ChampionSpellPairSchema>;

export const ChampionSkillKeySchema = z.enum(['Q', 'W', 'E', 'R']);
export type ChampionSkillKey = z.infer<typeof ChampionSkillKeySchema>;

export const ChampionSkillOrderRowSchema = ChampionBuildRowMetricsSchema.extend({
  maxOrder: z.array(z.enum(['Q', 'W', 'E'])),
  levelSequence: z.array(ChampionSkillKeySchema),
});
export type ChampionSkillOrderRow = z.infer<typeof ChampionSkillOrderRowSchema>;

export const ChampionBuildsEmptyReasonSchema = z.enum([
  'NO_MATCHING_BUILDS',
  'CHAMPION_HAS_NO_BUILDS',
  'UNKNOWN_RANK_HIDDEN',
  'POSITION_REQUIRED',
]);
export type ChampionBuildsEmptyReason = z.infer<typeof ChampionBuildsEmptyReasonSchema>;

export const ChampionBuildsQuerySchema = ChampionStatsQuerySchema.extend({
  position: ChampionRankingPositionSchema,
});
export type ChampionBuildsQuery = z.infer<typeof ChampionBuildsQuerySchema>;

export const ChampionBuildsResponseSchema = z.object({
  disclaimer: z.literal(CHAMPION_STATS_DISCLAIMER),
  rankTierSemantics: z.literal(RANK_TIER_SEMANTICS),
  sampleScope: SampleScopeSchema,
  resolvedFilters: ChampionStatsResolvedFiltersSchema,
  emptyReason: ChampionBuildsEmptyReasonSchema.nullable(),
  eligibility: z.object({
    startingItemsEligibleGames: z.number().int().nonnegative(),
    coreBuildsEligibleGames: z.number().int().nonnegative(),
    bootsEligibleGames: z.number().int().nonnegative(),
    runesEligibleGames: z.number().int().nonnegative(),
    summonerSpellsEligibleGames: z.number().int().nonnegative(),
    skillOrderEligibleGames: z.number().int().nonnegative(),
  }),
  startingItems: z.array(ChampionStartingItemSetSchema),
  coreBuilds: z.array(ChampionCoreBuildSchema),
  boots: z.array(ChampionBootRowSchema),
  runes: z.array(ChampionRuneSetupSchema),
  summonerSpells: z.array(ChampionSpellPairSchema),
  skillOrder: z.array(ChampionSkillOrderRowSchema),
});
export type ChampionBuildsResponse = z.infer<typeof ChampionBuildsResponseSchema>;
