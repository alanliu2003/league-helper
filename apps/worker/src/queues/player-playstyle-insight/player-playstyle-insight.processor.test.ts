import { describe, expect, it, vi } from 'vitest';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  AiOutputValidationError,
  AiProviderError,
  PlayerPlaystyleValidationError,
} from '@league-helper/ai';
import {
  PLAYER_AI_PLAYSTYLE_JOB_NAME,
  type PlayerPlaystyleInsightJobPayload,
  type PlayerPlaystyleStoredInsight,
} from '@league-helper/shared';
import type { PlayerPlaystyleInsightWorkerConfig } from '../../config.js';
import {
  processPlayerPlaystyleInsightJob,
  type PlayerPlaystyleInsightStore,
} from './player-playstyle-insight.processor.js';
import { handlePlayerPlaystyleInsightFailed } from './player-playstyle-insight.worker.js';

const INSIGHT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FINGERPRINT = '0123456789abcdef0123456789abcdef';
const SECRET_MATCH_ID = 'NA1_PRIVACY_MATCH_SECRET';

function config(
  overrides: Partial<PlayerPlaystyleInsightWorkerConfig> = {},
): PlayerPlaystyleInsightWorkerConfig {
  return {
    enabled: true,
    queueName: 'player-ai-playstyle',
    concurrency: 1,
    jobAttempts: 3,
    provider: 'openai_compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:14b',
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
): Job<PlayerPlaystyleInsightJobPayload> {
  return {
    id: 'ai_player_test_1',
    name: opts.name ?? PLAYER_AI_PLAYSTYLE_JOB_NAME,
    data: data as PlayerPlaystyleInsightJobPayload,
    attemptsMade: opts.attemptsMade ?? 0,
    opts: { attempts: opts.attempts ?? 3 },
  } as unknown as Job<PlayerPlaystyleInsightJobPayload>;
}

function validPayload(
  overrides: Partial<PlayerPlaystyleInsightJobPayload> = {},
): PlayerPlaystyleInsightJobPayload {
  return {
    insightId: INSIGHT_ID,
    contextFingerprint: FINGERPRINT,
    correlationId: 'corr-playstyle-1',
    ...overrides,
  };
}

function allowedComparison(metric: string): Record<string, unknown> {
  return {
    metric,
    playerValue: null,
    baseline: {
      value: null,
      sampleSize: 800,
      sampleConfidence: 'HIGH',
      rankTier: 'GOLD',
      usedAllTierFallback: false,
    },
    delta: 1.1,
    comparableMatchCount: 12,
    direction: 'ABOVE_BASELINE',
    interpretationAllowed: true,
  };
}

function validContext(): Record<string, unknown> {
  return {
    subject: { label: 'player' },
    scope: {
      queueId: 420,
      queueLabel: 'Ranked Solo/Duo',
      kind: 'COLLECTED_SAMPLE',
      patchRange: { min: '16.14', max: '16.15' },
    },
    mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 8 }],
    playerSample: {
      matchesAnalyzed: 12,
      comparableMatchCount: 12,
      wins: 7,
      playerSampleBand: 'CREDIBLE',
      generationEligible: true,
    },
    overall: {
      comparisons: [allowedComparison('CS_PER_MIN'), allowedComparison('DAMAGE_PER_MIN')],
    },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
        sampleBand: 'CREDIBLE',
        comparisons: [allowedComparison('CS_PER_MIN'), allowedComparison('KDA')],
      },
    ],
    skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
    windowSize: 20,
    matchIdentity: [{ matchId: SECRET_MATCH_ID, participantId: 1 }],
    evidenceCatalog: [{ id: 'OVERALL_CS_PER_MIN', interpretationAllowed: true }],
    outputPolicy: {
      economyAllowed: true,
      combatAllowed: true,
      championTendenciesAllowed: true,
    },
    generationEligible: true,
  };
}

