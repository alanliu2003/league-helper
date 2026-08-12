import { z } from 'zod';
import { PlatformRouteSchema } from '../routing';
import { QueueTypeSchema } from '../queues';
import { PARTICIPANT_RANK_ENRICHMENT_JOB_NAME } from './queue-names';

const BULLMQ_JOB_ID_MAX_LENGTH = 128;
const JOB_ID_PREFIX = 'rank_enrich_';

/**
 * Frontend/backend-safe BullMQ payload for participant-rank enrichment (Phase 3).
 * Must never include API keys, emails, or unnecessary player metadata.
 *
 * Dedup identity: platform + externalAccountId (PUUID) + queueType.
 */
export const ParticipantRankEnrichmentJobPayloadSchema = z.object({
  platformRoute: PlatformRouteSchema,
  /** Riot PUUID — sufficient for League-v4 entries/by-puuid. */
  externalAccountId: z.string().min(1).max(128),
  queueType: z.enum(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']),
  reason: z.enum([
    'MATCH_INGESTION',
    'BACKFILL',
    'RETRY',
    'MANUAL',
    'OBSERVATION_STALE',
  ]),
  /** Optional match context for ops correlation only. */
  matchId: z.string().uuid().optional(),
  correlationId: z.string().min(1).max(128).optional(),
});

export type ParticipantRankEnrichmentJobPayload = z.infer<
  typeof ParticipantRankEnrichmentJobPayloadSchema
>;

export const ParticipantRankEnrichmentJobTypeSchema = z.literal(
  PARTICIPANT_RANK_ENRICHMENT_JOB_NAME,
);
export type ParticipantRankEnrichmentJobType = z.infer<
  typeof ParticipantRankEnrichmentJobTypeSchema
>;

/** Browser-safe FNV-1a 32-bit hash → fixed hex (no Node crypto). */
function stableShortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic BullMQ job ID for singleflight / dedupe at
 * (platform, puuid, queueType) scope.
 */
export function buildParticipantRankEnrichmentBullMqJobId(input: {
  platformRoute: string;
  externalAccountId: string;
  queueType: string;
}): string {
  const platformRoute = PlatformRouteSchema.parse(input.platformRoute);
  const externalAccountId = z.string().min(1).max(128).parse(input.externalAccountId);
  const queueType = QueueTypeSchema.parse(input.queueType);

  const digest = stableShortHash(`${platformRoute}\0${externalAccountId}\0${queueType}`);
  const id = `${JOB_ID_PREFIX}${platformRoute}_${queueType}_${digest}`;
  return id.slice(0, BULLMQ_JOB_ID_MAX_LENGTH);
}
