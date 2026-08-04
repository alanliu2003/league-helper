import { describe, expect, it } from 'vitest';
import { hasRankSnapshotChanged } from './rank-snapshot.utils';

describe('hasRankSnapshotChanged', () => {
  const base = {
    queueType: 'RANKED_SOLO_5x5',
    tier: 'GOLD',
    division: 'II',
    leaguePoints: 50,
    wins: 10,
    losses: 8,
    veteran: false,
    inactive: false,
    freshBlood: false,
    hotStreak: false,
  };

  it('treats a missing previous snapshot as a change', () => {
    expect(hasRankSnapshotChanged(null, base)).toBe(true);
  });

  it('returns false when values are unchanged', () => {
    expect(hasRankSnapshotChanged(base, { ...base })).toBe(false);
  });

  it('returns true when LP or division changes', () => {
    expect(hasRankSnapshotChanged(base, { ...base, leaguePoints: 51 })).toBe(true);
    expect(hasRankSnapshotChanged(base, { ...base, division: 'I' })).toBe(true);
  });
});
