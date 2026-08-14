import { z } from 'zod';
import { PLAYER_AI_PLAYSTYLE_JOB_NAME } from './queue-names';

const BULLMQ_JOB_ID_MAX_LENGTH = 128;
const JOB_ID_PREFIX = 'ai_player_';
const FINGERPRINT_JOB_ID_CHARS = 24;

/**
 * Frontend/backend-safe BullMQ payload for player playstyle insight generation.
 * Must never include API keys, prompts, raw context, or player identifiers.
 */
export const PlayerPlaystyleInsightJobPayloadSchema = z.object({
  insightId: z.string().uuid(),
  contextFingerprint: z.string().min(16).max(64),
  correlationId: z.string().min(1).max(128).optional(),
});

export type PlayerPlaystyleInsightJobPayload = z.infer<
  typeof PlayerPlaystyleInsightJobPayloadSchema
>;

export const PlayerPlaystyleInsightJobTypeSchema = z.literal(PLAYER_AI_PLAYSTYLE_JOB_NAME);
export type PlayerPlaystyleInsightJobType = z.infer<typeof PlayerPlaystyleInsightJobTypeSchema>;

/**
 * Deterministic BullMQ job ID for LIVE-state dedupe by context fingerprint.
 * Uses `ai_player_` plus the first 24 hex chars (or the available prefix if shorter).
 */
export function buildPlayerPlaystyleInsightBullMqJobId(input: {
  contextFingerprint: string;
}): string {
  const contextFingerprint = z.string().min(16).max(64).parse(input.contextFingerprint);
  const id = `${JOB_ID_PREFIX}${contextFingerprint.slice(0, FINGERPRINT_JOB_ID_CHARS)}`;
  return id.slice(0, BULLMQ_JOB_ID_MAX_LENGTH);
}
