import { describe, expect, it, vi } from 'vitest';
import {
  identityFromItem,
  identityFromRune,
  identityFromSpell,
  identityFromStyle,
  loadMatchStaticLookups,
  type MatchStaticLookups,
} from './match-detail-static';

const icons = {
  itemIcon: (id: number, version: string) => `https://cdn.test/item/${version}/${id}.png`,
  runeIcon: (path: string) => `https://cdn.test/${path}`,
  spellIcon: (imageFull: string, version: string) => `https://cdn.test/spell/${version}/${imageFull}`,
};

function lookups(overrides: Partial<MatchStaticLookups> = {}): MatchStaticLookups {
  return {
    dataDragonVersion: '14.11.1',
    items: new Map([[3031, { name: 'Infinity Edge' }]]),
    runes: new Map([
      [
        8005,
        {
          name: 'Press the Attack',
          icon: 'perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
          treeId: 8000,
          treeName: 'Precision',
        },
      ],
    ]),
    spells: new Map([[4, { name: 'Flash', imageFull: 'SummonerFlash.png' }]]),
    styleNames: new Map([[8000, 'Precision']]),
    ...overrides,
  };
}

describe('loadMatchStaticLookups', () => {
  it('loads items for the match patch', async () => {
    const prisma = {
      patch: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patch-14-11',
          normalizedMajorMinor: '14.11',
          dataDragonVersion: '14.11.1',
        }),
      },
      itemStaticData: {
        findMany: vi.fn().mockResolvedValue([{ itemId: 3031, name: 'Infinity Edge' }]),
      },
      runeStaticData: { findMany: vi.fn().mockResolvedValue([]) },
      summonerSpellStaticData: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const staticRepo = { resolveStaticPatch: vi.fn() };

    const result = await loadMatchStaticLookups(prisma as never, staticRepo as never, '14.11');

    expect(prisma.patch.findFirst).toHaveBeenCalledWith({
      where: { normalizedMajorMinor: '14.11' },
      orderBy: { version: 'desc' },
    });
    expect(staticRepo.resolveStaticPatch).not.toHaveBeenCalled();
    expect(result.items.get(3031)?.name).toBe('Infinity Edge');
    expect(result.dataDragonVersion).toBe('14.11.1');
  });

  it('falls back to the latest static patch when the match patch is missing', async () => {
    const prisma = {
      patch: { findFirst: vi.fn().mockResolvedValue(null) },
      itemStaticData: { findMany: vi.fn().mockResolvedValue([]) },
      runeStaticData: { findMany: vi.fn().mockResolvedValue([]) },
      summonerSpellStaticData: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const staticRepo = {
      resolveStaticPatch: vi.fn().mockResolvedValue({
        id: 'latest',
        dataDragonVersion: '14.12.1',
      }),
    };

    const result = await loadMatchStaticLookups(prisma as never, staticRepo as never, '14.11');

    expect(staticRepo.resolveStaticPatch).toHaveBeenCalledTimes(1);
    expect(result.dataDragonVersion).toBe('14.12.1');
  });
});

describe('identity builders', () => {
  it('returns empty item identity for slot 0', () => {
    expect(identityFromItem(0, lookups(), icons)).toEqual({ name: null, iconUrl: null });
  });

  it('resolves item name and icon', () => {
    expect(identityFromItem(3031, lookups(), icons)).toEqual({
      name: 'Infinity Edge',
      iconUrl: 'https://cdn.test/item/14.11.1/3031.png',
    });
  });

  it('falls back to Item {id} when the static row is missing', () => {
    expect(identityFromItem(9999, lookups(), icons).name).toBe('Item 9999');
  });

  it('resolves rune identity from perk id', () => {
    expect(identityFromRune(8005, lookups(), icons)).toEqual({
      id: 8005,
      name: 'Press the Attack',
      iconUrl: 'https://cdn.test/perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
    });
  });

  it('returns null rune identity for missing ids', () => {
    expect(identityFromRune(0, lookups(), icons)).toBeNull();
  });

  it('resolves style identity from tree name and a rune icon in that tree', () => {
    expect(identityFromStyle(8000, lookups(), icons)).toEqual({
      id: 8000,
      name: 'Precision',
      iconUrl: 'https://cdn.test/perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png',
    });
  });

  it('resolves spell identity', () => {
    expect(identityFromSpell(4, lookups(), icons)).toEqual({
      id: 4,
      name: 'Flash',
      iconUrl: 'https://cdn.test/spell/14.11.1/SummonerFlash.png',
    });
  });

  it('returns null spell identity for id 0', () => {
    expect(identityFromSpell(0, lookups(), icons)).toBeNull();
  });
});
