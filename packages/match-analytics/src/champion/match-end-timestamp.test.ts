import { describe, expect, it } from 'vitest';
import { resolveMatchEndedAt } from './match-end-timestamp';

describe('resolveMatchEndedAt', () => {
  it('prefers a valid game-end timestamp', () => {
    const end = Date.parse('2026-08-01T12:30:00.000Z');
    const creation = Date.parse('2026-08-01T12:00:00.000Z');
    expect(resolveMatchEndedAt(end, creation, 1800)).toEqual(new Date(end));
  });

  it('falls back to creation + strictly positive finite duration', () => {
    const creation = Date.parse('2026-08-01T12:00:00.000Z');
    expect(resolveMatchEndedAt(null, creation, 90)).toEqual(new Date(creation + 90_000));
    expect(resolveMatchEndedAt(undefined, creation, 90)).toEqual(new Date(creation + 90_000));
  });

  it('returns null for invalid, zero, negative, NaN, or infinite end timestamps', () => {
    const creation = Date.parse('2026-08-01T12:00:00.000Z');
    expect(resolveMatchEndedAt(Number.NaN, creation, 90)).toEqual(new Date(creation + 90_000));
    expect(resolveMatchEndedAt(Number.POSITIVE_INFINITY, creation, 90)).toEqual(
      new Date(creation + 90_000),
    );
    expect(resolveMatchEndedAt(Number.NEGATIVE_INFINITY, creation, 90)).toEqual(
      new Date(creation + 90_000),
    );
    expect(resolveMatchEndedAt(0, creation, 90)).toEqual(new Date(creation + 90_000));
    expect(resolveMatchEndedAt(-1, creation, 90)).toEqual(new Date(creation + 90_000));
  });

  it('returns null when fallback duration is not strictly positive and finite', () => {
    const creation = Date.parse('2026-08-01T12:00:00.000Z');
    expect(resolveMatchEndedAt(null, creation, 0)).toBeNull();
    expect(resolveMatchEndedAt(null, creation, -1)).toBeNull();
    expect(resolveMatchEndedAt(null, creation, Number.NaN)).toBeNull();
    expect(resolveMatchEndedAt(null, creation, Number.POSITIVE_INFINITY)).toBeNull();
    expect(resolveMatchEndedAt(null, creation, Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('returns null when creation is invalid and end is missing', () => {
    expect(resolveMatchEndedAt(null, null, 90)).toBeNull();
    expect(resolveMatchEndedAt(null, Number.NaN, 90)).toBeNull();
    expect(resolveMatchEndedAt(null, Number.POSITIVE_INFINITY, 90)).toBeNull();
    expect(resolveMatchEndedAt(null, 0, 90)).toBeNull();
    expect(resolveMatchEndedAt(null, -5, 90)).toBeNull();
  });

  it('accepts Date inputs', () => {
    const end = new Date('2026-08-01T12:30:00.000Z');
    const creation = new Date('2026-08-01T12:00:00.000Z');
    expect(resolveMatchEndedAt(end, creation, 0)).toEqual(end);
  });
});
