import { z } from 'zod';
import { ProviderIdSchema } from '../provider-id';
import { RegionalRouteSchema } from '../routing';
import { MATCH_INGESTION_JOB_NAME } from './queue-names';

export const MATCH_INGESTION_NORMALIZATION_VERSION = 1 as const;

/**
 * Frontend/backend-safe BullMQ payload for match ingestion.
 * Must never include API keys, PUUIDs, raw Riot payloads, or arbitrary URLs.
 */
export const MatchIngestionJobPayloadSchema = z.object({
  provider: ProviderIdSchema,
  externalMatchId: z.string().min(1).max(64),
  regionalRoute: RegionalRouteSchema,
  requestedByPlayerAccountId: z.string().uuid(),
  correlationId: z.string().min(1).max(128),
  normalizationVersion: z.number().int().positive().default(MATCH_INGESTION_NORMALIZATION_VERSION),
  discoveredAt: z.string().datetime(),
});

export type MatchIngestionJobPayload = z.infer<typeof MatchIngestionJobPayloadSchema>;

export const MatchIngestionJobTypeSchema = z.literal(MATCH_INGESTION_JOB_NAME);
export type MatchIngestionJobType = z.infer<typeof MatchIngestionJobTypeSchema>;

/** Stable identity used for durable records and deterministic BullMQ job IDs. */
export function buildMatchIngestionIdempotencyKey(input: {
  provider: string;
  regionalRoute: string;
  externalMatchId: string;
  normalizationVersion?: number;
}): string {
  const version = input.normalizationVersion ?? MATCH_INGESTION_NORMALIZATION_VERSION;
  return [input.provider, input.regionalRoute, input.externalMatchId, String(version)].join(':');
}

/**
 * BullMQ job IDs must avoid unsafe characters. Produce a stable, sanitized ID
 * from the idempotency key without Node-only crypto (shared is browser-safe).
 */
export function buildMatchIngestionBullMqJobId(input: {
  provider: string;
  regionalRoute: string;
  externalMatchId: string;
  normalizationVersion?: number;
}): string {
  const key = buildMatchIngestionIdempotencyKey(input);
  const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  // Prefix keeps IDs readable in Redis while remaining deterministic.
  return `ingest_${sanitized}`.slice(0, 128);
}