function storedInsight(): PlayerPlaystyleStoredInsight {
  return {
    summary: {
      text: "This player's farming pace is above the matched baseline in the collected ranked sample, with a more farm-oriented profile overall.",
      evidence: ['OVERALL_CS_PER_MIN'],
    },
    economy: {
      text: 'Farming pace is above the matched baseline relative to similar collected samples.',
      evidence: ['OVERALL_CS_PER_MIN'],
    },
    combat: {
      text: 'Combat damage pace is lower than the matched baseline in this collected sample.',
      evidence: ['OVERALL_DAMAGE_PER_MIN'],
    },
    strengths: [],
    tradeoffs: [],
    championTendencies: [],
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
  overrides: Partial<PlayerPlaystyleInsightStore> = {},
): PlayerPlaystyleInsightStore {
  return {
    findById: vi.fn().mockResolvedValue(pendingRow()),
    markReady: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function collectLogOutput(spies: Array<ReturnType<typeof vi.spyOn>>): string {
  return spies
    .flatMap((spy) => spy.mock.calls.map((call) => call.map((arg) => String(arg)).join(' ')))
    .join('\n');
}

describe('processPlayerPlaystyleInsightJob', () => {
  it('returns already_ready without generating when the row is READY', async () => {
    const generate = vi.fn();
    const store = createStore({
      findById: vi.fn().mockResolvedValue(pendingRow({ status: 'READY' })),
    });

    const result = await processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
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
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
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
      processPlayerPlaystyleInsightJob(makeJob({ insightId: 'not-a-uuid' }), {
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
      processPlayerPlaystyleInsightJob(makeJob(validPayload(), { name: 'OTHER' }), {
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
      new AiOutputValidationError('Player playstyle insight output failed validation.', {
        cause: new PlayerPlaystyleValidationError('SCHEMA', 'Insight output is invalid.'),
      }),
    );
    const store = createStore();

    await expect(
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.markFailed).toHaveBeenCalledWith(INSIGHT_ID, expect.stringMatching(/^VALIDATION/));
    expect(store.markReady).not.toHaveBeenCalled();
  });

  it('marks FAILED with GROUNDING then throws UnrecoverableError on numeric grounding errors', async () => {
    const generate = vi.fn().mockRejectedValue(
      new AiOutputValidationError('Player playstyle insight output failed validation.', {
        cause: new PlayerPlaystyleValidationError('NUMERIC', 'Disallowed numeric token.'),
      }),
    );
    const store = createStore();

    await expect(
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.markFailed).toHaveBeenCalledWith(INSIGHT_ID, expect.stringMatching(/^GROUNDING/));
  });

  it('marks FAILED with VALIDATION then throws UnrecoverableError on invalid inputContext', async () => {
    const generate = vi.fn();
    const store = createStore({
      findById: vi.fn().mockResolvedValue(pendingRow({ inputContext: { not: 'valid' } })),
    });

    await expect(
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.markFailed).toHaveBeenCalledWith(INSIGHT_ID, expect.stringMatching(/^VALIDATION/));
    expect(generate).not.toHaveBeenCalled();
  });

  it('rethrows a retryable provider timeout and does not mark FAILED', async () => {
    const timeout = new AiProviderError('Request timed out.', { retryable: true });
    const generate = vi.fn().mockRejectedValue(timeout);
    const store = createStore();

    await expect(
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBe(timeout);

    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markReady).not.toHaveBeenCalled();
  });

  it('rethrows a retryable network error and does not mark FAILED', async () => {
    const network = Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
    const generate = vi.fn().mockRejectedValue(network);
    const store = createStore();

    await expect(
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBe(network);

    expect(store.markFailed).not.toHaveBeenCalled();
    expect(store.markReady).not.toHaveBeenCalled();
  });

  it('marks FAILED with PROVIDER_AUTH then throws UnrecoverableError on 401', async () => {
    const generate = vi
      .fn()
      .mockRejectedValue(
        new AiProviderError('Unauthorized.', { retryable: false, statusCode: 401 }),
      );
    const store = createStore();

    await expect(
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
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
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config({ enabled: false }),
        generate,
      }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(store.findById).toHaveBeenCalledWith(INSIGHT_ID);
    expect(store.markFailed).toHaveBeenCalledWith(
      INSIGHT_ID,
      expect.stringMatching(/^AI_DISABLED/),
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns already_ready for a READY row even when AI is disabled', async () => {
    const generate = vi.fn();
    const store = createStore({
      findById: vi.fn().mockResolvedValue(pendingRow({ status: 'READY' })),
    });

    const result = await processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
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

    const result = await processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
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
      processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      }),
    ).rejects.toBe(persistError);

    expect(store.markReady).toHaveBeenCalled();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it('does not log inputContext or match ids from stored context', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const generate = vi.fn().mockResolvedValue(storedInsight());
      const store = createStore();

      await processPlayerPlaystyleInsightJob(makeJob(validPayload()), {
        store,
        config: config(),
        generate,
      });

      const logged = collectLogOutput([logSpy, warnSpy, errorSpy]);
      expect(logged).toContain('ai_player_test_1');
      expect(logged).not.toContain(SECRET_MATCH_ID);
      expect(logged).not.toContain('inputContext');
      expect(logged).not.toMatch(/puuid|riot.?id/i);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('handlePlayerPlaystyleInsightFailed', () => {
  it('marks FAILED with PROVIDER_RETRY_EXHAUSTED when retries are exhausted', async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);

    await handlePlayerPlaystyleInsightFailed({
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

    await handlePlayerPlaystyleInsightFailed({
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
