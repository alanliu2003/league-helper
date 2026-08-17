import { z } from 'zod';
import {
  ChampionRankingPositionSchema,
  PlayerMetricComparisonSchema,
  PlayerPlaystyleSampleBandSchema,
  RANKED_SOLO_QUEUE_ID,
  type ChampionRankingPosition,
  type PlayerMetricComparison,
  type PlayerPlaystyleDirection,
  type PlayerPlaystyleMetricId,
  type PlayerPlaystyleSampleBand,
} from '@league-helper/shared';
import type { EvidenceKind } from './evidence-handles';

export const PlayerPlaystyleMatchIdentitySchema = z.object({
  matchId: z.string().min(1),
  participantId: z.number().int(),
});

export const PlayerPlaystyleMixEntrySchema = z.object({
  championKey: z.string().min(1),
  championName: z.string().min(1),
  position: ChampionRankingPositionSchema,
  matchCount: z.number().int().min(0),
});

export const PlayerPlaystyleChampionSliceSchema = z.object({
  championKey: z.string().min(1),
  championName: z.string().min(1),
  position: ChampionRankingPositionSchema,
  matchCount: z.number().int().min(0),
  sampleBand: PlayerPlaystyleSampleBandSchema,
  comparisons: z.array(PlayerMetricComparisonSchema),
});

export const PlayerPlaystyleEvidenceEntrySchema = z.object({
  id: z.string().min(1),
  interpretationAllowed: z.boolean(),
});

export const PlayerPlaystyleOutputPolicySchema = z.object({
  economyAllowed: z.boolean(),
  combatAllowed: z.boolean(),
  championTendenciesAllowed: z.boolean(),
});

export const PlayerPlaystyleInternalContextSchema = z.object({
  subject: z.object({ label: z.literal('player') }),
  scope: z.object({
    queueId: z.literal(RANKED_SOLO_QUEUE_ID),
    queueLabel: z.string().min(1),
    kind: z.literal('COLLECTED_SAMPLE'),
    patchRange: z
      .object({
        min: z.string().min(1),
        max: z.string().min(1),
      })
      .nullable(),
  }),
  mix: z.array(PlayerPlaystyleMixEntrySchema),
  playerSample: z.object({
    matchesAnalyzed: z.number().int().min(0),
    comparableMatchCount: z.number().int().min(0),
    wins: z.number().int().min(0),
    playerSampleBand: PlayerPlaystyleSampleBandSchema,
    generationEligible: z.boolean(),
  }),
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
  windowSize: z.number().int().min(0),
  matchIdentity: z.array(PlayerPlaystyleMatchIdentitySchema),
  evidenceCatalog: z.array(PlayerPlaystyleEvidenceEntrySchema),
  outputPolicy: PlayerPlaystyleOutputPolicySchema,
  generationEligible: z.boolean(),
});

export type PlayerPlaystyleMatchIdentity = z.infer<typeof PlayerPlaystyleMatchIdentitySchema>;
export type PlayerPlaystyleMixEntry = z.infer<typeof PlayerPlaystyleMixEntrySchema>;
export type PlayerPlaystyleChampionSlice = z.infer<typeof PlayerPlaystyleChampionSliceSchema>;
export type PlayerPlaystyleEvidenceEntry = z.infer<typeof PlayerPlaystyleEvidenceEntrySchema>;
export type PlayerPlaystyleOutputPolicy = z.infer<typeof PlayerPlaystyleOutputPolicySchema>;
export type PlayerPlaystyleInternalContext = z.infer<typeof PlayerPlaystyleInternalContextSchema>;

export type PlayerPlaystyleBuilderProfile = {
  windowSize: number;
  matchesAnalyzed: number;
  comparableMatchCount: number;
  wins: number;
  playerSampleBand: PlayerPlaystyleSampleBand;
  patchRange: { min: string; max: string } | null;
  mix: PlayerPlaystyleMixEntry[];
  overall: { comparisons: PlayerMetricComparison[] };
  championSlices: PlayerPlaystyleChampionSlice[];
  skipped: {
    remake: number;
    incomplete: number;
    unknownPosition: number;
    noBaseline: number;
  };
};

export type PlayerPlaystyleBuilderInput = {
  profile: PlayerPlaystyleBuilderProfile;
  matchIdentity: PlayerPlaystyleMatchIdentity[];
  queueId: 420;
  playerAccountId?: string;
};

export type PlayerPlaystyleGenerationComparison = {
  metric: PlayerPlaystyleMetricId;
  direction: PlayerPlaystyleDirection;
  interpretationAllowed: boolean;
  usedAllTierFallback: boolean;
};

export type PlayerPlaystyleGenerationMixEntry = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
};

export type PlayerPlaystyleGenerationSlice = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
  sampleBand: PlayerPlaystyleSampleBand;
  comparisons: PlayerPlaystyleGenerationComparison[];
};

export type PlayerPlaystyleGenerationEvidence = {
  handle: string;
  kind: EvidenceKind;
  topic: string;
};

export type PlayerPlaystyleGenerationPayload = {
  subject: { label: 'player' };
  scope: PlayerPlaystyleInternalContext['scope'];
  mix: PlayerPlaystyleGenerationMixEntry[];
  playerSample: {
    playerSampleBand: PlayerPlaystyleSampleBand;
    generationEligible: boolean;
  };
  overall: { comparisons: PlayerPlaystyleGenerationComparison[] };
  championSlices: PlayerPlaystyleGenerationSlice[];
  outputPolicy: PlayerPlaystyleOutputPolicy;
  generationEligible: boolean;
  evidence: PlayerPlaystyleGenerationEvidence[];
};
