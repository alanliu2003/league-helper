import { describe, expect, it } from 'vitest';
import {
  MatchIngestionJobPayloadSchema,
  buildMatchIngestionBullMqJobId,
  buildMatchIngestionIdempotencyKey,
} from './match-ingestion-job';

describe('match ingestion job contract', () => {
  it('builds a stable idempotency key and BullMQ job id', () => {
    const input = {
      provider: 'RIOT',
      regionalRoute: 'americas',
      externalMatchId: 'NA1_123456789',
      normalizationVersion: 1,
    };

    expect(buildMatchIngestionIdempotencyKey(input)).toBe('RIOT:americas:NA1_123456789:1');
    expect(buildMatchIngestionBullMqJobId(input)).toBe('ingest_RIOT_americas_NA1_123456789_1');
    expect(buildMatchIngestionBullMqJobId(input)).toBe(buildMatchIngestionBullMqJobId(input));
  });

  it('idempotency key ignores sourceCollectorRunId (attribution is not Match identity)', () => {
    const base = {
      provider: 'RIOT',
      regionalRoute: 'americas',
      externalMatchId: 'NA1_123456789',
      normalizationVersion: 1,
    };
    expect(buildMatchIngestionIdempotencyKey(base)).toBe(
      buildMatchIngestionIdempotencyKey(base),
    );
    // sourceCollectorRunId is payload metadata only — not an input to key builders.
    expect(buildMatchIngestionIdempotencyKey(base)).toBe('RIOT:americas:NA1_123456789:1');
  });

  const basePayload = {
    provider: 'RIOT' as const,
    externalMatchId: 'NA1_123456789',
    regionalRoute: 'americas' as const,
    requestedByPlayerAccountId: '00000000-0000-4000-8000-000000000001',
    correlationId: 'corr-1',
    normalizationVersion: 1,
    discoveredAt: new Date().toISOString(),
  };

  it('parses payloads without sourceCollectorRunId', () => {
    const result = MatchIngestionJobPayloadSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('sourceCollectorRunId');
    }
  });

  it('parses payloads with a valid sourceCollectorRunId uuid', () => {
    const result = MatchIngestionJobPayloadSchema.safeParse({
      ...basePayload,
      sourceCollectorRunId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceCollectorRunId).toBe('11111111-1111-4111-8111-111111111111');
    }
  });

  it('rejects payloads with an invalid sourceCollectorRunId', () => {
    const result = MatchIngestionJobPayloadSchema.safeParse({
      ...basePayload,
      sourceCollectorRunId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects payloads that look like secrets or arbitrary URLs', () => {
    const result = MatchIngestionJobPayloadSchema.safeParse({
      provider: 'RIOT',
      externalMatchId: 'NA1_1',
      regionalRoute: 'americas',
      requestedByPlayerAccountId: '00000000-0000-4000-8000-000000000001',
      correlationId: 'corr-1',
      normalizationVersion: 1,
      discoveredAt: new Date().toISOString(),
      riotApiKey: 'secret',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('riotApiKey');
    }
  });
});
