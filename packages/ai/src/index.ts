export { buildChampionInsightContext, listEvidenceIds } from './context/builder';
export {
  FINGERPRINT_VOLATILE_KEYS,
  fingerprintCanonicalPayload,
} from './context/canonical-fingerprint';
export {
  fingerprintChampionInsightContext,
  fingerprintPlayerPlaystyleContext,
} from './context/fingerprint';
export { buildPlayerPlaystyleContext } from './context/player-playstyle-builder';
export {
  buildPlayerPlaystyleEvidenceHandleMapping,
  buildPlayerPlaystyleGenerationPayload,
} from './context/player-playstyle-evidence';
export {
  ChampionInsightAbilitySchema,
  ChampionInsightBuildRowSchema,
  ChampionInsightContextSchema,
  ChampionInsightEvidenceEntrySchema,
  ChampionInsightMatchupRowSchema,
  ChampionInsightPerformanceSchema,
} from './context/types';
export type {
  ChampionInsightAbility,
  ChampionInsightBuildRow,
  ChampionInsightContext,
  ChampionInsightContextInput,
  ChampionInsightEvidenceEntry,
  ChampionInsightMatchupRow,
  ChampionInsightPerformance,
} from './context/types';
export type {
  ChampionInsightFingerprintInput,
  PlayerPlaystyleFingerprintInput,
} from './context/fingerprint';
export {
  PlayerPlaystyleChampionSliceSchema,
  PlayerPlaystyleEvidenceEntrySchema,
  PlayerPlaystyleInternalContextSchema,
  PlayerPlaystyleMatchIdentitySchema,
  PlayerPlaystyleMixEntrySchema,
  PlayerPlaystyleOutputPolicySchema,
} from './context/player-playstyle-types';
export type {
  PlayerPlaystyleBuilderInput,
  PlayerPlaystyleChampionSlice,
  PlayerPlaystyleEvidenceEntry,
  PlayerPlaystyleGenerationPayload,
  PlayerPlaystyleInternalContext,
  PlayerPlaystyleMatchIdentity,
  PlayerPlaystyleMixEntry,
  PlayerPlaystyleOutputPolicy,
} from './context/player-playstyle-types';
export { PLAYER_PLAYSTYLE_PROMPT_VERSION } from '@league-helper/shared';
export {
  buildPlayerPlaystyleSystemPrompt,
  buildPlayerPlaystyleUserPrompt,
} from './prompts/player-playstyle-v1';
export {
  PlayerPlaystyleValidationError,
  validatePlayerPlaystyleInsight,
} from './validation/player-playstyle-output';
export type {
  PlayerPlaystyleValidationCode,
  PlayerPlaystyleValidationDetails,
  PlayerPlaystyleValidationReason,
} from './validation/player-playstyle-output';
export { ChampionAiInsightValidationError, validateChampionAiInsight } from './validation/output';
export type {
  ChampionAiInsightValidationCode,
  ChampionAiInsightValidationDetails,
  ChampionAiInsightValidationReason,
} from './validation/output';
export {
  championAiValidationDiagnostic,
  formatChampionAiValidationDiagnostic,
} from './validation/diagnostic';
export type { ChampionAiValidationDiagnostic } from './validation/diagnostic';
export { buildChampionInsightRepairMessage } from './validation/repair-message';
export {
  buildChampionInsightGenerationPayload,
  buildChampionInsightOutputPolicy,
  buildEvidenceHandleMapping,
} from './context/evidence-handles';
export type { ChampionInsightOutputPolicy, GenerationEvidence } from './context/evidence-handles';
export {
  CHAMPION_AI_PROMPT_VERSION,
  buildChampionInsightSystemPrompt,
  buildChampionInsightUserPrompt,
} from './prompts/champion-insight-v1';
export { AiProviderError } from './provider/errors';
export { OpenAiCompatibleProvider } from './provider/openai-compatible';
export type {
  AiGenerationRawResult,
  AiGenerationRequest,
  AiProvider,
  OpenAiCompatibleProviderConfig,
} from './provider/types';
export {
  CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA,
  CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME,
} from './generation/stored-insight.json-schema';
export {
  PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA,
  PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA_NAME,
} from './generation/stored-player-playstyle.json-schema';
export {
  AiOutputValidationError,
  generateChampionInsight,
} from './generation/generate-champion-insight';
export { generatePlayerPlaystyle } from './generation/generate-player-playstyle';
export type {
  GenerateChampionInsightConfig,
  GenerateChampionInsightInput,
} from './generation/generate-champion-insight';
export type {
  GeneratePlayerPlaystyleConfig,
  GeneratePlayerPlaystyleInput,
} from './generation/generate-player-playstyle';
