import { describe, expect, it } from 'vitest';
import { PLAYER_METRIC_NEAR_BANDS, classifyMetricDirection } from './comparison';

describe('PLAYER_METRIC_NEAR_BANDS', () => {
  it('covers every PlayerPlaystyleMetricId including KDA', () => {
    expect(PLAYER_METRIC_NEAR_BANDS).toEqual({
      CS_PER_MIN: 0.4,
      GOLD_PER_MIN: 25,
      DAMAGE_PER_MIN: 40,
      VISION_PER_MIN: 0.12,
      KDA: 0.35,
      KILLS_PER_GAME: 0.6,
      DEATHS_PER_GAME: 0.4,
      ASSISTS_PER_GAME: 0.8,
      GOLD_DIFF_AT_10: 120,
      GOLD_DIFF_AT_15: 180,
      CS_DIFF_AT_10: 4,
      CS_DIFF_AT_15: 6,
    });
    expect(Object.keys(PLAYER_METRIC_NEAR_BANDS).sort()).toEqual(
      [
        'ASSISTS_PER_GAME',
        'CS_DIFF_AT_10',
        'CS_DIFF_AT_15',
        'CS_PER_MIN',
        'DAMAGE_PER_MIN',
        'DEATHS_PER_GAME',
        'GOLD_DIFF_AT_10',
        'GOLD_DIFF_AT_15',
        'GOLD_PER_MIN',
        'KDA',
        'KILLS_PER_GAME',
        'VISION_PER_MIN',
      ].sort(),
    );
  });
});

describe('classifyMetricDirection', () => {
  it('treats abs(delta) at or below the CS_PER_MIN threshold as NEAR_BASELINE', () => {
    expect(classifyMetricDirection('CS_PER_MIN', -0.39)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('CS_PER_MIN', -0.4)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('CS_PER_MIN', 0.4)).toBe('NEAR_BASELINE');
  });

  it('classifies CS_PER_MIN just outside the near-band as ABOVE or BELOW', () => {
    expect(classifyMetricDirection('CS_PER_MIN', -0.41)).toBe('BELOW_BASELINE');
    expect(classifyMetricDirection('CS_PER_MIN', 0.41)).toBe('ABOVE_BASELINE');
  });

  it('uses DAMAGE_PER_MIN and GOLD_PER_MIN thresholds inclusively', () => {
    expect(classifyMetricDirection('DAMAGE_PER_MIN', 40)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('DAMAGE_PER_MIN', 41)).toBe('ABOVE_BASELINE');
    expect(classifyMetricDirection('GOLD_PER_MIN', 25)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('GOLD_PER_MIN', 26)).toBe('ABOVE_BASELINE');
    expect(classifyMetricDirection('GOLD_PER_MIN', 0)).toBe('NEAR_BASELINE');
  });

  it('locks remaining near-band thresholds at equality and just above', () => {
    expect(classifyMetricDirection('VISION_PER_MIN', 0.12)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('KDA', 0.35)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('KDA', 0.36)).toBe('ABOVE_BASELINE');
    expect(classifyMetricDirection('KILLS_PER_GAME', 0.6)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('DEATHS_PER_GAME', 0.4)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('ASSISTS_PER_GAME', 0.8)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('GOLD_DIFF_AT_10', 120)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('GOLD_DIFF_AT_15', 180)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('CS_DIFF_AT_10', 4)).toBe('NEAR_BASELINE');
    expect(classifyMetricDirection('CS_DIFF_AT_15', 6)).toBe('NEAR_BASELINE');
  });

  it('never returns NOT_COMPARABLE for a numeric delta', () => {
    expect(classifyMetricDirection('GOLD_PER_MIN', 0)).not.toBe('NOT_COMPARABLE');
    expect(classifyMetricDirection('CS_PER_MIN', 0.41)).not.toBe('NOT_COMPARABLE');
    expect(classifyMetricDirection('CS_PER_MIN', -0.41)).not.toBe('NOT_COMPARABLE');
  });
});
