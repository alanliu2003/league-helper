import { UnrecoverableError, type Job } from 'bullmq';
import {
  AiOutputValidationError,
  AiProviderError,
  ChampionAiInsightValidationError,
  ChampionInsightContextSchema,
  OpenAiCompatibleProvider,
  championAiValidationDiagnostic,
  generateChampionInsight,
  type AiProvider,
  type GenerateChampionInsightConfig,
} from '@league-helper/ai';
import {
  CHAMPION_AI_INSIGHT_JOB_NAME,
  ChampionAiInsightJobPayloadSchema,
  type ChampionAiInsightJobPayload,
} from '@league-helper/shared';
import {
  ChampionAiInsightStatus as ChampionAiInsightRowStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { ChampionAiInsightWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';

const FAILURE_REASON_MAX = 500;
const GROUNDING_CODES = new Set(['NUMERIC', 'HTML', 'EVIDENCE', 'SLICE']);

export type ChampionAiInsightRow = {
  id: string;
  status: string;
  inputContext: unknown;
};

export type ChampionAiInsightStore = {
  findById(id: string): Promise<ChampionAiInsightRow | null>;
  markReady(
    id: string,
    input: { structuredResult: unknown; generatedAt: Date },
  ): Promise<void>;
  markFailed(id: string, failureReason: string): Promise<void>;
};

export type ChampionAiInsightProcessorDeps = {
  prisma?: PrismaClient;
  store?: ChampionAiInsightStore;
  config: ChampionAiInsightWorkerConfig;
  generate?: typeof generateChampionInsight;
  provider?: AiProvider;
};

export type ChampionAiInsightJobResult = {
  status: string;
};

export function createPrismaChampionAiInsightStore(prisma: PrismaClient): ChampionAiInsightStore {
  return {
    async findById(id) {
      return prisma.championAiInsight.findUnique({ where: { id } });
    },
    async markReady(id, input) {
      await prisma.championAiInsight.update({
        where: { id },
        data: {
          status: ChampionAiInsightRowStatus.READY,
          structuredResult: input.structuredResult as Prisma.InputJsonValue,
          generatedAt: input.generatedAt,
          failureReason: null,
        },
      });
    },
    async markFailed(id, failureReason) {
      await prisma.championAiInsight.update({
        where: { id },
        data: {
          status: ChampionAiInsightRowStatus.FAILED,
          failureReason: truncateFailureReason(failureReason),
        },
      });
    },
  };
}

function resolveStore(deps: ChampionAiInsightProcessorDeps): ChampionAiInsightStore {
  if (deps.store) {
    return deps.store;
  }
  if (deps.prisma) {
    return createPrismaChampionAiInsightStore(deps.prisma);
  }
  throw new Error('Champion AI insight processor requires prisma or store.');
}

function truncateFailureReason(reason: string): string {
  return reason.slice(0, FAILURE_REASON_MAX);
}

function sanitizeFailureDetail(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]+/g, '[redacted]')
    .replace(/AI_API_KEY\s*[:=]\s*\S+/gi, 'AI_API_KEY=[redacted]');
}

function formatFailureReason(code: string, detail?: string): string {
  const raw = detail ? `${code}: ${sanitizeFailureDetail(detail)}` : code;
  return truncateFailureReason(raw);
}

function validationFailureCode(error: AiOutputValidationError): 'GROUNDING' | 'VALIDATION' {
  const causeCode = error.cause?.code;
  if (causeCode && GROUNDING_CODES.has(causeCode)) {
    return 'GROUNDING';
  }
  return 'VALIDATION';
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true;
  }
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (
    code &&
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EPIPE',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(code)
  ) {
    return true;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('etimedout') ||
    message.includes('socket hang up')
  );
}

function generationConfig(config: ChampionAiInsightWorkerConfig): GenerateChampionInsightConfig {
  return {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    maxRepairAttempts: config.maxRepairAttempts,
  };
}

async function runGenerate(
  deps: ChampionAiInsightProcessorDeps,
  config: ChampionAiInsightWorkerConfig,
  context: ReturnType<typeof ChampionInsightContextSchema.parse>,
) {
  const generateConfig = generationConfig(config);
  if (deps.generate) {
    const provider = deps.provider ?? {
      id: 'injected',
      generate: async () => {
        throw new Error('provider generate should not be called when generate is injected');
      },
    };
    return deps.generate({
      provider,
      context,
      config: generateConfig,
    });
  }

  const provider =
    deps.provider ??
    new OpenAiCompatibleProvider({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey.trim() || undefined,
    });

  return generateChampionInsight({
    provider,
    context,
    config: generateConfig,
  });
}

