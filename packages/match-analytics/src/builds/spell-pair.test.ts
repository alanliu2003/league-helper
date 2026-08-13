import { describe, expect, it } from 'vitest';
import { canonicalizeSummonerSpellPair } from './spell-pair';

describe('canonicalizeSummonerSpellPair', () => {
  it('orders Flash + Teleport the same as Teleport + Flash', () => {
    expect(canonicalizeSummonerSpellPair(4, 12)).toEqual({
      spell1Id: 4,
      spell2Id: 12,
      signature: '4-12',
    });
    expect(canonicalizeSummonerSpellPair(12, 4)).toEqual({
      spell1Id: 4,
      spell2Id: 12,
      signature: '4-12',
    });
  });

  it('keeps identical spell ids', () => {
    expect(canonicalizeSummonerSpellPair(4, 4).signature).toBe('4-4');
  });
});
