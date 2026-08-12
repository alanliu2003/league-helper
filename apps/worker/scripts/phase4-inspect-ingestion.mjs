import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../.env') });

const prisma = new PrismaClient();
try {
  const byStatus = await prisma.match.groupBy({
    by: ['ingestionStatus', 'queueId'],
    _count: { _all: true },
  });
  const jobs = await prisma.ingestionJobRecord.groupBy({
    by: ['status', 'jobType'],
    _count: { _all: true },
  });
  const pending = await prisma.matchParticipant.count({
    where: { rankResolutionStatus: 'PENDING' },
  });
  const retry = await prisma.matchParticipant.count({
    where: { rankResolutionStatus: 'FAILED_RETRYABLE' },
  });
  const recent = await prisma.match.findMany({
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      externalMatchId: true,
      queueId: true,
      ingestionStatus: true,
      normalizedPatch: true,
      createdAt: true,
      remake: true,
      _count: { select: { participants: true } },
    },
  });
  console.log(JSON.stringify({ byStatus, jobs, pending, retry, recent }, null, 2));
} finally {
  await prisma.$disconnect();
}
