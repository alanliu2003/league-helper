/**
 * Phase 6B.2 ops helper: mark ACTIVE LADDER roots created after --since eligible now.
 * Refuses anything except league_helper_m12v2. Does not print PUUIDs.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b2-make-ladder-eligible.mjs --since 2026-08-11T06:30:00.000Z
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b2-make-ladder-eligible.mjs --since ... --limit 15
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('league_helper_m12v2') || url.includes('/league_helper?')) {
  console.error(JSON.stringify({ ok: false, error: 'REFUSE_DB' }));
  process.exit(2);
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const sinceRaw = argValue('--since');
if (!sinceRaw) {
  console.error(JSON.stringify({ ok: false, error: 'MISSING_SINCE', hint: '--since ISO' }));
  process.exit(2);
}
const since = new Date(sinceRaw);
if (Number.isNaN(since.getTime())) {
  console.error(JSON.stringify({ ok: false, error: 'BAD_SINCE', sinceRaw }));
  process.exit(2);
}

const limit = Math.min(
  40,
  Math.max(1, Number(argValue('--limit') ?? 20) || 20),
);

const p = new PrismaClient();
try {
  const candidates = await p.trackedPlayer.findMany({
    where: {
      enrollmentSource: 'LADDER',
      status: 'ACTIVE',
      discoveryDepth: 0,
      platformRoute: 'na1',
      createdAt: { gte: since },
    },
    orderBy: [{ createdAt: 'asc' }],
    take: limit,
    select: { id: true, createdAt: true, lastSuccessfulRefreshAt: true },
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
        since: since.toISOString(),
        requestedLimit: limit,
        selected: ids.length,
        updated: updated.count,
        selectedIds: ids,
        createdAtRange:
          candidates.length === 0
            ? null
            : {
                min: candidates[0].createdAt.toISOString(),
                max: candidates[candidates.length - 1].createdAt.toISOString(),
              },
        note: 'Only roots created at/after --since; leases cleared. No Riot calls.',
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
