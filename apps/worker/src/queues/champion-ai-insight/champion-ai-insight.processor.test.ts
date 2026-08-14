import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  AiOutputValidationError,
  AiProviderError,
  ChampionAiInsightValidationError,
} from '@league-helper/ai';
import {
  CHAMPION_AI_INSIGHT_JOB_NAME,
  type ChampionAiInsightJobPayload,
  type ChampionAiStoredInsight,
} from '@league-helper/shared';
import type { ChampionAiInsightWorkerConfig } from '../../config.js';
import {
  processChampionAiInsightJob,
  type ChampionAiInsightStore,
} from './champion-ai-insight.processor.js';
import { handleChampionAiInsightFailed } from './champion-ai-insight.worker.js';

const INSIGHT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FINGERPRINT = '0123456789abcdef0123456789abcdef';

function config(
  overrides: Partial<ChampionAiInsightWorkerConfig> = {},
): ChampionAiInsightWorkerConfig {
  return {
    enabled: true,
    queueName: 'champion-ai-insight',
    concurrency: 1,
    jobAttempts: 3,
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: '',
    timeoutMs: 60_000,
    temperature: 0.2,
    maxOutputTokens: 1200,
    maxRepairAttempts: 1,
    ...overrides,
  };
}

function makeJob(
  data: unknown,
  opts: { name?: string; attemptsMade?: number; attempts?: number } = {},
): Job<ChampionAiInsightJobPayload> {
  return {
    id: 'ai_champ_test_1',
    name: opts.name ?? CHAMPION_AI_INSIGHT_JOB_NAME,
    data: data as ChampionAiInsightJobPayload,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 3 },
  } as unknown as Job<ChampionAiInsightJobPayload>;
}

function validPayload(
  overrides: Partial<ChampionAiInsightJobPayload> = {},
): ChampionAiInsightJobPayload {
  return {
    insightId: INSIGHT_ID,
    contextFingerprint: FINGERPRINT,
    correlationId: 'corr-ai-1',
    ...overrides,
  };
}

function validContext(): Record<string, unknown> {
  return {
    champion: { championId: 103, championKey: 'Ahri', name: 'Ahri', position: 'MIDDLE' },
    scope: {
      patch: '16.15',
      platform: 'na1',
      queueId: 420,
      tier: 'ALL',
      kind: 'COLLECTED_SAMPLE',
    },
    performance: { interpretationAllowed: false },
    builds: {
      coreBuilds: [],
      startingItems: [],
      boots: [],
      runes: [],
      summonerSpells: [],
      skillOrder: [],
    },
    matchups: { strongAgainst: [], weakAgainst: [] },
    abilities: [],
    opponentAbilities: [],
    generationEligible: true,
    performanceConclusionsAllowed: false,
    buildInsightAllowed: true,
    matchupExplanationsAllowed: false,
    evidenceCatalog: [{ id: 'CONFIDENCE_WARNING', interpretationAllowed: true }],
  };
}

function storedInsight(): ChampionAiStoredInsight {
  return {
    summary: {
      text: 'Ahri looks slightly above even in this collected sample and can look for roam windows after wave control.',
      evidence: ['CONFIDENCE_WARNING'],
    },
    strengths: [],
    weaknesses: [],
    buildInsight: null,
    matchupInsights: [],
  };
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INSIGHT_ID,
    status: 'PENDING',
    inputContext: validContext(),
    ...overrides,
  };
}

