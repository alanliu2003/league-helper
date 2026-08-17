import type {
  ChampionRankingPosition,
  PlayerMetricComparison,
  PlayerPlaystyleDirection,
  PlayerPlaystyleMetricId,
  PlayerPlaystyleSampleBand,
} from '@league-helper/shared';
import type { EvidenceKind } from './evidence-handles';

export type PlayerPlaystyleMatchIdentity = {
  matchId: string;
  participantId: number;
};

export type PlayerPlaystyleMixEntry = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
  matchCount: number;
};

export type PlayerPlaystyleChampionSlice = {
  championKey: string;
  championName: string;
  position: ChampionRankingPosition;
  matchCount: number;
  sampleBand: PlayerPlaystyleSampleBand;
  comparisons: PlayerMetricComparison[];
};

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

export type PlayerPlaystyleEvidenceEntry = {
  id: string;
  interpretationAllowed: boolean;
};

export type PlayerPlaystyleOutputPolicy = {
  economyAllowed: boolean;
  combatAllowed: boolean;
  championTendenciesAllowed: boolean;
};

export type PlayerPlaystyleInternalContext = {
  subject: { label: 'player' };
  scope: {
    queueId: 420;
    queueLabel: string;
    kind: 'COLLECTED_SAMPLE';
    patchRange: { min: string; max: string } | null;
  };
  mix: PlayerPlaystyleMixEntry[];
  playerSample: {
    matchesAnalyzed: number;
    comparableMatchCount: number;
    wins: number;
    playerSampleBand: PlayerPlaystyleSampleBand;
    generationEligible: boolean;
  };
  overall: { comparisons: PlayerMetricComparison[] };
  championSlices: PlayerPlaystyleChampionSlice[];
  skipped: PlayerPlaystyleBuilderProfile['skipped'];
  windowSize: number;
  matchIdentity: PlayerPlaystyleMatchIdentity[];
  evidenceCatalog: PlayerPlaystyleEvidenceEntry[];
  outputPolicy: PlayerPlaystyleOutputPolicy;
  generationEligible: boolean;
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
