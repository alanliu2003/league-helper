import { describe, expect, it } from 'vitest';
import * as ai from './index';

describe('@league-helper/ai', () => {
  it('loads the package barrel', () => {
    expect(ai).toBeDefined();
  });

  it('exports validateChampionAiInsight', () => {
    expect(typeof ai.validateChampionAiInsight).toBe('function');
  });

  it('exports Task 5 prompt, provider, and generation APIs', () => {
    expect(ai.CHAMPION_AI_PROMPT_VERSION).toBe('champion-insight-v1.3');
    expect(typeof ai.buildChampionInsightSystemPrompt).toBe('function');
    expect(typeof ai.buildChampionInsightUserPrompt).toBe('function');
    expect(typeof ai.OpenAiCompatibleProvider).toBe('function');
    expect(typeof ai.generateChampionInsight).toBe('function');
    expect(ai.CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA_NAME).toBe('champion_ai_stored_insight');
    expect(ai.AiProviderError).toBeDefined();
    expect(ai.AiOutputValidationError).toBeDefined();
    expect(typeof ai.readAiValidationDiagnostic).toBe('function');
  });
});