function createStore(
  overrides: Partial<ChampionAiInsightStore> = {},
): ChampionAiInsightStore {
  return {
    findById: vi.fn().mockResolvedValue(pendingRow()),
    markReady: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('processChampionAiInsightJob', () => {
  it('returns already_ready without generating when the row is READY', async () => {
    const generate = vi.fn();
    const store = createStore({
      findById: vi.fn().mockResolvedValue(pendingRow({ status: 'READY' })),
    });

    const result = await processChampionAiInsightJob(makeJob(validPayload()), {
      store,
      config: config(),
      generate,
    });

    expect(result).toEqual({ status: 'already_ready' });
    expect(generate).not.toHaveBeenCalled();
    expect(store.markReady).not.toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError when the insight row is missing', async () => {
    const generate = vi.fn();
    const store = createStore({
      findById: vi.fn().mockResolvedValue(null),
    });

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(generate).not.toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError for an invalid payload', async () => {
    const generate = vi.fn();
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob({ insightId: 'not-a-uuid' }), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.findById).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError for an unsupported job name', async () => {
    const generate = vi.fn();
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob(validPayload(), { name: 'OTHER' }), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.findById).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('marks FAILED with VALIDATION then throws UnrecoverableError on schema validation errors', async () => {
    const generate = vi.fn().mockRejectedValue(
      new AiOutputValidationError('Champion AI insight output failed validation.', {
        cause: new ChampionAiInsightValidationError('SCHEMA', 'Insight output is invalid.'),
      }),
    );
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.markFailed).toHaveBeenCalledWith(
      INSIGHT_ID,
      expect.stringMatching(/^VALIDATION/),
    );
    expect(store.markReady).not.toHaveBeenCalled();
  });

  it('marks FAILED with GROUNDING then throws UnrecoverableError on numeric grounding errors', async () => {
    const generate = vi.fn().mockRejectedValue(
      new AiOutputValidationError('Champion AI insight output failed validation.', {
        cause: new ChampionAiInsightValidationError('NUMERIC', 'Disallowed numeric token.'),
      }),
    );
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.markFailed).toHaveBeenCalledWith(
      INSIGHT_ID,
      expect.stringMatching(/^GROUNDING/),
    );
  });

  it('logs a sanitized validation classification without prompts or secrets', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const generate = vi.fn().mockRejectedValue(
        new AiOutputValidationError('Champion AI insight output failed validation.', {
          cause: new ChampionAiInsightValidationError('EVIDENCE', "Unknown evidence handle 'E99'.", {
            reason: 'UNKNOWN_EVIDENCE_HANDLE',
            handle: 'E99',
          }),
        }),
      );
      const store = createStore();

      await expect(
        processChampionAiInsightJob(makeJob(validPayload()), {
          store,
          config: config(),
          generate,
        }),
      ).rejects.toBeInstanceOf(UnrecoverableError);

      expect(store.markFailed).toHaveBeenCalledWith(
        INSIGHT_ID,
        expect.stringMatching(/GROUNDING: UNKNOWN_EVIDENCE_HANDLE handle=E99/),
      );
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('Champion AI validation failed');
      expect(logged).toContain('UNKNOWN_EVIDENCE_HANDLE');
      expect(logged).toContain('E99');
      expect(logged).toContain('Ahri');
      expect(logged).not.toMatch(/sk-[A-Za-z0-9]|AI_API_KEY|Bearer /i);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('rethrows a retryable provider timeout and does not mark FAILED', async () => {
    const timeout = new AiProviderError('Request timed out.', { retryable: true });
    const generate = vi.fn().mockRejectedValue(timeout);
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBe(timeout);

    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markReady).not.toHaveBeenCalled();
  });

  it('marks FAILED with PROVIDER_AUTH then throws UnrecoverableError on 401', async () => {
    const generate = vi.fn().mockRejectedValue(
      new AiProviderError('Unauthorized.', { retryable: false, statusCode: 401 }),
    );
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.markFailed).toHaveBeenCalledWith(
      INSIGHT_ID,
      expect.stringMatching(/^PROVIDER_AUTH/),
    );
  });

  it('marks FAILED with AI_DISABLED then throws UnrecoverableError when AI is off', async () => {
    const generate = vi.fn();
    const store = createStore();

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config({ enabled: false }),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.findById).toHaveBeenCalledWith(INSIGHT_ID);
    expect(store.markFailed).toHaveBeenCalledWith(INSIGHT_ID, expect.stringMatching(/^AI_DISABLED/));
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns already_ready for a READY row even when AI is disabled', async () => {
    const generate = vi.fn();
    const store = createStore({
      findById: vi.fn().mockResolvedValue(pendingRow({ status: 'READY' })),
    });

    const result = await processChampionAiInsightJob(makeJob(validPayload()), {
      store,
      config: config({ enabled: false }),
      generate,
    });

    expect(result).toEqual({ status: 'already_ready' });
    expect(generate).not.toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markReady).not.toHaveBeenCalled();
  });

  it('marks READY with the structured result on success', async () => {
    const insight = storedInsight();
    const generate = vi.fn().mockResolvedValue(insight);
    const store = createStore();

    const result = await processChampionAiInsightJob(makeJob(validPayload()), {
      store,
      config: config(),
      generate,
    });

    expect(result).toEqual({ status: 'ready' });
    expect(store.markReady).toHaveBeenCalledWith(
      INSIGHT_ID,
      expect.objectContaining({
        structuredResult: insight,
        generatedAt: expect.any(Date),
      }),
    );
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('rethrows a markReady persistence error without marking FAILED', async () => {
    const persistError = new Error('database write failed');
    const generate = vi.fn().mockResolvedValue(storedInsight());
    const store = createStore({
      markReady: vi.fn().mockRejectedValue(persistError),
    });

    await expect(
      processChampionAiInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBe(persistError);

    expect(store.markReady).toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
  });
});

describe('handleChampionAiInsightFailed', () => {
  it('marks FAILED with PROVIDER_RETRY_EXHAUSTED when retries are exhausted', async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await handleChampionAiInsightFailed({
      job: makeJob(validPayload(), { attemptsMade: 3, attempts: 3 }),
      error: new AiProviderError('Request timed out.', { retryable: true }),
      config: config(),
      onRetryExhausted: async (insightId) => {
        await markFailed(insightId, 'PROVIDER_RETRY_EXHAUSTED');
      },
    });

    expect(markFailed).toHaveBeenCalledWith(INSIGHT_ID, 'PROVIDER_RETRY_EXHAUSTED');
  });

  it('does not overwrite failureReason when the error is UnrecoverableError', async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await handleChampionAiInsightFailed({
      job: makeJob(validPayload(), { attemptsMade: 3, attempts: 3 }),
      error: new UnrecoverableError('VALIDATION: Insight output is invalid.'),
      config: config(),
      onRetryExhausted: async (insightId) => {
        await markFailed(insightId, 'PROVIDER_RETRY_EXHAUSTED');
      },
    });

    expect(markFailed).not.toHaveBeenCalled();
  });
});
