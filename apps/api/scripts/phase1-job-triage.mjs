/**
 * Read-only M12-v2 Phase 1 durable ingestion job triage.
 * Does not retry or mutate jobs. Never prints secrets.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function classifyFailure(row) {
  const code = String(row.lastErrorCode ?? '').toUpperCase();
  const message = String(row.lastErrorMessage ?? '').toUpperCase();
  const blob = `${code} ${message}`;

  if (
    blob.includes('401') ||
    blob.includes('403') ||
    blob.includes('UNAUTHORIZED') ||
    blob.includes('FORBIDDEN')
  ) {
    return 'auth';
  }
  if (blob.includes('429') || blob.includes('RATE') || blob.includes('RETRY-AFTER')) {
    return 'rate_limit';
  }
  if (
    blob.includes('404') ||
    blob.includes('NOT_FOUND') ||
    blob.includes('NOT FOUND') ||
    blob.includes('PERMANENT')
  ) {
    return 'permanent_not_found';
  }
  if (
    blob.includes('TIMEOUT') ||
    blob.includes('ECONN') ||
    blob.includes('ENOTFOUND') ||
    blob.includes('NETWORK') ||
    blob.includes('UNAVAILABLE') ||
    blob.includes('5')
  ) {
    return 'transient_network';
  }
  if (!code && !message.trim()) {
    return 'unknown';
  }
  return 'unknown';
}

try {
  const byStatus = await prisma.ingestionJobRecord.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const statusCounts = Object.fromEntries(
    byStatus.map((row) => [row.status, row._count._all]),
  );

  const failedLike = await prisma.ingestionJobRecord.findMany({
    where: { status: { in: ['FAILED', 'DEAD_LETTERED'] } },
    select: {
      status: true,
      lastErrorCode: true,
      lastErrorMessage: true,
    },
    take: 500,
  });

  const classifications = {
    auth: 0,
    rate_limit: 0,
    transient_network: 0,
    permanent_not_found: 0,
    unknown: 0,
  };

  for (const row of failedLike) {
    classifications[classifyFailure(row)] += 1;
  }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  console.log(
    JSON.stringify(
      {
        ok: true,
        total,
        statusCounts: {
          PENDING: statusCounts.PENDING ?? 0,
          QUEUED: statusCounts.QUEUED ?? 0,
          RUNNING: statusCounts.RUNNING ?? 0,
          COMPLETED: statusCounts.COMPLETED ?? 0,
          FAILED: statusCounts.FAILED ?? 0,
          DEAD_LETTERED: statusCounts.DEAD_LETTERED ?? 0,
          CANCELLED: statusCounts.CANCELLED ?? 0,
        },
        failedSampleSize: failedLike.length,
        failureClassifications: classifications,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error?.message ?? String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
