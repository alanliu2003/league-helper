import { describe, expect, it } from 'vitest';
import {
  ChampionAggregationJobPayloadSchema,
  buildChampionAggregationBullMqJobId,
} from './champion-aggregation-job';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

describe('champion aggregation job contract', () => {
  it('builds a deterministic BullMQ job id with agg_champ_ prefix', () => {
    const input = {
      matchId: MATCH_ID,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    };

    const a = buildChampionAggregationBullMqJobId(input);
    const b = buildChampionAggregationBullMqJobId(input);

    expect(a).toBe(b);
    expect(a.startsWith('agg_champ_')).toBe(true);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).toContain(MATCH_ID);
  });

  it('isolates job ids when aggregation or normalization versions differ', () => {
    const base = {
      matchId: MATCH_ID,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
    };

    const byAgg = buildChampionAggregationBullMqJobId({
      ...base,
      aggregationVersion: '2',
    });
    const byNorm = buildChampionAggregationBullMqJobId({
      ...base,
      sourceNormalizationVersion: '2',
    });

    expect(byAgg).not.toBe(buildChampionAggregationBullMqJobId(base));
    expect(byNorm).not.toBe(buildChampionAggregationBullMqJobId(base));
    expect(byAgg).not.toBe(byNorm);
  });

  it('requires a valid UUID matchId', () => {
    expect(() =>
      buildChampionAggregationBullMqJobId({
        matchId: 'not-a-uuid',
        sourceNormalizationVersion: '1',
        aggregationVersion: '1',
      }),
    ).toThrow();
  });

  it('handles unsafe version characters while remaining deterministic and bounded', () => {
    const input = {
      matchId: MATCH_ID,
      sourceNormalizationVersion: 'v1:beta/raw*',
      aggregationVersion: 'agg@2 with spaces',
    };

    const a = buildChampionAggregationBullMqJobId(input);
    const b = buildChampionAggregationBullMqJobId(input);

    expect(a).toBe(b);
    expect(a.startsWith('agg_champ_')).toBe(true);
    expect(a).toContain(MATCH_ID);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).toMatch(/^agg_champ_[a-zA-Z0-9_-]+$/);
  });

  it('keeps job ids within 128 chars for long version strings', () => {
    const input = {
      matchId: MATCH_ID,
      sourceNormalizationVersion: 'n'.repeat(200),
      aggregationVersion: 'a'.repeat(200),
    };

    const id = buildChampionAggregationBullMqJobId(input);
    expect(id.length).toBeLessThanOrEqual(128);
    expect(id.startsWith('agg_champ_')).toBe(true);
    expect(id).toContain(MATCH_ID);
  });

  it('accepts a valid payload and strips unknown secret-like keys', () => {
    const result = ChampionAggregationJobPayloadSchema.safeParse({
      matchId: MATCH_ID,
      sourceNormalizationVersion: '1',
      aggregationVersion: '1',
      correlationId: 'corr-1',
      riotApiKey: 'secret',
      puuid: 'should-not-appear',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('riotApiKey');
      expect(result.data).not.toHaveProperty('puuid');
      expect(result.data.correlationId).toBe('corr-1');
    }
  });

  it('rejects empty version strings', () => {
    expect(() =>
      ChampionAggregationJobPayloadSchema.parse({
        matchId: MATCH_ID,
        sourceNormalizationVersion: '',
        aggregationVersion: '1',
      }),
    ).toThrow();
  });
});
