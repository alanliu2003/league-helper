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
