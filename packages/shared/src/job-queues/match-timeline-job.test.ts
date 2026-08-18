import { describe, expect, it } from 'vitest';
import { MATCH_TIMELINE_JOB_NAME } from './queue-names';
import {
  MatchTimelineJobPayloadSchema,
  MatchTimelineJobTypeSchema,
  buildMatchTimelineBullMqJobId,
} from './match-timeline-job';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

describe('match timeline job contract', () => {
  it('builds a deterministic BullMQ job id from the internal match UUID', () => {
    const input = { matchId: MATCH_ID };
    const a = buildMatchTimelineBullMqJobId(input);
    const b = buildMatchTimelineBullMqJobId(input);

    expect(a).toBe(b);
    expect(a).toBe(`tl_${MATCH_ID}`);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).not.toContain('NA1_');
  });

  it('accepts a valid payload and strips unknown leak fields', () => {
    const result = MatchTimelineJobPayloadSchema.safeParse({
      matchId: MATCH_ID,
      correlationId: 'corr-1',
      includeIneligible: true,
      puuid: 'should-not-be-required-or-kept',
      externalMatchId: 'NA1_123456789',
      riotApiKey: 'secret',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matchId).toBe(MATCH_ID);
      expect(result.data.correlationId).toBe('corr-1');
      expect(result.data.includeIneligible).toBe(true);
      expect(result.data).not.toHaveProperty('puuid');
      expect(result.data).not.toHaveProperty('externalMatchId');
      expect(result.data).not.toHaveProperty('riotApiKey');
    }
  });

  it('parses a payload that omits includeIneligible and correlationId', () => {
    const result = MatchTimelineJobPayloadSchema.safeParse({ matchId: MATCH_ID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('includeIneligible');
      expect(result.data).not.toHaveProperty('correlationId');
      expect(result.data).not.toHaveProperty('puuid');
    }
  });

  it('rejects an invalid matchId UUID', () => {
    expect(() =>
      MatchTimelineJobPayloadSchema.parse({
        matchId: 'NA1_123456789',
      }),
    ).toThrow();
  });

  it('does not require puuid in the payload', () => {
    const result = MatchTimelineJobPayloadSchema.safeParse({ matchId: MATCH_ID });
    expect(result.success).toBe(true);
  });

  it('matches the ENRICH_MATCH_TIMELINE job name literal', () => {
    expect(MatchTimelineJobTypeSchema.parse(MATCH_TIMELINE_JOB_NAME)).toBe(
      'ENRICH_MATCH_TIMELINE',
    );
  });
});
