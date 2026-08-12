import { describe, expect, it } from 'vitest';
import {
  ParticipantRankEnrichmentJobPayloadSchema,
  buildParticipantRankEnrichmentBullMqJobId,
} from './participant-rank-enrichment-job';

describe('ParticipantRankEnrichmentJobPayloadSchema', () => {
  it('accepts minimal dedupe-scoped payload', () => {
    const parsed = ParticipantRankEnrichmentJobPayloadSchema.parse({
      platformRoute: 'na1',
      externalAccountId: 'puuid-abc',
      queueType: 'RANKED_SOLO_5x5',
      reason: 'MATCH_INGESTION',
    });
    expect(parsed.externalAccountId).toBe('puuid-abc');
  });

  it('rejects secrets-looking oversized fields via schema bounds', () => {
    expect(() =>
      ParticipantRankEnrichmentJobPayloadSchema.parse({
        platformRoute: 'na1',
        externalAccountId: 'x'.repeat(200),
        queueType: 'RANKED_SOLO_5x5',
        reason: 'BACKFILL',
      }),
    ).toThrow();
  });
});

describe('buildParticipantRankEnrichmentBullMqJobId', () => {
  it('is deterministic for same platform/puuid/queue', () => {
    const a = buildParticipantRankEnrichmentBullMqJobId({
      platformRoute: 'na1',
      externalAccountId: 'puuid-1',
      queueType: 'RANKED_SOLO_5x5',
    });
    const b = buildParticipantRankEnrichmentBullMqJobId({
      platformRoute: 'na1',
      externalAccountId: 'puuid-1',
      queueType: 'RANKED_SOLO_5x5',
    });
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(128);
  });

  it('differs across queue types', () => {
    const solo = buildParticipantRankEnrichmentBullMqJobId({
      platformRoute: 'na1',
      externalAccountId: 'puuid-1',
      queueType: 'RANKED_SOLO_5x5',
    });
    const flex = buildParticipantRankEnrichmentBullMqJobId({
      platformRoute: 'na1',
      externalAccountId: 'puuid-1',
      queueType: 'RANKED_FLEX_SR',
    });
    expect(solo).not.toBe(flex);
  });
});
