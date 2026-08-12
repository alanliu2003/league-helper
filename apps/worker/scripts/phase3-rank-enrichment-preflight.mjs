/**
 * M12-v2 Phase 3 preflight: confirm league_helper_m12v2 + clean enrichment queue.
 * Read-only. Does not mass-delete Redis.
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../.env') });

const EXPECTED_DB = 'league_helper_m12v2';
const EXPECTED_MIGRATION = '20260810190000_m12v2_participant_rank_foundation';
const QUEUE_NAME = process.env.PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME?.trim() || 'participant-rank-enrichment';
const PREFIX = process.env.BULLMQ_PREFIX?.trim() || 'bull';

function dbNameFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return null;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('RESULT=STOP reason=DATABASE_URL_MISSING');
    process.exit(2);
  }
  const dbName = dbNameFromUrl(databaseUrl);
  if (dbName !== EXPECTED_DB) {
    console.error(`RESULT=STOP reason=WRONG_DB expected=${EXPECTED_DB} actual=${dbName}`);
    process.exit(2);
  }
  if (dbName === 'league_helper') {
    console.error('RESULT=STOP reason=OLD_EXPERIMENTAL_DB');
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const redisUrl = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  try {
    const migrations = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at ASC NULLS LAST`,
    );
    const names = migrations.map((m) => m.migration_name);
    const head = names[names.length - 1] ?? null;
    if (head !== EXPECTED_MIGRATION) {
      console.error(`RESULT=STOP reason=WRONG_MIGRATION_HEAD expected=${EXPECTED_MIGRATION} actual=${head}`);
      process.exit(2);
    }

    const [tracked, matches, participants, observations] = await Promise.all([
      prisma.trackedPlayer.count(),
      prisma.match.count(),
      prisma.matchParticipant.count(),
      prisma.participantRankObservation.count(),
    ]);

    const queue = new Queue(QUEUE_NAME, {
      connection: redis,
      prefix: PREFIX,
    });
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'completed',
      'failed',
      'paused',
    );
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'failed'], 0, 20);
    const staleJobNames = [
      ...new Set(jobs.map((j) => j?.name).filter((n) => n && n !== 'ENRICH_PARTICIPANT_RANK')),
    ];

    const report = {
      database: dbName,
      migrationHead: head,
      migrationCount: names.length,
      trackedPlayers: tracked,
      matches,
      matchParticipants: participants,
      participantRankObservations: observations,
      enrichmentQueue: QUEUE_NAME,
      bullmqPrefix: PREFIX,
      queueCounts: counts,
      inspectedJobCount: jobs.length,
      staleConflictingJobNames: staleJobNames,
    };
    console.log(JSON.stringify(report, null, 2));

    if (staleJobNames.length > 0) {
      console.error('RESULT=STOP reason=STALE_CONFLICTING_JOBS');
      console.error(JSON.stringify({ staleJobNames }));
      process.exit(2);
    }

    const live =
      (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.failed ?? 0);
    if (live === 0) {
      console.log('RESULT=OK enrichment_queue=clean');
    } else if ((counts.failed ?? 0) > 0 && (counts.waiting ?? 0) + (counts.active ?? 0) === 0) {
      // Failed leftovers with correct job name still need operator review before mass delete.
      console.log('RESULT=OK_WITH_FAILED_LEFTOVERS review_failed_set=true');
    } else {
      console.log('RESULT=OK enrichment_queue_has_jobs inspect_before_validation=true');
    }

    await queue.close();
  } finally {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  }
}

main().catch((error) => {
  console.error('RESULT=STOP reason=PREFLIGHT_ERROR', error instanceof Error ? error.message : error);
  process.exit(2);
});
