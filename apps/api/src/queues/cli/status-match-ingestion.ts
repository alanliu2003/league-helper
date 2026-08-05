import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MATCH_INGESTION_JOB_NAME } from '@league-helper/shared';
import { IngestionJobStatus } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchIngestionProducer } from '../match-ingestion.producer';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const producer = app.get(MatchIngestionProducer);

    const [pending, queued, running, failed, dead, queueCounts] = await Promise.all([
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
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.FAILED },
      }),
      prisma.ingestionJobRecord.count({
        where: { jobType: MATCH_INGESTION_JOB_NAME, status: IngestionJobStatus.DEAD_LETTERED },
      }),
      producer.getQueueCounts(),
    ]);

    console.log(
      JSON.stringify({
        ok: true,
        durable: { pending, queued, running, failed, deadLettered: dead },
        bullmq: queueCounts,
        note: 'Match-ingestion jobs remain waiting until Milestone 6 implements a processor.',
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
