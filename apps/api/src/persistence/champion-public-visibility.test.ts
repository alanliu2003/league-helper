import { describe, expect, it } from 'vitest';
import {
  CLASSIC_CHAMPION_ID_MIN,
  isPublicChampionEntry,
  publicChampionStaticWhere,
} from './champion-public-visibility';

describe('isPublicChampionEntry', () => {
  it('allows normal playable champions', () => {
    expect(isPublicChampionEntry({ championKey: 'Ahri', championId: 103 })).toBe(true);
    expect(isPublicChampionEntry({ championKey: 'DrMundo', championId: 36 })).toBe(true);
    expect(isPublicChampionEntry({ championKey: 'MonkeyKing', championId: 62 })).toBe(true);
    expect(isPublicChampionEntry({ championKey: 'Locke', championId: 805 })).toBe(true);
    expect(isPublicChampionEntry({ championKey: 'Zaahen', championId: 904 })).toBe(true);
  });

  it('hides League Classic Jade_* entries', () => {
    expect(isPublicChampionEntry({ championKey: 'Jade_Ahri', championId: 60103 })).toBe(false);
    expect(isPublicChampionEntry({ championKey: 'Jade_Annie', championId: 60001 })).toBe(false);
  });

  it('hides classic-offset champion IDs even without Jade_ prefix', () => {
    expect(
      isPublicChampionEntry({ championKey: 'MysteryClassic', championId: CLASSIC_CHAMPION_ID_MIN }),
    ).toBe(false);
    expect(isPublicChampionEntry({ championKey: 'MysteryClassic', championId: 60_103 })).toBe(
      false,
    );
  });

  it('hides underscore asset keys even below classic ID offset', () => {
    expect(isPublicChampionEntry({ championKey: 'Foo_Bar', championId: 1 })).toBe(false);
  });

  it('rejects invalid identities', () => {
    expect(isPublicChampionEntry({ championKey: '', championId: 103 })).toBe(false);
    expect(isPublicChampionEntry({ championKey: 'Ahri', championId: 1.5 })).toBe(false);
    expect(isPublicChampionEntry({ championKey: 'Ahri', championId: -1 })).toBe(false);
  });
});

describe('publicChampionStaticWhere', () => {
  it('excludes classic ID range in SQL without LIKE underscore wildcards', () => {
    expect(publicChampionStaticWhere()).toEqual({
      championId: { lt: CLASSIC_CHAMPION_ID_MIN },
    });
  });
});
