import { describe, expect, it } from 'vitest';
import { rankStrongAndWeakMatchups } from './ranking';
import { MATCHUP_DISPLAY_FLOOR } from './policy';
import { wilsonScoreInterval } from '../statistics/wilson-interval';

describe('rankStrongAndWeakMatchups', () => {
  it('does not rank a 1–0 100% row above a large sample that clears the floor', () => {
    const ranked = rankStrongAndWeakMatchups(
      [
        {
          opponentChampionId: 1,
          position: 'MIDDLE',
          sampleSize: 1,
          wins: 1,
          winRate: 1,
        },
        {
          opponentChampionId: 2,
          position: 'MIDDLE',
          sampleSize: 55,
          wins: 35,
          winRate: 35 / 55,
        },
      ],
      { confidenceLevel: 0.95 },
    );
    expect(ranked.strongAgainst.map((row) => row.opponentChampionId)).toEqual([2]);
    expect(ranked.weakAgainst).toEqual([]);
    expect(ranked.displayFloor).toBe(MATCHUP_DISPLAY_FLOOR);
  });

  it('places a losing subject win rate on Weak Against, not Strong Against', () => {
    const ranked = rankStrongAndWeakMatchups(
      [
        {
          opponentChampionId: 134,
          position: 'MIDDLE',
          sampleSize: 10,
          wins: 4,
          winRate: 0.4,
        },
      ],
      { confidenceLevel: 0.95 },
    );
    expect(ranked.weakAgainst.map((row) => row.opponentChampionId)).toEqual([134]);
    expect(ranked.strongAgainst).toEqual([]);
  });

  it('places a winning subject win rate on Strong Against', () => {
    const ranked = rankStrongAndWeakMatchups(
      [
        {
          opponentChampionId: 18,
          position: 'BOTTOM',
          sampleSize: 10,
          wins: 7,
          winRate: 0.7,
        },
      ],
      { confidenceLevel: 0.95 },
    );
    expect(ranked.strongAgainst.map((row) => row.opponentChampionId)).toEqual([18]);
    expect(ranked.weakAgainst).toEqual([]);
  });

  it('excludes exactly 50% rows from both lists', () => {
    const ranked = rankStrongAndWeakMatchups(
      [
        {
          opponentChampionId: 202,
          position: 'BOTTOM',
          sampleSize: 10,
          wins: 5,
          winRate: 0.5,
        },
      ],
      { confidenceLevel: 0.95 },
    );
    expect(ranked.strongAgainst).toEqual([]);
    expect(ranked.weakAgainst).toEqual([]);
    expect(ranked.eligibleCount).toBe(1);
  });

  it('ranks by Wilson lower bound among eligible rows, not raw winRate alone', () => {
    const tenOh = wilsonScoreInterval(10, 10, 0.95)!.lowerBound;
    const thirtyTwenty = wilsonScoreInterval(20, 50, 0.95)!.lowerBound;
    expect(tenOh).toBeGreaterThan(0);
    expect(thirtyTwenty).toBeGreaterThan(0);

    const ranked = rankStrongAndWeakMatchups(
      [
        {
          opponentChampionId: 10,
          position: 'MIDDLE',
          sampleSize: 10,
          wins: 10,
          winRate: 1,
        },
        {
          opponentChampionId: 50,
          position: 'MIDDLE',
          sampleSize: 50,
          wins: 32,
          winRate: 32 / 50,
        },
      ],
      { confidenceLevel: 0.95 },
    );
    const order = ranked.strongAgainst.map((row) => row.opponentChampionId);
    const lower10 = wilsonScoreInterval(10, 10, 0.95)!.lowerBound;
    const lower50 = wilsonScoreInterval(32, 50, 0.95)!.lowerBound;
    if (lower10 >= lower50) {
      expect(order[0]).toBe(10);
    } else {
      expect(order[0]).toBe(50);
    }
  });
});
