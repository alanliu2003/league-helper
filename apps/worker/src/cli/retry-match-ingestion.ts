import 'dotenv/config';
import { Queue } from 'bullmq';
import { IngestionJobStatus, PrismaClient } from '@prisma/client';
import {
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_QUEUE_NAME,
  MatchIngestionJobPayloadSchema,
  buildMatchIngestionBullMqJobId,
  type MatchIngestionJobPayload,
} from '@league-helper/shared';
import { loadMatchIngestionWorkerConfig } from '../config.js';
import { createRedisConnection } from '../queues.js';

/**
 * Env-guarded CLI to re-queue FAILED / DEAD_LETTERED match-ingestion jobs.
 *
 * Requires: RETRY_MATCH_INGESTION_CONFIRM=YES
 * Optional: RETRY_MATCH_INGESTION_LIMIT (default 50)
 * Optional: RETRY_MATCH_INGESTION_IDS=comma-separated externalMatchIds
 */
async function main(): Promise<void> {
  if (process.env.RETRY_MATCH_INGESTION_CONFIRM !== 'YES') {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'Set RETRY_MATCH_INGESTION_CONFIRM=YES to run this command.',
      }),
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, error: 'DATABASE_URL is required.' }));
    process.exit(1);
  }

  const limitRaw = process.env.RETRY_MATCH_INGESTION_LIMIT?.trim();
  const limit = limitRaw ? Number(limitRaw) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'RETRY_MATCH_INGESTION_LIMIT must be an integer between 1 and 500.',
      }),
    );
    process.exit(1);
  }

  const idFilter = (process.env.RETRY_MATCH_INGESTION_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const config = loadMatchIngestionWorkerConfig();
  const prisma = new PrismaClient();
  const connection = createRedisConnection();
  const queue = new Queue<MatchIngestionJobPayload>(
    config.queueName || MATCH_INGESTION_QUEUE_NAME,
    { connection },
  );

  const summary = {
    ok: true,
    scanned: 0,
    reset: 0,
    published: 0,
    alreadyQueued: 0,
    invalidMetadata: 0,
    failed: 0,
  };

  try {
    const records = await prisma.ingestionJobRecord.findMany({
      where: {
        jobType: MATCH_INGESTION_JOB_NAME,
        status: { in: [IngestionJobStatus.FAILED, IngestionJobStatus.DEAD_LETTERED] },
        ...(idFilter.length > 0 ? { externalResourceId: { in: idFilter } } : {}),
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });

    summary.scanned = records.length;

    for (const record of records) {
      const parsed = MatchIngestionJobPayloadSchema.safeParse(record.metadata);
      if (!parsed.success) {
        summary.invalidMetadata += 1;
        continue;
      }

      const payload = parsed.data;
      await prisma.ingestionJobRecord.update({
        where: { id: record.id },
        data: {
          status: IngestionJobStatus.PENDING,
          lastErrorCode: null,
          lastErrorMessage: null,
          deadLetteredAt: null,
          completedAt: null,
        },
      });
      summary.reset += 1;

      const jobId = buildMatchIngestionBullMqJobId({
        provider: payload.provider,
        regionalRoute: payload.regionalRoute,
        externalMatchId: payload.externalMatchId,
        normalizationVersion: payload.normalizationVersion,
      });

      try {
        const existing = await queue.getJob(jobId);
        if (existing) {
          const state = await existing.getState();
          if (state === 'completed' || state === 'failed') {
            await existing.remove();
          } else {
            summary.alreadyQueued += 1;
            await prisma.ingestionJobRecord.update({
              where: { id: record.id },
              data: { status: IngestionJobStatus.QUEUED, scheduledAt: new Date() },
            });
            continue;
          }
        }

        await queue.add(MATCH_INGESTION_JOB_NAME, payload, {
          jobId,
          attempts: config.jobAttempts,
          backoff: {
            type: 'exponential',
            delay: config.backoffBaseMs,
          },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        });
        await prisma.ingestionJobRecord.update({
          where: { id: record.id },
          data: { status: IngestionJobStatus.QUEUED, scheduledAt: new Date() },
        });
        summary.published += 1;
      } catch {
        summary.failed += 1;
      }
    }

    console.log(JSON.stringify(summary));
  } finally {
    await Promise.allSettled([queue.close(), connection.quit(), prisma.$disconnect()]);
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'unknown',
    }),
  );
  process.exit(1);
});
