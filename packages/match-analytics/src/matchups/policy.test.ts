import { describe, expect, it } from 'vitest';
import {
  MATCHUP_DISPLAY_FLOOR,
  MATCHUP_SAMPLE_CONFIDENCE_THRESHOLDS,
} from './policy';
import { classifySampleConfidence } from '../statistics/sample-confidence';

describe('matchup sample policy', () => {
  it('does not reuse the champion ranking floor of 30 as the hide threshold', () => {
    expect(MATCHUP_DISPLAY_FLOOR).toBe(10);
    expect(MATCHUP_DISPLAY_FLOOR).toBeLessThan(30);
  });

  it('classifies 10–19 as LOW (limited), 20–29 as MEDIUM, 30+ as HIGH', () => {
    const t = MATCHUP_SAMPLE_CONFIDENCE_THRESHOLDS;
    expect(classifySampleConfidence(9, t)).toBe('INSUFFICIENT');
    expect(classifySampleConfidence(10, t)).toBe('LOW');
    expect(classifySampleConfidence(19, t)).toBe('LOW');
    expect(classifySampleConfidence(20, t)).toBe('MEDIUM');
    expect(classifySampleConfidence(29, t)).toBe('MEDIUM');
    expect(classifySampleConfidence(30, t)).toBe('HIGH');
  });
});
