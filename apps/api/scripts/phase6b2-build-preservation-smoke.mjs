/**
 * Phase 6B.2 smoke: verify build-data preservation on matches created at/after --since.
 * Refuses anything except league_helper_m12v2.
 *
 * Usage:
 *   node --env-file=apps/api/.env apps/api/scripts/phase6b2-build-preservation-smoke.mjs --since ISO [--sample 5]
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
  console.error(JSON.stringify({ ok: false, error: 'MISSING_SINCE' }));
  process.exit(2);
}
const since = new Date(sinceRaw);
if (Number.isNaN(since.getTime())) {
  console.error(JSON.stringify({ ok: false, error: 'BAD_SINCE', sinceRaw }));
  process.exit(2);
}
const sample = Math.min(20, Math.max(1, Number(argValue('--sample') ?? 5) || 5));

const p = new PrismaClient();
try {
  const matches = await p.match.findMany({
    where: {
      queueId: 420,
      platformRoute: 'na1',
      createdAt: { gte: since },
      ingestionStatus: 'COMPLETED',
    },
    orderBy: { createdAt: 'desc' },
    take: sample,
    select: {
      id: true,
      externalMatchId: true,
      createdAt: true,
      participants: {
        take: 1,
        select: {
          itemIds: true,
          primaryPerkStyleId: true,
          secondaryPerkStyleId: true,
          perkIds: true,
          skillOrder: true,
        },
      },
      timeline: {
        select: {
          fetchStatus: true,
        },
      },
    },
  });

  const matchIds = matches.map((m) => m.id);
  const eventCounts = await p.matchTimelineEvent.groupBy({
    by: ['matchId'],
    _count: true,
    where: { matchId: { in: matchIds } },
  });
  const eventsByMatch = Object.fromEntries(eventCounts.map((row) => [row.matchId, row._count]));

  const eventTypeCounts = await p.matchTimelineEvent.groupBy({
    by: ['type'],
    _count: true,
    where: {
      match: {
        queueId: 420,
        platformRoute: 'na1',
        createdAt: { gte: since },
      },
    },
  });

  const samples = matches.map((m) => {
    const part = m.participants[0];
    const itemIds = part?.itemIds ?? [];
    const timelineEventCount = eventsByMatch[m.id] ?? 0;
    return {
      matchId: m.externalMatchId,
      createdAt: m.createdAt.toISOString(),
      itemIdsLength: itemIds.length,
      itemIdsIncludesZero: itemIds.includes(0),
      primaryPerkStyleId: part?.primaryPerkStyleId ?? null,
      secondaryPerkStyleId: part?.secondaryPerkStyleId ?? null,
      perkIdsCount: part?.perkIds?.length ?? 0,
      skillOrderCount: part?.skillOrder?.length ?? 0,
      timelineFetchStatus: m.timeline?.fetchStatus ?? null,
      timelineEventCount,
      ok:
        itemIds.length === 7 &&
        part?.primaryPerkStyleId != null &&
        part?.secondaryPerkStyleId != null &&
        timelineEventCount > 0,
    };
  });

  const okCount = samples.filter((s) => s.ok).length;
  console.log(
    JSON.stringify(
      {
        ok: samples.length > 0 && okCount === samples.length,
        database: 'league_helper_m12v2',
        since: since.toISOString(),
        sampled: samples.length,
        okCount,
        eventTypeCounts: Object.fromEntries(
          eventTypeCounts.map((row) => [row.type, row._count]),
        ),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await p.$disconnect();
}
