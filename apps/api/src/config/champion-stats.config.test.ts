import { afterEach, describe, expect, it } from 'vitest';
import { ValidationFailureError } from '@league-helper/shared';
import { loadChampionStatsConfig } from './champion-stats.config';

describe('loadChampionStatsConfig', () => {
  afterEach(() => {
    // loader receives explicit env objects; no process mutation needed
  });

  it('rejects invalid default platform', () => {
    expect(() => loadChampionStatsConfig({ CHAMPION_STATS_DEFAULT_PLATFORM: 'nope' })).toThrow(
      ValidationFailureError,
    );
  });

  it('requires a valid default platform', () => {
    expect(() => loadChampionStatsConfig({})).toThrow(ValidationFailureError);
  });

  it('loads defaults aligned with worker sourceNormalizationVersion env', () => {
    const config = loadChampionStatsConfig({
      CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
    });
    expect(config.defaultPlatform).toBe('na1');
    expect(config.sourceNormalizationVersion).toBe('1');
    expect(config.aggregationVersion).toBe('1');
    expect(config.minimumSample).toBe(30);
    expect(config.confidenceLevel).toBe(0.95);
    expect(config.defaultQueueId).toBe(420);
    expect(config.cacheTtlSeconds).toBe(60);
    expect(config.buildAggregationVersion).toBe('1');
    expect(config.matchupAggregationVersion).toBe('1');
    expect(config.matchupDisplayFloor).toBe(10);
  });

  it('reads CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION (not MATCH_NORMALIZATION_VERSION)', () => {
    const config = loadChampionStatsConfig({
      CHAMPION_STATS_DEFAULT_PLATFORM: 'euw1',
      CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION: '2',
      MATCH_NORMALIZATION_VERSION: '99',
      CHAMPION_AGGREGATION_VERSION: '3',
      CHAMPION_AGGREGATION_MIN_SAMPLE: '40',
      CHAMPION_AGGREGATION_CONFIDENCE_LEVEL: '0.90',
      CHAMPION_AGGREGATION_DEFAULT_QUEUE_ID: '440',
      CHAMPION_STATS_CACHE_TTL_SECONDS: '120',
      CHAMPION_BUILD_AGGREGATION_VERSION: '2',
      CHAMPION_MATCHUP_AGGREGATION_VERSION: '3',
      CHAMPION_MATCHUP_DISPLAY_FLOOR: '10',
    });
    expect(config.sourceNormalizationVersion).toBe('2');
    expect(config.aggregationVersion).toBe('3');
    expect(config.minimumSample).toBe(40);
    expect(config.confidenceLevel).toBe(0.9);
    expect(config.defaultQueueId).toBe(440);
    expect(config.cacheTtlSeconds).toBe(120);
    expect(config.buildAggregationVersion).toBe('2');
    expect(config.matchupAggregationVersion).toBe('3');
    expect(config.matchupDisplayFloor).toBe(10);
  });

  it('rejects confidence outside (0,1)', () => {
    expect(() =>
      loadChampionStatsConfig({
        CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
        CHAMPION_AGGREGATION_CONFIDENCE_LEVEL: '1',
      }),
    ).toThrow(ValidationFailureError);
    expect(() =>
      loadChampionStatsConfig({
        CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
        CHAMPION_AGGREGATION_CONFIDENCE_LEVEL: '0',
      }),
    ).toThrow(ValidationFailureError);
  });

  it('rejects invalid minimum sample', () => {
    expect(() =>
      loadChampionStatsConfig({
        CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
        CHAMPION_AGGREGATION_MIN_SAMPLE: '0',
      }),
    ).toThrow(ValidationFailureError);
  });

  it('rejects invalid cache TTL', () => {
    expect(() =>
      loadChampionStatsConfig({
        CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
        CHAMPION_STATS_CACHE_TTL_SECONDS: '0',
      }),
    ).toThrow(ValidationFailureError);
  });

  it('rejects empty aggregation version strings', () => {
    expect(() =>
      loadChampionStatsConfig({
        CHAMPION_STATS_DEFAULT_PLATFORM: 'na1',
        CHAMPION_AGGREGATION_VERSION: '   ',
      }),
    ).toThrow(ValidationFailureError);
  });
});
