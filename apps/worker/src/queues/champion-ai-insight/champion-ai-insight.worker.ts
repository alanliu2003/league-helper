import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { AiProvider, GenerateChampionInsightInput } from '@league-helper/ai';
import {
  CHAMPION_AI_INSIGHT_JOB_NAME,
  resolveBullMqPrefix,
  type ChampionAiInsightJobPayload,
  type ChampionAiStoredInsight,
} from '@league-helper/shared';
import type { ChampionAiInsightWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  createPrismaChampionAiInsightStore,
  processChampionAiInsightJob,
  type ChampionAiInsightJobResult,
  type ChampionAiInsightStore,
} from './champion-ai-insight.processor.js';

export type CreateChampionAiInsightWorkerOptions = {
  connection: ConnectionOptions;
  config: ChampionAiInsightWorkerConfig;
  prisma?: PrismaClient;
  store?: ChampionAiInsightStore;
  generate?: (input: GenerateChampionInsightInput) => Promise<ChampionAiStoredInsight>;
  provider?: AiProvider;
};

export type HandleChampionAiInsightFailedInput = {
  job: Job<ChampionAiInsightJobPayload> | undefined;
  error: Error;
  config: ChampionAiInsightWorkerConfig;
  onRetryExhausted: (insightId: string) => Promise<void>;
};

function sanitizeLogMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]+/g, '[redacted]')
    .replace(/AI_API_KEY\s*[:=]\s*\S+/gi, 'AI_API_KEY=[redacted]')
    .slice(0, 240);
}

function readInsightId(job: Job<ChampionAiInsightJobPayload> | undefined): string | undefined {
  const insightId = job?.data?.insightId;
  return typeof insightId === 'string' && insightId.length > 0 ? insightId : undefined;
}

/**
 * Persist PROVIDER_RETRY_EXHAUSTED after BullMQ retries are spent.
 * UnrecoverableError means the processor already marked FAILED — do not overwrite.
 */
export async function handleChampionAiInsightFailed(
  input: HandleChampionAiInsightFailedInput,
): Promise<void> {
  const { job, error, config, onRetryExhausted } = input;

  logger.error('Champion AI insight job failed', {
    jobId: safeJobId(job?.id),
    jobName: job?.name,
    code: error.name,
    error: sanitizeLogMessage(error.message),
    attempt: job?.attemptsMade,
  });

  if (error instanceof UnrecoverableError) {
    return;
  }

  if (!job) {
    return;
  }

  const attempts = job.opts.attempts ?? config.jobAttempts;
  if (job.attemptsMade < attempts) {
    return;
  }

  const insightId = readInsightId(job);
  if (!insightId) {
    return;
  }

  await onRetryExhausted(insightId);
}

export function createChampionAiInsightWorker(
  options: CreateChampionAiInsightWorkerOptions,
): Worker<ChampionAiInsightJobPayload, ChampionAiInsightJobResult> {
  const { connection, config } = options;
  const prefix = resolveBullMqPrefix();
  const store = options.store ?? createPrismaChampionAiInsightStore(requirePrisma(options.prisma));

  const worker = new Worker<ChampionAiInsightJobPayload, ChampionAiInsightJobResult>(
    config.queueName,
    async (job: Job<ChampionAiInsightJobPayload>) => {
      if (job.name !== CHAMPION_AI_INSIGHT_JOB_NAME) {
        logger.warn('Rejecting unsupported champion-ai-insight job name', {
          jobId: safeJobId(job.id),
          jobName: job.name,
          expectedJobName: CHAMPION_AI_INSIGHT_JOB_NAME,
        });
        throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
      }

      return processChampionAiInsightJob(job, {
        store,
        config,
        generate: options.generate,
        provider: options.provider,
      });
    },
    {
      connection,
      concurrency: config.concurrency,
      prefix,
    },
  );

  worker.on('ready', () => {
    logger.info('Worker started', {
      queue: config.queueName,
      supportedJob: CHAMPION_AI_INSIGHT_JOB_NAME,
      concurrency: config.concurrency,
      bullmqPrefix: prefix,
      aiEnabled: config.enabled,
    });
  });

  worker.on('failed', (job, error) => {
    void handleChampionAiInsightFailed({
      job,
      error,
      config,
      onRetryExhausted: async (insightId) => {
        await store.markFailed(insightId, 'PROVIDER_RETRY_EXHAUSTED');
      },
    }).catch((handlerError: unknown) => {
      logger.error('Champion AI insight failed-handler error', {
        error:
          handlerError instanceof Error
            ? sanitizeLogMessage(handlerError.message)
            : 'unknown',
      });
    });
  });

  return worker;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('createChampionAiInsightWorker requires prisma or store.');
  }
  return prisma;
}
