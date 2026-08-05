import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS,
  classifySampleConfidence,
} from './sample-confidence';

describe('classifySampleConfidence', () => {
  it('uses default thresholds 30 / 100 / 500', () => {
    expect(DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS).toEqual({
      insufficientBelow: 30,
      lowBelow: 100,
      mediumBelow: 500,
    });
  });

  it('classifies 0–29 as INSUFFICIENT', () => {
    expect(classifySampleConfidence(0)).toBe('INSUFFICIENT');
    expect(classifySampleConfidence(29)).toBe('INSUFFICIENT');
  });

  it('classifies 30–99 as LOW', () => {
    expect(classifySampleConfidence(30)).toBe('LOW');
    expect(classifySampleConfidence(99)).toBe('LOW');
  });

  it('classifies 100–499 as MEDIUM', () => {
    expect(classifySampleConfidence(100)).toBe('MEDIUM');
    expect(classifySampleConfidence(499)).toBe('MEDIUM');
  });

  it('classifies ≥500 as HIGH', () => {
    expect(classifySampleConfidence(500)).toBe('HIGH');
    expect(classifySampleConfidence(10_000)).toBe('HIGH');
  });
});
