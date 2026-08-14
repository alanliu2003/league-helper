import { z } from 'zod';
import { CHAMPION_AI_INSIGHT_JOB_NAME } from './queue-names';

const BULLMQ_JOB_ID_MAX_LENGTH = 128;
const JOB_ID_PREFIX = 'ai_champ_';
const FINGERPRINT_JOB_ID_CHARS = 24;

/**
 * Frontend/backend-safe BullMQ payload for champion AI insight generation.
 * Must never include API keys, prompts, raw context, or player identifiers.
 */
export const ChampionAiInsightJobPayloadSchema = z.object({
  insightId: z.string().uuid(),
  contextFingerprint: z.string().min(16).max(64),
  correlationId: z.string().min(1).max(128).optional(),
});

export type ChampionAiInsightJobPayload = z.infer<typeof ChampionAiInsightJobPayloadSchema>;

export const ChampionAiInsightJobTypeSchema = z.literal(CHAMPION_AI_INSIGHT_JOB_NAME);
export type ChampionAiInsightJobType = z.infer<typeof ChampionAiInsightJobTypeSchema>;

/**
 * Deterministic BullMQ job ID for LIVE-state dedupe by context fingerprint.
 * Uses `ai_champ_` plus the first 24 hex chars (or the available prefix if shorter).
 */
export function buildChampionAiInsightBullMqJobId(input: { contextFingerprint: string }): string {
  const contextFingerprint = z.string().min(16).max(64).parse(input.contextFingerprint);
  const id = `${JOB_ID_PREFIX}${contextFingerprint.slice(0, FINGERPRINT_JOB_ID_CHARS)}`;
  return id.slice(0, BULLMQ_JOB_ID_MAX_LENGTH);
}