/**
 * Generate and persist one champion AI insight. Does not log prompts or API keys.
 */
export async function processChampionAiInsightJob(
  job: Job<ChampionAiInsightJobPayload>,
  deps: ChampionAiInsightProcessorDeps,
): Promise<ChampionAiInsightJobResult> {
  if (job.name !== CHAMPION_AI_INSIGHT_JOB_NAME) {
    logger.warn('Rejecting unsupported champion-ai-insight job name', {
      jobId: safeJobId(job.id),
      jobName: job.name,
      expectedJobName: CHAMPION_AI_INSIGHT_JOB_NAME,
    });
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const parsedPayload = ChampionAiInsightJobPayloadSchema.safeParse(job.data);
  if (!parsedPayload.success) {
    logger.error('Champion AI insight payload failed validation', {
      jobId: safeJobId(job.id),
      code: 'VALIDATION_ERROR',
    });
    throw new UnrecoverableError('Champion AI insight payload failed validation.');
  }

  const payload = parsedPayload.data;
  const store = resolveStore(deps);
  const { config } = deps;

  const row = await store.findById(payload.insightId);
  if (!row) {
    logger.error('Champion AI insight row missing', {
      jobId: safeJobId(job.id),
      insightId: payload.insightId,
    });
    throw new UnrecoverableError('Champion AI insight row not found.');
  }

  if (row.status === ChampionAiInsightRowStatus.READY) {
    return { status: 'already_ready' };
  }

  if (!config.enabled) {
    const reason = formatFailureReason('AI_DISABLED');
    await store.markFailed(row.id, reason);
    throw new UnrecoverableError(reason);
  }

  const parsedContext = ChampionInsightContextSchema.safeParse(row.inputContext);
  if (!parsedContext.success) {
    const reason = formatFailureReason('VALIDATION', 'inputContext failed schema validation.');
    await store.markFailed(row.id, reason);
    throw new UnrecoverableError(reason);
  }

  let structuredResult;
  try {
    structuredResult = await runGenerate(deps, config, parsedContext.data);
  } catch (error: unknown) {
    if (error instanceof AiOutputValidationError) {
      const cause =
        error.cause instanceof ChampionAiInsightValidationError ? error.cause : undefined;
      const diagnostic = cause
        ? championAiValidationDiagnostic(cause, {
            champion: parsedContext.data.champion.name,
          })
        : undefined;
      logger.error('Champion AI validation failed', {
        jobId: safeJobId(job.id),
        kind: diagnostic?.kind ?? 'SCHEMA',
        reason: diagnostic?.reason ?? 'SCHEMA_MISMATCH',
        handle: diagnostic?.handle,
        token: diagnostic?.token,
        champion: diagnostic?.champion,
      });
      const code = validationFailureCode(error);
      const detail = diagnostic
        ? [
            diagnostic.reason,
            diagnostic.handle ? `handle=${diagnostic.handle}` : undefined,
            diagnostic.token ? `token=${diagnostic.token}` : undefined,
          ]
            .filter((part): part is string => Boolean(part))
            .join(' ')
        : error.message;
      const reason = formatFailureReason(code, detail);
      await store.markFailed(row.id, reason);
      throw new UnrecoverableError(reason);
    }

    if (error instanceof AiProviderError) {
      if (!error.retryable) {
        const reason = formatFailureReason('PROVIDER_AUTH', error.message);
        await store.markFailed(row.id, reason);
        throw new UnrecoverableError(reason);
      }
      throw error;
    }

    if (isRetryableNetworkError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown champion AI insight error';
    const reason = formatFailureReason('UNEXPECTED', message);
    await store.markFailed(row.id, reason);
    throw new UnrecoverableError(reason);
  }

  await store.markReady(row.id, {
    structuredResult,
    generatedAt: new Date(),
  });
  logger.info('Champion AI insight ready', {
    jobId: safeJobId(job.id),
    insightId: row.id,
  });
  return { status: 'ready' };
}
