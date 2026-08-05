import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { IngestionReconciliationService } from '../ingestion-reconciliation.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const reconciler = app.get(IngestionReconciliationService);
    const summary = await reconciler.reconcilePending();
    // Safe counts only — never print payloads or secrets.
    console.log(
      JSON.stringify({
        ok: true,
        examined: summary.examined,
        alreadyPresent: summary.alreadyPresent,
        published: summary.published,
        repairedQueuedWithoutRedisJob: summary.repairedQueuedWithoutRedisJob,
        invalid: summary.invalid,
        failed: summary.failed,
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
