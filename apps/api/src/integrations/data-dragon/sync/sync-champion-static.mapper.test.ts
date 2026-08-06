import { describe, expect, it } from 'vitest';
import {
  mapDataDragonChampionEntry,
  normalizeMajorMinor,
  buildChampionIconUrl,
  buildChampionSplashUrl,
} from './sync-champion-static.mapper';
import { parseChampionStaticFile } from './sync-champion-static.types';

describe('sync-champion-static.mapper', () => {
  it('maps championKey from Data Dragon id and championId from numeric key', () => {
    const row = mapDataDragonChampionEntry({
      id: 'DrMundo',
      key: '36',
      name: 'Dr. Mundo',
      title: 'the Madman of Zaun',
      tags: ['Fighter', 'Tank'],
      image: { full: 'DrMundo.png' },
      stats: { hp: 600 },
    });
    expect(row.championKey).toBe('DrMundo');
    expect(row.championId).toBe(36);
    expect(row.name).toBe('Dr. Mundo');
    expect(row.title).toBe('the Madman of Zaun');
    expect(row.tags).toEqual(['Fighter', 'Tank']);
    expect(row.imageData).toEqual({ full: 'DrMundo.png' });
    expect(row.baseStats).toEqual({ hp: 600 });
    expect(row.passive).toEqual({});
    expect(row.spells).toEqual([]);
  });

  it('rejects non-numeric key instead of inferring', () => {
    expect(() =>
      mapDataDragonChampionEntry({
        id: 'Ahri',
        key: 'Ahri',
        name: 'Ahri',
        title: 'the Nine-Tailed Fox',
        tags: ['Mage'],
      }),
    ).toThrow(/numeric/i);
  });

  it('builds icon and splash URLs from championKey', () => {
    expect(buildChampionIconUrl('MissFortune', '16.10.1')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.10.1/img/champion/MissFortune.png',
    );
    expect(buildChampionSplashUrl('MissFortune')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/MissFortune_0.jpg',
    );
  });

  it('normalizes major.minor from Data Dragon version', () => {
    expect(normalizeMajorMinor('16.10.1')).toBe('16.10');
    expect(normalizeMajorMinor('14.1.1')).toBe('14.1');
  });

  it('parses champion.json payload', () => {
    const file = parseChampionStaticFile({
      version: '16.10.1',
      data: {
        Ahri: {
          id: 'Ahri',
          key: '103',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage', 'Assassin'],
          image: { full: 'Ahri.png' },
          stats: {},
        },
      },
    });
    expect(file.version).toBe('16.10.1');
    expect(Object.keys(file.data)).toEqual(['Ahri']);
  });
});
