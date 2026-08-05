import { describe, expect, it } from 'vitest';
import { MatchAnalyticsValidationError } from '../errors';
import {
  assertExactChampionDimensions,
  assertMaterializedChampionDimensions,
  type ExactChampionDimensions,
} from './aggregate-dimensions';

const baseExact: ExactChampionDimensions = {
  patch: '16.15',
  platformRoute: 'na1',
  regionalRoute: 'americas',
  queueId: 420,
  rankTier: 'GOLD',
  position: 'MIDDLE',
  championId: 103,
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
};

describe('assertExactChampionDimensions', () => {
  it('accepts valid exact dimensions', () => {
    expect(() => assertExactChampionDimensions(baseExact)).not.toThrow();
  });

  it('accepts UNKNOWN tier and UNKNOWN position', () => {
    expect(() =>
      assertExactChampionDimensions({
        ...baseExact,
        rankTier: 'UNKNOWN',
        position: 'UNKNOWN',
      }),
    ).not.toThrow();
  });

  it('rejects ALL in exact dims', () => {
    expect(() =>
      assertExactChampionDimensions({ ...baseExact, rankTier: 'ALL' as never }),
    ).toThrow(MatchAnalyticsValidationError);
  });

  it('rejects every ALL sentinel in exact dimensions', () => {
    expect(() =>
      assertExactChampionDimensions({ ...baseExact, rankTier: 'ALL' as never }),
    ).toThrow(/ALL/i);
    expect(() =>
      assertExactChampionDimensions({ ...baseExact, position: 'ALL' as never }),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      assertExactChampionDimensions({ ...baseExact, platformRoute: '' }),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      assertExactChampionDimensions({ ...baseExact, regionalRoute: '' }),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      assertExactChampionDimensions({ ...baseExact, queueId: -1 }),
    ).toThrow(MatchAnalyticsValidationError);
  });

  it('rejects raw Riot positions', () => {
    for (const position of ['UTILITY', 'SOLO', 'DUO', 'DUO_CARRY', 'DUO_SUPPORT'] as const) {
      expect(() =>
        assertExactChampionDimensions({ ...baseExact, position: position as never }),
      ).toThrow(MatchAnalyticsValidationError);
    }
  });
});

describe('assertMaterializedChampionDimensions', () => {
  it('accepts approved ALL tier or ALL position', () => {
    expect(() =>
      assertMaterializedChampionDimensions({ ...baseExact, rankTier: 'ALL' }),
    ).not.toThrow();
    expect(() =>
      assertMaterializedChampionDimensions({ ...baseExact, position: 'ALL' }),
    ).not.toThrow();
  });

  it('rejects ALL platform/region/queue even on materialized dims', () => {
    expect(() =>
      assertMaterializedChampionDimensions({ ...baseExact, platformRoute: '' }),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      assertMaterializedChampionDimensions({ ...baseExact, regionalRoute: '' }),
    ).toThrow(MatchAnalyticsValidationError);
    expect(() =>
      assertMaterializedChampionDimensions({ ...baseExact, queueId: -1 }),
    ).toThrow(MatchAnalyticsValidationError);
  });

  it('rejects raw Riot positions on materialized dims', () => {
    expect(() =>
      assertMaterializedChampionDimensions({ ...baseExact, position: 'UTILITY' as never }),
    ).toThrow(MatchAnalyticsValidationError);
  });
});
