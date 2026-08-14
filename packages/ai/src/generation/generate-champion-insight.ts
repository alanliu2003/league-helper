import type { ChampionAiStoredInsight } from '@league-helper/shared';
import type { ChampionInsightContext } from '../context/types';
import {
  buildChampionInsightSystemPrompt,
  buildChampionInsightUserPrompt,
} from '../prompts/champion-insight-v1';
import type { AiProvider } from '../provider/types';
import {
  ChampionAiInsightValidationError,
  validateChampionAiInsight,
} from '../validation/output';
import { buildChampionInsightRepairMessage } from '../validation/repair-message';
import {
  CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA,
  CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME,
} from './stored-insight.json-schema';

export class AiOutputValidationError extends Error {
  readonly retryable = false;
  override readonly cause: ChampionAiInsightValidationError;

  constructor(message: string, options: { cause: ChampionAiInsightValidationError }) {
    super(message, { cause: options.cause });
    this.name = 'AiOutputValidationError';
    this.cause = options.cause;
  }
}

export type GenerateChampionInsightConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  maxRepairAttempts?: number;
};

export type GenerateChampionInsightInput = {
  provider: AiProvider;
  context: ChampionInsightContext;
  config: GenerateChampionInsightConfig;
};

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

export async function generateChampionInsight(
  input: GenerateChampionInsightInput,
): Promise<ChampionAiStoredInsight> {
  const { provider, context, config } = input;
  const temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRepairAttempts = config.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;

  const system = buildChampionInsightSystemPrompt();
  const originalUser = buildChampionInsightUserPrompt(context);

  const generate = async (user: string) =>
    provider.generate({
      system,
      user,
      jsonSchema: CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA,
      jsonSchemaName: CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME,
      temperature,
      maxOutputTokens,
      timeoutMs,
    });

  let userPrompt = originalUser;
  let lastValidationError: ChampionAiInsightValidationError | undefined;
  const totalAttempts = 1 + Math.max(0, maxRepairAttempts);

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (attempt > 0 && lastValidationError) {
      userPrompt = buildRepairUserPrompt(originalUser, lastValidationError);
    }

    const raw = await generate(userPrompt);
    try {
      return validateChampionAiInsight(raw.content, context);
    } catch (error) {
      if (!(error instanceof ChampionAiInsightValidationError)) {
        throw error;
      }
      lastValidationError = error;
    }
  }

  throw new AiOutputValidationError('Champion AI insight output failed validation.', {
    cause:
      lastValidationError ??
      new ChampionAiInsightValidationError('SCHEMA', 'Insight output is invalid.'),
  });
}

function buildRepairUserPrompt(
  originalUser: string,
  error: ChampionAiInsightValidationError,
): string {
  return [
    originalUser,
    '',
    '--- VALIDATION ERROR ---',
    'The previous JSON failed validation and must be corrected.',
    buildChampionInsightRepairMessage(error),
    'Return corrected JSON only. Do not include markdown or commentary.',
  ].join('\n');
}
