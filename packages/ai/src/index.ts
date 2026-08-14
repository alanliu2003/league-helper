export { buildChampionInsightContext, listEvidenceIds } from './context/builder';
export { fingerprintChampionInsightContext } from './context/fingerprint';
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
export type { ChampionInsightFingerprintInput } from './context/fingerprint';
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
export type {
  ChampionInsightOutputPolicy,
  GenerationEvidence,
} from './context/evidence-handles';
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
  AiOutputValidationError,
  generateChampionInsight,
} from './generation/generate-champion-insight';
export type {
  GenerateChampionInsightConfig,
  GenerateChampionInsightInput,
} from './generation/generate-champion-insight';
