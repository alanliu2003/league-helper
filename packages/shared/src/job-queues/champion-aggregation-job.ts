import { z } from 'zod';
import { CHAMPION_AGGREGATION_JOB_NAME } from './queue-names';

const BULLMQ_JOB_ID_MAX_LENGTH = 128;
const JOB_ID_PREFIX = 'agg_champ_';
const SAFE_VERSION_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Frontend/backend-safe BullMQ payload for champion aggregate recalculation.
 * Must never include API keys, account identifiers, or raw match payloads.
 */
export const ChampionAggregationJobPayloadSchema = z.object({
  matchId: z.string().uuid(),
  sourceNormalizationVersion: z.string().min(1),
  aggregationVersion: z.string().min(1),
  correlationId: z.string().min(1).max(128).optional(),
});

export type ChampionAggregationJobPayload = z.infer<typeof ChampionAggregationJobPayloadSchema>;

export const ChampionAggregationJobTypeSchema = z.literal(CHAMPION_AGGREGATION_JOB_NAME);
export type ChampionAggregationJobType = z.infer<typeof ChampionAggregationJobTypeSchema>;

/** Browser-safe FNV-1a 32-bit hash → fixed hex (no Node crypto). */
function stableShortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function versionsNeedHash(sourceNormalizationVersion: string, aggregationVersion: string): boolean {
  if (
    !SAFE_VERSION_PATTERN.test(sourceNormalizationVersion) ||
    !SAFE_VERSION_PATTERN.test(aggregationVersion)
  ) {
    return true;
  }

  // Leave headroom for prefix + UUID + separators within 128 chars.
  const readableLength =
    JOB_ID_PREFIX.length +
    36 +
    1 +
    sourceNormalizationVersion.length +
    1 +
    aggregationVersion.length;
  return readableLength > BULLMQ_JOB_ID_MAX_LENGTH;
}

/**
 * Deterministic BullMQ job ID for concurrent dedupe.
 * Keeps matchId readable; hashes version tuple when versions are unsafe or long.
 */
export function buildChampionAggregationBullMqJobId(input: {
  matchId: string;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
}): string {
  const matchId = z.string().uuid().parse(input.matchId);
  const sourceNormalizationVersion = z.string().min(1).parse(input.sourceNormalizationVersion);
  const aggregationVersion = z.string().min(1).parse(input.aggregationVersion);

  const versionPart = versionsNeedHash(sourceNormalizationVersion, aggregationVersion)
    ? stableShortHash(`${sourceNormalizationVersion}\0${aggregationVersion}`)
    : `${sourceNormalizationVersion}_${aggregationVersion}`;

  const id = `${JOB_ID_PREFIX}${matchId}_${versionPart}`;
  return id.slice(0, BULLMQ_JOB_ID_MAX_LENGTH);
}
