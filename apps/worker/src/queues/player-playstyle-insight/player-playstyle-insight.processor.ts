import { UnrecoverableError, type Job } from 'bullmq';
import {
  AiOutputValidationError,
  AiProviderError,
  OpenAiCompatibleProvider,
  PlayerPlaystyleInternalContextSchema,
  generatePlayerPlaystyle,
  type AiProvider,
  type GeneratePlayerPlaystyleConfig,
} from '@league-helper/ai';
import {
  PLAYER_AI_PLAYSTYLE_JOB_NAME,
  PlayerPlaystyleInsightJobPayloadSchema,
  type PlayerPlaystyleInsightJobPayload,
} from '@league-helper/shared';
import {
  PlayerPlaystyleInsightStatus as PlayerPlaystyleInsightRowStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { PlayerPlaystyleInsightWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';

const FAILURE_REASON_MAX = 500;
const GROUNDING_CODES = new Set(['NUMERIC', 'HTML', 'EVIDENCE', 'SLICE']);

export type PlayerPlaystyleInsightRow = {
  id: string;
  status: string;
  inputContext: unknown;
};

export type PlayerPlaystyleInsightStore = {
  findById(id: string): Promise<PlayerPlaystyleInsightRow | null>;
  markReady(id: string, input: { structuredResult: unknown; generatedAt: Date }): Promise<void>;
  markFailed(id: string, failureReason: string): Promise<void>;
};

export type PlayerPlaystyleInsightProcessorDeps = {
  prisma?: PrismaClient;
  store?: PlayerPlaystyleInsightStore;
  config: PlayerPlaystyleInsightWorkerConfig;
  generate?: typeof generatePlayerPlaystyle;
  provider?: AiProvider;
};

export type PlayerPlaystyleInsightJobResult = {
  status: string;
};

export function createPrismaPlayerPlaystyleInsightStore(
  prisma: PrismaClient,
): PlayerPlaystyleInsightStore {
  return {
    async findById(id) {
      return prisma.playerPlaystyleInsight.findUnique({ where: { id } });
    },
    async markReady(id, input) {
      await prisma.playerPlaystyleInsight.update({
        where: { id },
        data: {
          status: PlayerPlaystyleInsightRowStatus.READY,
          structuredResult: input.structuredResult as Prisma.InputJsonValue,
          generatedAt: input.generatedAt,
          failureReason: null,
        },
      });
    },
    async markFailed(id, failureReason) {
      await prisma.playerPlaystyleInsight.update({
        where: { id },
        data: {
          status: PlayerPlaystyleInsightRowStatus.FAILED,
          failureReason: truncateFailureReason(failureReason),
        },
      });
    },
  };
}

function resolveStore(deps: PlayerPlaystyleInsightProcessorDeps): PlayerPlaystyleInsightStore {
  if (deps.store) {
    return deps.store;
  }
  if (deps.prisma) {
    return createPrismaPlayerPlaystyleInsightStore(deps.prisma);
  }
  throw new Error('Player playstyle insight processor requires prisma or store.');
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

function readValidationCause(error: AiOutputValidationError): {
  code?: string;
  reason?: string;
  handle?: string;
  token?: string;
} {
  const cause = error.cause as unknown;
  if (!cause || typeof cause !== 'object') {
    return {};
  }
  const record = cause as {
    code?: unknown;
    details?: { reason?: unknown; handle?: unknown; token?: unknown };
  };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    reason: typeof record.details?.reason === 'string' ? record.details.reason : undefined,
    handle: typeof record.details?.handle === 'string' ? record.details.handle : undefined,
    token: typeof record.details?.token === 'string' ? record.details.token : undefined,
  };
}

function validationFailureCode(error: AiOutputValidationError): 'GROUNDING' | 'VALIDATION' {
  const causeCode = readValidationCause(error).code;
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

function generationConfig(
  config: PlayerPlaystyleInsightWorkerConfig,
): GeneratePlayerPlaystyleConfig {
  return {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    maxRepairAttempts: config.maxRepairAttempts,
  };
}

async function runGenerate(
  deps: PlayerPlaystyleInsightProcessorDeps,
  config: PlayerPlaystyleInsightWorkerConfig,
  context: ReturnType<typeof PlayerPlaystyleInternalContextSchema.parse>,
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

  return generatePlayerPlaystyle({
    provider,
    context,
    config: generateConfig,
  });
}

/**
 * Generate and persist one player playstyle insight. Does not log prompts, API keys, or inputContext.
 */
export async function processPlayerPlaystyleInsightJob(
  job: Job<PlayerPlaystyleInsightJobPayload>,
  deps: PlayerPlaystyleInsightProcessorDeps,
): Promise<PlayerPlaystyleInsightJobResult> {
  if (job.name !== PLAYER_AI_PLAYSTYLE_JOB_NAME) {
    logger.warn('Rejecting unsupported player-ai-playstyle job name', {
      jobId: safeJobId(job.id),
      jobName: job.name,
      expectedJobName: PLAYER_AI_PLAYSTYLE_JOB_NAME,
    });
    throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
  }

  const parsedPayload = PlayerPlaystyleInsightJobPayloadSchema.safeParse(job.data);
  if (!parsedPayload.success) {
    logger.error('Player playstyle insight payload failed validation', {
      jobId: safeJobId(job.id),
      code: 'VALIDATION_ERROR',
    });
    throw new UnrecoverableError('Player playstyle insight payload failed validation.');
  }

  const payload = parsedPayload.data;
  const store = resolveStore(deps);
  const { config } = deps;

  const row = await store.findById(payload.insightId);
  if (!row) {
    logger.error('Player playstyle insight row missing', {
      jobId: safeJobId(job.id),
      insightId: payload.insightId,
    });
    throw new UnrecoverableError('Player playstyle insight row not found.');
  }

  if (row.status === PlayerPlaystyleInsightRowStatus.READY) {
    return { status: 'already_ready' };
  }

  if (!config.enabled) {
    const reason = formatFailureReason('AI_DISABLED');
    await store.markFailed(row.id, reason);
    throw new UnrecoverableError(reason);
  }

  const parsedContext = PlayerPlaystyleInternalContextSchema.safeParse(row.inputContext);
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
      const diagnostic = readValidationCause(error);
      logger.error('Player playstyle validation failed', {
        jobId: safeJobId(job.id),
        kind: diagnostic.code ?? 'SCHEMA',
        reason: diagnostic.reason ?? 'SCHEMA_MISMATCH',
        handle: diagnostic.handle,
        token: diagnostic.token,
      });
      const code = validationFailureCode(error);
      const detail = diagnostic.reason
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

    const message =
      error instanceof Error ? error.message : 'Unknown player playstyle insight error';
    const reason = formatFailureReason('UNEXPECTED', message);
    await store.markFailed(row.id, reason);
    throw new UnrecoverableError(reason);
  }

  await store.markReady(row.id, {
    structuredResult,
    generatedAt: new Date(),
  });
  logger.info('Player playstyle insight ready', {
    jobId: safeJobId(job.id),
    insightId: row.id,
  });
  return { status: 'ready' };
}
