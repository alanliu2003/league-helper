import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import type { AiProvider, GeneratePlayerPlaystyleInput } from '@league-helper/ai';
import {
  PLAYER_AI_PLAYSTYLE_JOB_NAME,
  resolveBullMqPrefix,
  type PlayerPlaystyleInsightJobPayload,
  type PlayerPlaystyleStoredInsight,
} from '@league-helper/shared';
import type { PlayerPlaystyleInsightWorkerConfig } from '../../config.js';
import { logger } from '../../logger.js';
import { safeJobId } from '../match-ingestion/log-safe.js';
import {
  createPrismaPlayerPlaystyleInsightStore,
  processPlayerPlaystyleInsightJob,
  type PlayerPlaystyleInsightJobResult,
  type PlayerPlaystyleInsightStore,
} from './player-playstyle-insight.processor.js';

export type CreatePlayerPlaystyleInsightWorkerOptions = {
  connection: ConnectionOptions;
  config: PlayerPlaystyleInsightWorkerConfig;
  prisma?: PrismaClient;
  store?: PlayerPlaystyleInsightStore;
  generate?: (input: GeneratePlayerPlaystyleInput) => Promise<PlayerPlaystyleStoredInsight>;
  provider?: AiProvider;
};

export type HandlePlayerPlaystyleInsightFailedInput = {
  job: Job<PlayerPlaystyleInsightJobPayload> | undefined;
  error: Error;
  config: PlayerPlaystyleInsightWorkerConfig;
  onRetryExhausted: (insightId: string) => Promise<void>;
};

function sanitizeLogMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-[A-Za-z0-9]+/g, '[redacted]')
    .replace(/AI_API_KEY\s*[:=]\s*\S+/gi, 'AI_API_KEY=[redacted]')
    .slice(0, 240);
}

function readInsightId(job: Job<PlayerPlaystyleInsightJobPayload> | undefined): string | undefined {
  const insightId = job?.data?.insightId;
  return typeof insightId === 'string' && insightId.length > 0 ? insightId : undefined;
}

/**
 * Persist PROVIDER_RETRY_EXHAUSTED after BullMQ retries are spent.
 * UnrecoverableError means the processor already marked FAILED — do not overwrite.
 */
export async function handlePlayerPlaystyleInsightFailed(
  input: HandlePlayerPlaystyleInsightFailedInput,
): Promise<void> {
  const { job, error, config, onRetryExhausted } = input;

  logger.error('Player playstyle insight job failed', {
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

export function createPlayerPlaystyleInsightWorker(
  options: CreatePlayerPlaystyleInsightWorkerOptions,
): Worker<PlayerPlaystyleInsightJobPayload, PlayerPlaystyleInsightJobResult> {
  const { connection, config } = options;
  const prefix = resolveBullMqPrefix();
  const store =
    options.store ?? createPrismaPlayerPlaystyleInsightStore(requirePrisma(options.prisma));

  const worker = new Worker<PlayerPlaystyleInsightJobPayload, PlayerPlaystyleInsightJobResult>(
    config.queueName,
    async (job: Job<PlayerPlaystyleInsightJobPayload>) => {
      if (job.name !== PLAYER_AI_PLAYSTYLE_JOB_NAME) {
        logger.warn('Rejecting unsupported player-ai-playstyle job name', {
          jobId: safeJobId(job.id),
          jobName: job.name,
          expectedJobName: PLAYER_AI_PLAYSTYLE_JOB_NAME,
        });
        throw new UnrecoverableError(`Unsupported job name: ${job.name}`);
      }

      return processPlayerPlaystyleInsightJob(job, {
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
      supportedJob: PLAYER_AI_PLAYSTYLE_JOB_NAME,
      concurrency: config.concurrency,
      bullmqPrefix: prefix,
      aiEnabled: config.enabled,
    });
  });

  worker.on('failed', (job, error) => {
    void handlePlayerPlaystyleInsightFailed({
      job,
      error,
      config,
      onRetryExhausted: async (insightId) => {
        await store.markFailed(insightId, 'PROVIDER_RETRY_EXHAUSTED');
      },
    }).catch((handlerError: unknown) => {
      logger.error('Player playstyle insight failed-handler error', {
        error: handlerError instanceof Error ? sanitizeLogMessage(handlerError.message) : 'unknown',
      });
    });
  });

  return worker;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('createPlayerPlaystyleInsightWorker requires prisma or store.');
  }
  return prisma;
}
