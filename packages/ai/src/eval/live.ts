import { DEFAULT_AI_MODEL } from '@league-helper/shared';
import { buildChampionInsightContext } from '../context/builder';
import {
  AiOutputValidationError,
  generateChampionInsight,
} from '../generation/generate-champion-insight';
import type { GenerateChampionInsightConfig } from '../generation/generate-champion-insight';
import { AiProviderError } from '../provider/errors';
import { OpenAiCompatibleProvider } from '../provider/openai-compatible';
import type { AiGenerationRawResult, AiProvider } from '../provider/types';
import { ChampionAiInsightValidationError } from '../validation/output';
import { formatChampionAiValidationDiagnostic } from '../validation/diagnostic';
import type { ChampionInsightEvalFixture } from './fixture-schema';
import { defaultWrite, type EvalWriter } from './io';
import { resolveEvalFixtures } from './load-fixtures';

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

const LIVE_METRIC_KEYS = [
  'fixtures',
  'skipped_ineligible',
  'generated',
  'json_schema_mode',
  'json_object_mode',
  'validation_pass',
  'validation_fail',
  'first_pass_validation',
  'repair_used',
  'repair_success',
  'terminal_validation_fail',
  'retryable_provider_fail',
  'numeric_grounding_fail',
  'evidence_fail',
  'p50_ms',
  'p95_ms',
  'model',
] as const;

export type LiveEvalMetrics = {
  fixtures: number;
  skipped_ineligible: number;
  generated: number;
  json_schema_mode: number;
  json_object_mode: number;
  validation_pass: number;
  validation_fail: number;
  first_pass_validation: number;
  repair_used: number;
  repair_success: number;
  terminal_validation_fail: number;
  retryable_provider_fail: number;
  numeric_grounding_fail: number;
  evidence_fail: number;
  p50_ms: number | 'n/a';
  p95_ms: number | 'n/a';
  model: string;
};

export type LiveEvalResult = {
  exitCode: number;
  skipped: boolean;
  metrics: LiveEvalMetrics | null;
};

function isAiEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.AI_ENABLED;
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '' || normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function parseOptionalApiKey(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}

function readModel(env: NodeJS.ProcessEnv): string {
  const value = env.AI_MODEL?.trim();
  return value && value.length > 0 ? value : DEFAULT_AI_MODEL;
}

function createProviderFromEnv(env: NodeJS.ProcessEnv): AiProvider {
  const apiKey = parseOptionalApiKey(env.AI_API_KEY);
  return new OpenAiCompatibleProvider({
    baseUrl: env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL,
    model: readModel(env),
    ...(apiKey ? { apiKey } : {}),
  });
}

function readGenerationConfig(env: NodeJS.ProcessEnv): GenerateChampionInsightConfig {
  return {
    timeoutMs: Math.max(1, Math.trunc(parseNumber(env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS))),
    maxOutputTokens: Math.max(
      1,
      Math.trunc(parseNumber(env.AI_MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)),
    ),
    temperature: parseNumber(env.AI_TEMPERATURE, DEFAULT_TEMPERATURE),
    maxRepairAttempts: Math.max(
      0,
      Math.trunc(parseNumber(env.AI_MAX_REPAIR_ATTEMPTS, DEFAULT_MAX_REPAIR_ATTEMPTS)),
    ),
  };
}

function emptyMetrics(model: string, fixtures: number): LiveEvalMetrics {
  return {
    fixtures,
    skipped_ineligible: 0,
    generated: 0,
    json_schema_mode: 0,
    json_object_mode: 0,
    validation_pass: 0,
    validation_fail: 0,
    first_pass_validation: 0,
    repair_used: 0,
    repair_success: 0,
    terminal_validation_fail: 0,
    retryable_provider_fail: 0,
    numeric_grounding_fail: 0,
    evidence_fail: 0,
    p50_ms: 'n/a',
    p95_ms: 'n/a',
    model,
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] ?? 0);
}

function looksLikeNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const haystack = `${error.name} ${error.message}`.toLowerCase();
  return /econnrefused|enotfound|etimedout|econnreset|fetch failed|network|aborted|abort|timeout/.test(
    haystack,
  );
}

function validationCause(error: unknown): ChampionAiInsightValidationError | undefined {
  if (error instanceof ChampionAiInsightValidationError) {
    return error;
  }
  if (
    error instanceof AiOutputValidationError &&
    error.cause instanceof ChampionAiInsightValidationError
  ) {
    return error.cause;
  }
  return undefined;
}

function recordValidationFailure(metrics: LiveEvalMetrics, error: unknown): void {
  metrics.validation_fail += 1;
  metrics.terminal_validation_fail += 1;
  const cause = validationCause(error);
  if (cause?.code === 'NUMERIC') {
    metrics.numeric_grounding_fail += 1;
  }
  if (cause?.code === 'EVIDENCE' || cause?.code === 'SLICE') {
    metrics.evidence_fail += 1;
  }
}

