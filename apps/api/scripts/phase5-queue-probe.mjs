/** Read-only BullMQ probe for Phase 5 drain diagnosis. */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const name =
  process.env.PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME ?? 'participant-rank-enrichment';
const queue = new Queue(name, { connection });

try {
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'failed',
    'completed',
    'paused',
  );
  const delayed = await queue.getDelayed(0, 4);
  const samples = [];
  for (const job of delayed) {
    samples.push({
      id: job.id,
      name: job.name,
      delay: job.delay,
      timestamp: job.timestamp,
      processedOn: job.processedOn ?? null,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      providerResultCode: job.data?.providerResultCode ?? null,
      reason: job.data?.reason ?? null,
    });
  }
  const cooldownRaw = await connection.get('riot:shared-429-cooldown');
  console.log(
    JSON.stringify(
      {
        counts,
        delayedSamples: samples,
        sharedCooldownRawPresent: Boolean(cooldownRaw),
        sharedCooldownPreview: cooldownRaw ? JSON.parse(cooldownRaw) : null,
        now: Date.now(),
      },
      null,
      2,
    ),
  );
} finally {
  await queue.close();
  connection.disconnect();
}
