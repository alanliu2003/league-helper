/**
 * Phase 6B.1 ops helper: mark up to N ACTIVE LADDER roots eligible now.
 * Refuses anything except league_helper_m12v2. Does not print PUUIDs.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b1-make-ladder-eligible.mjs --limit 12
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('league_helper_m12v2') || url.includes('/league_helper?')) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB' }));
  process.exit(2);
}

const limitIdx = process.argv.indexOf('--limit');
const limit = Math.min(
  15,
  Math.max(1, Number(limitIdx >= 0 ? process.argv[limitIdx + 1] : 12) || 12),
);

const p = new PrismaClient();
try {
  const candidates = await p.trackedPlayer.findMany({
    where: {
      enrollmentSource: 'LADDER',
      status: 'ACTIVE',
      discoveryDepth: 0,
      platformRoute: 'na1',
    },
    orderBy: [{ lastSuccessfulRefreshAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true, lastSuccessfulRefreshAt: true, nextEligibleAt: true },
  });

  const now = new Date();
  const ids = candidates.map((row) => row.id);
  const updated = await p.trackedPlayer.updateMany({
    where: { id: { in: ids } },
    data: {
      nextEligibleAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: 'league_helper_m12v2',
        requestedLimit: limit,
        selected: ids.length,
        updated: updated.count,
        selectedIds: ids,
        note: 'nextEligibleAt set to now; leases cleared. No Riot calls.',
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