function recordProviderContent(
  metrics: LiveEvalMetrics,
  wrapped: {
    getGenerateCalls: () => number;
    getLastMode: () => AiGenerationRawResult['structuredOutputMode'] | undefined;
  },
): void {
  if (wrapped.getGenerateCalls() === 0) {
    return;
  }
  metrics.generated += 1;
  if (wrapped.getLastMode() === 'json_schema') {
    metrics.json_schema_mode += 1;
  } else if (wrapped.getLastMode() === 'json_object') {
    metrics.json_object_mode += 1;
  }
}

function wrapRecordingProvider(
  provider: AiProvider,
  latencies: number[],
): {
  provider: AiProvider;
  getGenerateCalls: () => number;
  getLastMode: () => AiGenerationRawResult['structuredOutputMode'] | undefined;
  getLastContent: () => string | undefined;
} {
  let generateCalls = 0;
  let lastMode: AiGenerationRawResult['structuredOutputMode'] | undefined;
  let lastContent: string | undefined;

  return {
    getGenerateCalls: () => generateCalls,
    getLastMode: () => lastMode,
    getLastContent: () => lastContent,
    provider: {
      id: provider.id,
      async generate(request) {
        const started = performance.now();
        const result = await provider.generate(request);
        latencies.push(performance.now() - started);
        lastMode = result.structuredOutputMode;
        lastContent = result.content;
        generateCalls += 1;
        return result;
      },
    },
  };
}

function printRejectedOutput(content: string | undefined, write: EvalWriter): void {
  if (!content) {
    return;
  }
  const sanitized = content
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]+/g, '[redacted]');
  const truncated = sanitized.length > 2000 ? `${sanitized.slice(0, 1997)}...` : sanitized;
  write('rejected_output:');
  write(truncated);
}

function printMetrics(metrics: LiveEvalMetrics, write: EvalWriter): void {
  write('--- live eval metrics ---');
  for (const key of LIVE_METRIC_KEYS) {
    write(`${key}\t${metrics[key]}`);
  }
}

export async function runLiveEval(options?: {
  env?: NodeJS.ProcessEnv;
  provider?: AiProvider;
  fixtures?: ChampionInsightEvalFixture[];
  fixturesDir?: string;
  write?: EvalWriter;
}): Promise<LiveEvalResult> {
  const env = options?.env ?? process.env;
  const write = options?.write ?? defaultWrite;

  if (!isAiEnabled(env)) {
    write('live eval skipped');
    return { exitCode: 0, skipped: true, metrics: null };
  }

  const fixtures = resolveEvalFixtures({
    fixtures: options?.fixtures,
    fixturesDir: options?.fixturesDir,
  });
  const model = readModel(env);
  const metrics = emptyMetrics(model, fixtures.length);
  const provider = options?.provider ?? createProviderFromEnv(env);
  const config = readGenerationConfig(env);
  const latencies: number[] = [];
  let hardProviderFail = false;

  for (const fixture of fixtures) {
    const context = buildChampionInsightContext(fixture.input);
    write(`=== ${fixture.id} ===`);

    if (!context.generationEligible) {
      metrics.skipped_ineligible += 1;
      write('skipped_ineligible');
      continue;
    }

    const wrapped = wrapRecordingProvider(provider, latencies);
    try {
      const insight = await generateChampionInsight({
        provider: wrapped.provider,
        context,
        config,
      });
      recordProviderContent(metrics, wrapped);
      metrics.validation_pass += 1;
      if (wrapped.getGenerateCalls() === 1) {
        metrics.first_pass_validation += 1;
      } else if (wrapped.getGenerateCalls() > 1) {
        metrics.repair_used += 1;
        metrics.repair_success += 1;
      }
      write('generated');
      write(JSON.stringify(insight, null, 2));
    } catch (error) {
      if (wrapped.getGenerateCalls() > 1) {
        metrics.repair_used += 1;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (
        error instanceof AiOutputValidationError ||
        error instanceof ChampionAiInsightValidationError
      ) {
        recordProviderContent(metrics, wrapped);
        recordValidationFailure(metrics, error);
        const cause = validationCause(error);
        write(`validation_fail: ${message}`);
        if (cause) {
          write(formatChampionAiValidationDiagnostic(cause, { champion: context.champion.name }));
        }
        printRejectedOutput(wrapped.getLastContent(), write);
      } else if (
        (error instanceof AiProviderError && error.retryable) ||
        looksLikeNetworkError(error)
      ) {
        metrics.retryable_provider_fail += 1;
        write(`retryable_provider_fail: ${message}`);
      } else {
        hardProviderFail = true;
        write(`provider_fail: ${message}`);
      }
    }
  }

  if (latencies.length > 0) {
    metrics.p50_ms = percentile(latencies, 50);
    metrics.p95_ms = percentile(latencies, 95);
  }

  printMetrics(metrics, write);

  const exitCode =
    metrics.validation_fail > 0 || metrics.retryable_provider_fail > 0 || hardProviderFail ? 1 : 0;
  return { exitCode, skipped: false, metrics };
}
