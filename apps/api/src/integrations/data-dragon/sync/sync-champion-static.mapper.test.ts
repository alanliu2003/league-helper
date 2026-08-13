import { describe, expect, it } from 'vitest';
import {
  mapDataDragonChampionEntry,
  normalizeMajorMinor,
  buildChampionIconUrl,
  buildChampionSplashUrl,
  buildPassiveIconUrl,
  buildSpellIconUrl,
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

  it('snapshots passive and Q/W/E/R from champion-detail fields', () => {
    const row = mapDataDragonChampionEntry({
      id: 'Ahri',
      key: '103',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage'],
      passive: {
        name: 'Essence Theft',
        description: 'Ahri heals when she hits champions.',
        image: { full: 'Ahri_SoulEater2.png' },
      },
      spells: [
        {
          name: 'Orb of Deception',
          description: 'Ahri sends out her orb.',
          cooldownBurn: '7',
          costBurn: '55/65/75/85/95',
          rangeBurn: '900',
          image: { full: 'AhriQ.png' },
        },
        {
          name: 'Fox-Fire',
          description: 'Ahri releases fox-fires.',
          cooldownBurn: '9',
          costBurn: '30',
          rangeBurn: '700',
          image: { full: 'AhriW.png' },
        },
        {
          name: 'Charm',
          description: 'Ahri blows a kiss.',
          cooldownBurn: '12',
          costBurn: '60',
          rangeBurn: '1000',
          image: { full: 'AhriE.png' },
        },
        {
          name: 'Spirit Rush',
          description: 'Ahri dashes forward.',
          cooldownBurn: '130/105/80',
          costBurn: '100',
          rangeBurn: '500',
          image: { full: 'AhriR.png' },
        },
      ],
    });
    expect(row.passive).toEqual({
      name: 'Essence Theft',
      description: 'Ahri heals when she hits champions.',
      imageFull: 'Ahri_SoulEater2.png',
    });
    expect(row.spells).toHaveLength(4);
    expect(row.spells[0]).toMatchObject({
      name: 'Orb of Deception',
      imageFull: 'AhriQ.png',
      cooldownBurn: '7',
    });
    expect(JSON.stringify(row.spells)).not.toContain('tooltip');
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
    expect(buildPassiveIconUrl('Ahri_SoulEater2.png', '16.10.1')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.10.1/img/passive/Ahri_SoulEater2.png',
    );
    expect(buildSpellIconUrl('AhriQ.png', '16.10.1')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.10.1/img/spell/AhriQ.png',
    );
    expect(buildSpellIconUrl('KSanteQ.png', '16.10.1')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.10.1/img/spell/KSanteQ.png',
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

  it('maps League Classic Jade_* entries without dropping them from sync', () => {
    const row = mapDataDragonChampionEntry({
      id: 'Jade_Ahri',
      key: '60103',
      name: 'Ahri',
      title: 'the Nine-Tailed Fox',
      tags: ['Mage', 'Assassin'],
    });
    expect(row.championKey).toBe('Jade_Ahri');
    expect(row.championId).toBe(60103);
  });
});
