import { describe, expect, it } from 'vitest';
import { PLAYER_AI_PLAYSTYLE_QUEUE_NAME, ValidationFailureError } from '@league-helper/shared';
import { loadPlayerPlaystyleAiConfig } from './player-playstyle-ai.config';

describe('loadPlayerPlaystyleAiConfig', () => {
  it('defaults to disabled Qwen 14b without contacting a provider', () => {
    const config = loadPlayerPlaystyleAiConfig({});
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe('openai_compatible');
    expect(config.baseUrl).toBe('http://localhost:11434/v1');
    expect(config.model).toBe('qwen2.5:14b');
    expect(config.apiKey).toBe('');
    expect(config.timeoutMs).toBe(60_000);
    expect(config.temperature).toBe(0.2);
    expect(config.maxOutputTokens).toBe(1200);
    expect(config.maxRepairAttempts).toBe(1);
    expect(config.queueName).toBe(PLAYER_AI_PLAYSTYLE_QUEUE_NAME);
    expect(config.queueName).toBe('player-ai-playstyle');
    expect(config.jobAttempts).toBe(3);
    expect(config.stalePendingMs).toBe(120_000);
    expect(config.failedRetryMs).toBe(60_000);
  });

  it('shares AI_ENABLED and does not invent PLAYER_AI_ENABLED', () => {
    expect(loadPlayerPlaystyleAiConfig({ AI_ENABLED: 'true' }).enabled).toBe(true);
    expect(
      loadPlayerPlaystyleAiConfig({ PLAYER_AI_ENABLED: 'true' } as NodeJS.ProcessEnv).enabled,
    ).toBe(false);
    expect(loadPlayerPlaystyleAiConfig({ AI_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('reads PLAYER_AI_PLAYSTYLE queue knobs', () => {
    const config = loadPlayerPlaystyleAiConfig({
      PLAYER_AI_PLAYSTYLE_QUEUE_NAME: 'custom-player-playstyle',
      PLAYER_AI_PLAYSTYLE_JOB_ATTEMPTS: '5',
      PLAYER_AI_PLAYSTYLE_STALE_PENDING_MS: '90000',
      PLAYER_AI_PLAYSTYLE_FAILED_RETRY_MS: '15000',
    });
    expect(config.queueName).toBe('custom-player-playstyle');
    expect(config.jobAttempts).toBe(5);
    expect(config.stalePendingMs).toBe(90_000);
    expect(config.failedRetryMs).toBe(15_000);
  });

  it('rejects invalid AI_ENABLED flags and non-positive job attempts', () => {
    expect(() => loadPlayerPlaystyleAiConfig({ AI_ENABLED: 'maybe' })).toThrow(
      ValidationFailureError,
    );
    expect(() =>
      loadPlayerPlaystyleAiConfig({ PLAYER_AI_PLAYSTYLE_JOB_ATTEMPTS: '0' }),
    ).toThrow(ValidationFailureError);
  });
});
