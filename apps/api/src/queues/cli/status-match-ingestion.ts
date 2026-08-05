import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import {
  BULLMQ_DEFAULT_PREFIX,
  MATCH_INGESTION_JOB_NAME,
  MATCH_INGESTION_NORMALIZATION_VERSION,
  MATCH_INGESTION_QUEUE_NAME,
  buildMatchIngestionBullMqJobId,
  parseBullMqRedisConnectionInfo,
  resolveBullMqPrefix,
} from '@league-helper/shared';
import { IngestionJobStatus, MatchIngestionStatus } from '@prisma/client';
import { AppModule } from '../../app.module';
import { loadPlayerRefreshConfig } from '../../config/player-refresh.config';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchIngestionProducer } from '../match-ingestion.producer';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const producer = app.get(MatchIngestionProducer);
    const refreshConfig = loadPlayerRefreshConfig();
    const prefix = resolveBullMqPrefix();
    const redisInfo = parseBullMqRedisConnectionInfo(refreshConfig.redisUrl, prefix);

    const [
      pending,
      queued,
      running,
      completed,
      failed,
      dead,
      queueCounts,
      completedMatches,
      paused,
      workerCount,
      queuedDurable,
    ] = await Promise.all([
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.PENDING },
      }),
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.QUEUED },
      }),
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.RUNNING },
      }),
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.COMPLETED },
      }),
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.FAILED },
      }),
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.DEAD_LETTERED },
      }),
      producer.getQueueCounts(),
      prisma.match.count({ where: { ingestionStatus: MatchIngestionStatus.COMPLETED } }),
      producer.isPaused(),
      producer.getWorkerCount(),
      prisma.ingestionJobRecord.findMany({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.QUEUED },
        select: { externalResourceId: true, metadata: true },
        take: 500,
      }),
    ]);

    let durableMissingRedisJobs = 0;
    let strandedCompletedBullJobs = 0;
    for (const record of queuedDurable) {
      const metadata = record.metadata as {
        regionalRoute?: string;
        externalMatchId?: string;
        provider?: string;
        normalizationVersion?: number;
      } | null;
      const externalMatchId = record.externalResourceId ?? metadata?.externalMatchId;
      const regionalRoute = metadata?.regionalRoute;
      const provider = metadata?.provider ?? 'RIOT';
      if (!externalMatchId || !regionalRoute) {
        durableMissingRedisJobs += 1;
        continue;
      }
      const jobId = buildMatchIngestionBullMqJobId({
        provider,
        regionalRoute,
        externalMatchId,
        normalizationVersion:
          metadata?.normalizationVersion ?? MATCH_INGESTION_NORMALIZATION_VERSION,
      });
      const state = await producer.getJobState(jobId);
      if (state === null) {
        durableMissingRedisJobs += 1;
      } else if (state === 'completed' || state === 'failed') {
        strandedCompletedBullJobs += 1;
      }
    }

    const notes: string[] = [];
    if (queueCounts.waiting > 0 && workerCount === 0) {
      notes.push('No active worker is attached to match-ingestion.');
    }
    if (workerCount > 0 && queueCounts.waiting > 0) {
      // waiting jobs should move — if not, likely processor/name/namespace issues
    }
    if (
      workerCount > 0 &&
      queueCounts.waiting === 0 &&
      (durableMissingRedisJobs > 0 || strandedCompletedBullJobs > 0 || queued > 0)
    ) {
      notes.push(
        'Worker is attached but durable QUEUED jobs are not waiting in Redis. Likely causes: completed/failed BullMQ IDs blocking republish (run reconcile), queue paused, job-name mismatch, or Redis namespace mismatch.',
      );
    }
    if (paused) {
      notes.push('Queue is paused.');
    }
    if (notes.length === 0) {
      notes.push('Run pnpm dev:worker so match-ingestion can drain waiting jobs.');
    }

    console.log(
      JSON.stringify({
        ok: true,
        queueName: producer.getQueueName() || MATCH_INGESTION_QUEUE_NAME,
        bullmqPrefix: prefix || BULLMQ_DEFAULT_PREFIX,
        redisDatabase: redisInfo.database,
        paused,
        workerCount,
        durable: {
          pending,
          queued,
          active: running,
          completed,
          failed,
          deadLettered: dead,
        },
        bullmq: queueCounts,
        durableMissingRedisJobs,
        strandedCompletedBullJobs,
        completedMatches,
        notes,
      }),
    );
  } finally {
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 1_500);
      }),
    ]);
    process.exit(process.exitCode ?? 0);
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
