import { z } from 'zod';
import {
  ChampionRankingPositionSchema,
  PlayerMetricComparisonSchema,
  PlayerPlaystyleSampleBandSchema,
  PlayerPlaystyleStoredInsightSchema,
} from '@league-helper/shared';

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

export const PlayerPlaystyleBuilderProfileSchema = z.object({
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
});

export const PlayerPlaystyleBuilderInputSchema = z.object({
  profile: PlayerPlaystyleBuilderProfileSchema,
  matchIdentity: z.array(
    z.object({
      matchId: z.string().min(1),
      participantId: z.number().int(),
    }),
  ),
  queueId: z.literal(420),
  playerAccountId: z.string().min(1).optional(),
});

export const PlayerPlaystyleEvalFixtureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  expectGenerationEligible: z.boolean(),
  expectEconomyAllowed: z.boolean(),
  expectCombatAllowed: z.boolean(),
  expectSliceChampionKeys: z.array(z.string().min(1)),
  expectEvidenceNotCitable: z.array(z.string().min(1)),
  expectOverallCsPlayerValueNull: z.boolean(),
  expectNoOverallKda: z.boolean(),
  expectEvidenceContains: z.array(z.string().min(1)).optional(),
  expectWindowIdentity: z.boolean().optional(),
  expectUsedAllTierFallback: z.boolean().optional(),
  invalidModelOutput: z.union([z.string().min(1), PlayerPlaystyleStoredInsightSchema]).optional(),
  expectSliceCsBaselineValue: z.number().finite().optional(),
  expectSliceCsPlayerValue: z.number().finite().optional(),
  input: PlayerPlaystyleBuilderInputSchema,
});

export type PlayerPlaystyleEvalFixture = z.infer<typeof PlayerPlaystyleEvalFixtureSchema>;
