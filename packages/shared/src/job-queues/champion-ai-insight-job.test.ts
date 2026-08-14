import { describe, expect, it } from 'vitest';
import { CHAMPION_AI_INSIGHT_JOB_NAME } from './queue-names';
import {
  ChampionAiInsightJobPayloadSchema,
  ChampionAiInsightJobTypeSchema,
  buildChampionAiInsightBullMqJobId,
} from './champion-ai-insight-job';

const INSIGHT_ID = '11111111-1111-4111-8111-111111111111';
const FINGERPRINT_64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const FINGERPRINT_16 = '0123456789abcdef';

describe('champion AI insight job contract', () => {
  it('builds a deterministic BullMQ job id from the first 24 hex fingerprint chars', () => {
    const input = { contextFingerprint: FINGERPRINT_64 };
    const a = buildChampionAiInsightBullMqJobId(input);
    const b = buildChampionAiInsightBullMqJobId(input);

    expect(a).toBe(b);
    expect(a.startsWith('ai_champ_')).toBe(true);
    expect(a).toBe(`ai_champ_${FINGERPRINT_64.slice(0, 24)}`);
    expect(a.length).toBeLessThanOrEqual(128);
  });

  it('uses the available fingerprint prefix when shorter than 24 chars', () => {
    const id = buildChampionAiInsightBullMqJobId({ contextFingerprint: FINGERPRINT_16 });
    expect(id).toBe(`ai_champ_${FINGERPRINT_16}`);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('accepts a valid payload and strips unknown keys', () => {
    const result = ChampionAiInsightJobPayloadSchema.safeParse({
      insightId: INSIGHT_ID,
      contextFingerprint: FINGERPRINT_64,
      correlationId: 'corr-1',
      riotApiKey: 'secret',
      extra: 'drop-me',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insightId).toBe(INSIGHT_ID);
      expect(result.data.contextFingerprint).toBe(FINGERPRINT_64);
      expect(result.data.correlationId).toBe('corr-1');
      expect(result.data).not.toHaveProperty('riotApiKey');
      expect(result.data).not.toHaveProperty('extra');
    }
  });

  it('rejects an invalid insightId UUID', () => {
    expect(() =>
      ChampionAiInsightJobPayloadSchema.parse({
        insightId: 'not-a-uuid',
        contextFingerprint: FINGERPRINT_64,
      }),
    ).toThrow();
  });

  it('matches the GENERATE_CHAMPION_AI_INSIGHT job name literal', () => {
    expect(ChampionAiInsightJobTypeSchema.parse(CHAMPION_AI_INSIGHT_JOB_NAME)).toBe(
      'GENERATE_CHAMPION_AI_INSIGHT',
    );
  });
});
