import { describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import { loadChampionAiConfig } from './champion-ai.config';

describe('loadChampionAiConfig', () => {
  it('defaults to disabled without contacting a provider', () => {
    const config = loadChampionAiConfig({});
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('openai_compatible');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
    expect(config.model).toBe('qwen2.5:14b');
    expect(config.apiKey).toBe('');
    expect(config.timeoutMs).toBe(60_000);
    expect(config.temperature).toBe(0.2);
    expect(config.maxOutputTokens).toBe(1200);
    expect(config.maxRepairAttempts).toBe(1);
    expect(config.queueName).toBe('champion-ai-insight');
    expect(config.jobAttempts).toBe(3);
    expect(config.stalePendingMs).toBe(120_000);
    expect(config.failedRetryMs).toBe(60_000);
  });

  it('enables when AI_ENABLED=true and keeps the configured base URL', () => {
    const config = loadChampionAiConfig({
      AI_ENABLED: 'true',
      AI_BASE_URL: 'http://127.0.0.1:11434/v1',
    });
    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('stays disabled when AI_ENABLED is unset even if a base URL is set', () => {
    const config = loadChampionAiConfig({
      AI_BASE_URL: 'http://127.0.0.1:11434/v1',
    });
    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('stays disabled when AI_ENABLED is empty or false', () => {
    expect(loadChampionAiConfig({ AI_ENABLED: '' }).enabled).toBe(false);
    expect(loadChampionAiConfig({ AI_ENABLED: 'false' }).enabled).toBe(false);
    expect(loadChampionAiConfig({ AI_ENABLED: '0' }).enabled).toBe(false);
    expect(loadChampionAiConfig({ AI_ENABLED: 'no' }).enabled).toBe(false);
  });

  it('accepts true/1/yes for AI_ENABLED', () => {
    expect(loadChampionAiConfig({ AI_ENABLED: '1' }).enabled).toBe(true);
    expect(loadChampionAiConfig({ AI_ENABLED: 'yes' }).enabled).toBe(true);
  });

  it('rejects invalid AI_ENABLED flags', () => {
    expect(() => loadChampionAiConfig({ AI_ENABLED: 'maybe' })).toThrow(ValidationFailureError);
  });

  it('rejects providers other than openai_compatible', () => {
    expect(() => loadChampionAiConfig({ AI_PROVIDER: 'qwen' })).toThrow(ValidationFailureError);
    expect(() => loadChampionAiConfig({ AI_PROVIDER: 'openai' })).toThrow(ValidationFailureError);
  });

  it('rejects invalid integers', () => {
    expect(() => loadChampionAiConfig({ AI_TIMEOUT_MS: 'nope' })).toThrow(ValidationFailureError);
    expect(() => loadChampionAiConfig({ AI_TIMEOUT_MS: '0' })).toThrow(ValidationFailureError);
    expect(() => loadChampionAiConfig({ AI_MAX_OUTPUT_TOKENS: '-1' })).toThrow(
      ValidationFailureError,
    );
    expect(() => loadChampionAiConfig({ CHAMPION_AI_INSIGHT_JOB_ATTEMPTS: '1.5' })).toThrow(
      ValidationFailureError,
    );
    expect(() => loadChampionAiConfig({ CHAMPION_AI_INSIGHT_STALE_PENDING_MS: 'abc' })).toThrow(
      ValidationFailureError,
    );
  });

  it('rejects invalid temperature', () => {
    expect(() => loadChampionAiConfig({ AI_TEMPERATURE: 'hot' })).toThrow(ValidationFailureError);
  });
});
