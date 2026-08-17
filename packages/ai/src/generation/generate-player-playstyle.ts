import type { PlayerPlaystyleStoredInsight } from '@league-helper/shared';
import type { PlayerPlaystyleInternalContext } from '../context/player-playstyle-types';
import {
  buildPlayerPlaystyleSystemPrompt,
  buildPlayerPlaystyleUserPrompt,
} from '../prompts/player-playstyle-v1';
import type { AiProvider } from '../provider/types';
import {
  PlayerPlaystyleValidationError,
  validatePlayerPlaystyleInsight,
} from '../validation/player-playstyle-output';
import { AiOutputValidationError } from './ai-output-validation-error';
import {
  PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA,
  PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA_NAME,
} from './stored-player-playstyle.json-schema';

export { AiOutputValidationError };

export type GeneratePlayerPlaystyleConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxRepairAttempts?: number;
};

export type GeneratePlayerPlaystyleInput = {
  provider: AiProvider;
  context: PlayerPlaystyleInternalContext;
  config: GeneratePlayerPlaystyleConfig;
};

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

export async function generatePlayerPlaystyle(
  input: GeneratePlayerPlaystyleInput,
): Promise<PlayerPlaystyleStoredInsight> {
  const { provider, context, config } = input;
  const temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRepairAttempts = config.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;

  const system = buildPlayerPlaystyleSystemPrompt();
  const originalUser = buildPlayerPlaystyleUserPrompt(context);

  const generate = async (user: string) =>
    provider.generate({
      system,
      user,
      jsonSchema: PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA,
      jsonSchemaName: PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA_NAME,
      temperature,
      maxOutputTokens,
      timeoutMs,
    });

  let userPrompt = originalUser;
  let lastValidationError: PlayerPlaystyleValidationError | undefined;
  const totalAttempts = 1 + Math.max(0, maxRepairAttempts);

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (attempt > 0 && lastValidationError) {
      userPrompt = buildRepairUserPrompt(originalUser, lastValidationError);
    }

    const raw = await generate(userPrompt);
    try {
      return validatePlayerPlaystyleInsight(raw.content, context);
    } catch (error) {
      if (!(error instanceof PlayerPlaystyleValidationError)) {
        throw error;
      }
      lastValidationError = error;
    }
  }

  throw new AiOutputValidationError('Player playstyle insight output failed validation.', {
    cause:
      lastValidationError ??
      new PlayerPlaystyleValidationError('SCHEMA', 'Insight output is invalid.'),
  });
}

function unknownHandleLabel(error: PlayerPlaystyleValidationError): string {
  return error.details.handle ?? 'unknown';
}

function buildPlayerPlaystyleRepairMessage(error: PlayerPlaystyleValidationError): string {
  switch (error.details.reason) {
    case 'UNKNOWN_EVIDENCE_HANDLE':
      return [
        `Your previous output used an unknown evidence handle: ${unknownHandleLabel(error)}.`,
        'Use only the evidence handles listed in the input.',
      ].join('\n');
    case 'UNKNOWN_EVIDENCE_ID':
      return [
        'Your previous output used an unknown evidence id.',
        'Use only the evidence handles listed in the input (E1, E2, E3, ...).',
      ].join('\n');
    case 'UNSUPPORTED_NUMERIC_TOKEN':
      if (error.details.tokenKind === 'timing') {
        return [
          'Your previous response restated an analytics timing value using digits.',
          'Do not mention exact minute checkpoints such as "10 minutes" or "15 minutes".',
          'Rewrite the sentence qualitatively, for example "early-game checkpoints".',
          'Do not change the evidence selection.',
        ].join('\n');
      }
      return [
        'Your previous output contained an analytics number.',
        'Rewrite all analytics values qualitatively. Do not include digits for CS/min, GPM, DPM, KDA, deltas, sample sizes, or percentages.',
      ].join('\n');
    case 'MISSING_STATISTICAL_EVIDENCE':
      return [
        'Each claim must cite at least one statistical evidence handle (kind: statistical).',
        'SCOPE and warning handles cannot be the only evidence.',
      ].join('\n');
    case 'MISSING_SLICE_EVIDENCE':
      return [
        'Each champion tendency must cite at least one allowed SLICE_* evidence handle for that championKey and position.',
      ].join('\n');
    case 'ECONOMY_NOT_ALLOWED':
      return ['economy MUST be null because economyAllowed is false.'].join('\n');
    case 'COMBAT_NOT_ALLOWED':
      return ['combat MUST be null because combatAllowed is false.'].join('\n');
    case 'CHAMPION_TENDENCIES_NOT_ALLOWED':
      return ['championTendencies MUST be [] because championTendenciesAllowed is false.'].join(
        '\n',
      );
    case 'DISALLOWED_CHAMPION_TENDENCY':
      return [
        'championTendencies may only use championKey and position pairs from the supplied slices.',
      ].join('\n');
    case 'HTML_NOT_ALLOWED':
      return ['Your previous output contained HTML.', 'Return plain text only.'].join('\n');
    case 'INVALID_JSON':
      return [
        'Your previous output was not valid JSON.',
        'Return JSON only. Do not include markdown or commentary.',
      ].join('\n');
    case 'SCHEMA_MISMATCH':
      return [
        'Your previous output did not match the required JSON schema.',
        error.message.length > 400 ? `${error.message.slice(0, 397)}...` : error.message,
      ].join('\n');
    default:
      return [
        'The previous JSON failed validation and must be corrected.',
        error.message.length > 400 ? `${error.message.slice(0, 397)}...` : error.message,
      ].join('\n');
  }
}

function buildRepairUserPrompt(
  originalUser: string,
  error: PlayerPlaystyleValidationError,
): string {
  return [
    originalUser,
    '',
    '--- VALIDATION ERROR ---',
    'The previous JSON failed validation and must be corrected.',
    buildPlayerPlaystyleRepairMessage(error),
    'Return corrected JSON only. Do not include markdown or commentary.',
  ].join('\n');
}
