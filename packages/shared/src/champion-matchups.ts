import { z } from 'zod';
import {
  CHAMPION_STATS_DISCLAIMER,
  ChampionRankingPositionSchema,
  ChampionStatsQuerySchema,
  ChampionStatsResolvedFiltersSchema,
  ConfidenceIntervalSchema,
  RANK_TIER_SEMANTICS,
  SampleConfidenceSchema,
  SampleScopeSchema,
} from './champion-api';
import { parseRankScopeCacheToken } from './rank-scope';

const FiniteNumberSchema = z.number().finite();

export const ChampionMatchupOpponentSchema = z.object({
  championId: z.number().int().positive(),
  championKey: z.string().min(1),
  name: z.string().min(1),
  iconUrl: z.string().url().nullable(),
});
export type ChampionMatchupOpponent = z.infer<typeof ChampionMatchupOpponentSchema>;

export const ChampionMatchupRowSchema = z.object({
  opponent: ChampionMatchupOpponentSchema,
  position: ChampionRankingPositionSchema,
  sampleSize: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  winRate: FiniteNumberSchema.nullable(),
  wilsonInterval: ConfidenceIntervalSchema.nullable(),
  sampleConfidence: SampleConfidenceSchema,
  lowSample: z.boolean(),
  averageGoldDifferenceAt10: FiniteNumberSchema.nullable(),
  averageGoldDifferenceAt15: FiniteNumberSchema.nullable(),
  averageCsDifferenceAt10: FiniteNumberSchema.nullable(),
  averageCsDifferenceAt15: FiniteNumberSchema.nullable(),
});
export type ChampionMatchupRow = z.infer<typeof ChampionMatchupRowSchema>;

export const ChampionMatchupsEmptyReasonSchema = z.enum([
  'NO_ELIGIBLE_MATCHUPS',
  'UNKNOWN_RANK_HIDDEN',
  'POSITION_REQUIRED',
]);
export type ChampionMatchupsEmptyReason = z.infer<typeof ChampionMatchupsEmptyReasonSchema>;

export const ChampionMatchupsQuerySchema = ChampionStatsQuerySchema.extend({
  position: ChampionRankingPositionSchema,
  rankScope: z
    .string()
    .min(1)
    .refine(
      (token) => {
        try {
          parseRankScopeCacheToken(token);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid rankScope' },
    )
    .optional(),
});
export type ChampionMatchupsQuery = z.infer<typeof ChampionMatchupsQuerySchema>;

export const ChampionMatchupsResponseSchema = z.object({
  disclaimer: z.literal(CHAMPION_STATS_DISCLAIMER),
  rankTierSemantics: z.literal(RANK_TIER_SEMANTICS),
  sampleScope: SampleScopeSchema,
  resolvedFilters: ChampionStatsResolvedFiltersSchema,
  emptyReason: ChampionMatchupsEmptyReasonSchema.nullable(),
  displayFloor: z.number().int().positive(),
  rankingPolicy: z.literal('WILSON_LOWER_BOUND'),
  totalEligiblePairs: z.number().int().nonnegative(),
  totalSourcePairs: z.number().int().nonnegative(),
  strongAgainst: z.array(ChampionMatchupRowSchema),
  weakAgainst: z.array(ChampionMatchupRowSchema),
});
export type ChampionMatchupsResponse = z.infer<typeof ChampionMatchupsResponseSchema>;
