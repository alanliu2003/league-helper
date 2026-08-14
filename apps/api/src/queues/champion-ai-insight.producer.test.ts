import { describe, expect, it, vi } from 'vitest';
import { CHAMPION_AI_INSIGHT_JOB_NAME } from '@league-helper/shared';
import { ChampionAiInsightProducer } from './champion-ai-insight.producer';
import type { ChampionAiConfig } from '../config/champion-ai.config';

const INSIGHT_ID = '11111111-1111-1111-1111-111111111111';
const FINGERPRINT = 'a'.repeat(64);

function config(overrides: Partial<ChampionAiConfig> = {}): ChampionAiConfig {
  return {
    enabled: true,
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: '',
    timeoutMs: 60_000,
    temperature: 0.2,
    maxOutputTokens: 1200,
    maxRepairAttempts: 1,
    queueName: 'champion-ai-insight',
    jobAttempts: 3,
    stalePendingMs: 120_000,
    failedRetryMs: 60_000,
    ...overrides,
  };
}

describe('ChampionAiInsightProducer', () => {
  it('no-ops without hitting Redis when AI is disabled', async () => {
    const getJob = vi.fn();
    const add = vi.fn();
    const producer = new ChampionAiInsightProducer(
      { getJob, add } as never,
      config({ enabled: false }),
    );

    const result = await producer.enqueueInsight({
      insightId: INSIGHT_ID,
      contextFingerprint: FINGERPRINT,
    });

    expect(getJob).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(result.published).toBe(false);
    expect(result.alreadyExists).toBe(false);
  });

  it('does not duplicate live waiting jobs', async () => {
    const remove = vi.fn();
    const add = vi.fn();
    const getJob = vi.fn(async () => ({
      getState: async () => 'waiting' as const,
      remove,
    }));
    const producer = new ChampionAiInsightProducer(
      { getJob, add, name: 'champion-ai-insight' } as never,
      config(),
    );

    const result = await producer.enqueueInsight({
      insightId: INSIGHT_ID,
      contextFingerprint: FINGERPRINT,
    });

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(result.published).toBe(true);
    expect(result.alreadyExists).toBe(true);
  });

  it('republishes when an existing BullMQ job is completed', async () => {
    const remove = vi.fn(async () => undefined);
    const add = vi.fn(async () => ({ id: 'ai_champ_test' }));
    const getJob = vi.fn(async () => ({
      getState: async () => 'completed' as const,
      remove,
    }));
    const producer = new ChampionAiInsightProducer(
      { getJob, add, name: 'champion-ai-insight' } as never,
      config(),
    );

    const result = await producer.enqueueInsight({
      insightId: INSIGHT_ID,
      contextFingerprint: FINGERPRINT,
    });

    expect(remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      CHAMPION_AI_INSIGHT_JOB_NAME,
      expect.objectContaining({ insightId: INSIGHT_ID, contextFingerprint: FINGERPRINT }),
      expect.objectContaining({ jobId: expect.any(String), attempts: 3 }),
    );
    expect(result.published).toBe(true);
    expect(result.alreadyExists).toBe(false);
  });

  it('returns published false on Redis errors instead of throwing', async () => {
    const producer = new ChampionAiInsightProducer(
      {
        getJob: vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
        add: vi.fn(),
        name: 'champion-ai-insight',
      } as never,
      config(),
    );

    const result = await producer.enqueueInsight({
      insightId: INSIGHT_ID,
      contextFingerprint: FINGERPRINT,
    });

    expect(result.published).toBe(false);
    expect(result.alreadyExists).toBe(false);
  });
});
