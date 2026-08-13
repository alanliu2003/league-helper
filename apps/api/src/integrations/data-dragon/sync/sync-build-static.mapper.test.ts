import { describe, expect, it } from 'vitest';
import {
  mapDataDragonItemEntry,
  mapDataDragonRuneTrees,
  mapDataDragonSummonerSpellEntry,
} from './sync-build-static.mapper';

describe('mapDataDragonItemEntry', () => {
  it('maps gold, tags, from/into ids, and consumed', () => {
    const row = mapDataDragonItemEntry('3031', {
      name: 'Infinity Edge',
      description: 'desc',
      plaintext: 'plain',
      gold: { base: 625, purchasable: true, total: 3600, sell: 2520 },
      tags: ['Damage', 'CriticalStrike'],
      stats: { FlatCritChanceMod: 0.25 },
      image: { full: '3031.png' },
      from: ['1038', '1037'],
      into: ['7031'],
      consumed: false,
    });
    expect(row).toMatchObject({
      itemId: 3031,
      name: 'Infinity Edge',
      purchasable: true,
      fromItemIds: [1038, 1037],
      intoItemIds: [7031],
      consumed: false,
    });
  });
});

describe('mapDataDragonRuneTrees', () => {
  it('flattens trees into rune rows with slot index', () => {
    const rows = mapDataDragonRuneTrees([
      {
        id: 8100,
        key: 'Domination',
        icon: 'perk-images/Styles/7200_Domination.png',
        name: 'Domination',
        slots: [
          {
            runes: [
              {
                id: 8112,
                key: 'Electrocute',
                icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
                name: 'Electrocute',
                shortDesc: 'short',
                longDesc: 'long',
              },
            ],
          },
        ],
      },
    ]);
    expect(rows).toEqual([
      {
        runeId: 8112,
        runeKey: 'Electrocute',
        name: 'Electrocute',
        shortDescription: 'short',
        longDescription: 'long',
        icon: 'perk-images/Styles/Domination/Electrocute/Electrocute.png',
        treeId: 8100,
        treeName: 'Domination',
        slotIndex: 0,
      },
    ]);
  });
});

describe('mapDataDragonSummonerSpellEntry', () => {
  it('maps numeric spell key and image', () => {
    const row = mapDataDragonSummonerSpellEntry('SummonerFlash', {
      key: '4',
      name: 'Flash',
      description: 'Teleport a short distance.',
      image: { full: 'SummonerFlash.png' },
    });
    expect(row).toEqual({
      spellId: 4,
      spellKey: 'SummonerFlash',
      name: 'Flash',
      description: 'Teleport a short distance.',
      imageData: { full: 'SummonerFlash.png' },
    });
  });
});
