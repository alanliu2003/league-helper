import { z } from 'zod';
import { MATCH_TIMELINE_JOB_NAME } from './queue-names';

const BULLMQ_JOB_ID_MAX_LENGTH = 128;

/**
 * Frontend/backend-safe BullMQ payload for match-timeline enrichment.
 * Must never include API keys, PUUIDs, Riot match ids, or raw payloads.
 * `includeIneligible` is CLI-only; the API producer always omits/false.
 */
export const MatchTimelineJobPayloadSchema = z.object({
  matchId: z.string().uuid(),
  correlationId: z.string().min(1).max(128).optional(),
  includeIneligible: z.boolean().optional(),
});

export type MatchTimelineJobPayload = z.infer<typeof MatchTimelineJobPayloadSchema>;

export const MatchTimelineJobTypeSchema = z.literal(MATCH_TIMELINE_JOB_NAME);
export type MatchTimelineJobType = z.infer<typeof MatchTimelineJobTypeSchema>;

/**
 * Deterministic BullMQ job ID from the internal match UUID.
 * Never embed Riot match ids or PUUIDs.
 */
export function buildMatchTimelineBullMqJobId(input: { matchId: string }): string {
  return `tl_${input.matchId}`.slice(0, BULLMQ_JOB_ID_MAX_LENGTH);
}
