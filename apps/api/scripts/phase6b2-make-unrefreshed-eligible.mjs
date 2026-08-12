/**
 * Mark Stage-window LADDER roots that still lack lastSuccessfulRefreshAt as eligible.
 * league_helper_m12v2 only.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('league_helper_m12v2') || url.includes('/league_helper?')) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB' }));
  process.exit(2);
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const since = new Date(argValue('--since'));
const limit = Math.min(40, Math.max(1, Number(argValue('--limit') ?? 20) || 20));
const p = new PrismaClient();
try {
  const candidates = await p.trackedPlayer.findMany({
    where: {
      enrollmentSource: 'LADDER',
      status: 'ACTIVE',
      discoveryDepth: 0,
      platformRoute: 'na1',
      createdAt: { gte: since },
      lastSuccessfulRefreshAt: null,
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, createdAt: true },
  });
  const now = new Date();
  const ids = candidates.map((r) => r.id);
  const updated = await p.trackedPlayer.updateMany({
    where: { id: { in: ids } },
    data: { nextEligibleAt: now, leaseOwner: null, leaseExpiresAt: null },
  });
  const remaining = await p.trackedPlayer.count({
    where: {
      enrollmentSource: 'LADDER',
      createdAt: { gte: since },
      lastSuccessfulRefreshAt: null,
    },
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        since: since.toISOString(),
        selected: ids.length,
        updated: updated.count,
        remainingUnrefreshed: remaining,
        selectedIds: ids,
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
