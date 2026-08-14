import { describe, expect, it } from 'vitest';
import {
  PLAYER_PLAYSTYLE_CREDIBLE_MIN,
  PLAYER_PLAYSTYLE_EXPLORATORY_MIN,
  PLAYER_PLAYSTYLE_STRONG_MIN,
  classifyPlayerPlaystyleSampleBand,
} from './sample-policy';

describe('player playstyle sample-policy constants', () => {
  it('uses 5 / 10 / 20 floors, not the ranking floor of 30', () => {
    expect(PLAYER_PLAYSTYLE_EXPLORATORY_MIN).toBe(5);
    expect(PLAYER_PLAYSTYLE_CREDIBLE_MIN).toBe(10);
    expect(PLAYER_PLAYSTYLE_STRONG_MIN).toBe(20);
  });
});

describe('classifyPlayerPlaystyleSampleBand', () => {
  it('classifies 0–4 as INSUFFICIENT', () => {
    expect(classifyPlayerPlaystyleSampleBand(0)).toBe('INSUFFICIENT');
    expect(classifyPlayerPlaystyleSampleBand(4)).toBe('INSUFFICIENT');
  });

  it('classifies 5–9 as EXPLORATORY', () => {
    expect(classifyPlayerPlaystyleSampleBand(5)).toBe('EXPLORATORY');
    expect(classifyPlayerPlaystyleSampleBand(9)).toBe('EXPLORATORY');
  });

  it('classifies 10–19 as CREDIBLE', () => {
    expect(classifyPlayerPlaystyleSampleBand(10)).toBe('CREDIBLE');
    expect(classifyPlayerPlaystyleSampleBand(19)).toBe('CREDIBLE');
  });

  it('classifies ≥20 as STRONG', () => {
    expect(classifyPlayerPlaystyleSampleBand(20)).toBe('STRONG');
  });
});
