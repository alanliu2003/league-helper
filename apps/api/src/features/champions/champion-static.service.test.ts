import { describe, expect, it, vi } from 'vitest';
import { ChampionNotFoundError } from '@league-helper/shared';
import { ChampionStaticService } from './champion-static.service';

function createService(
  overrides: {
    row?: {
      championId: number;
      championKey: string;
      name: string;
      title: string;
      tags: string[];
      patchVersion: string;
      dataDragonVersion: string | null;
      passive?: unknown;
      spells?: unknown;
    } | null;
    listRows?: Array<{
      championId: number;
      championKey: string;
      name: string;
      title: string;
      tags: string[];
      patchVersion: string;
      dataDragonVersion: string | null;
    }>;
  } = {},
) {
  const row =
    overrides.row === undefined
      ? {
          championId: 103,
          championKey: 'Ahri',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage'],
          patchVersion: '14.1.1.seed',
          dataDragonVersion: '14.1.1',
        }
      : overrides.row;

  const champions = {
    listChampions: vi.fn(async () => ({
      rows: overrides.listRows ?? (row ? [row] : []),
      totalCount: overrides.listRows?.length ?? (row ? 1 : 0),
      patch: row
        ? {
            version: row.patchVersion,
            dataDragonVersion: row.dataDragonVersion,
          }
        : null,
    })),
    findByChampionKey: vi.fn(async () => row),
  };

  const media = {
    buildChampionIconUrl: vi.fn(
      (key: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`,
    ),
    buildChampionSplashUrl: vi.fn(
      (key: string) => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_0.jpg`,
    ),
    buildPassiveIconUrl: vi.fn(
      (imageFull: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${imageFull}`,
    ),
    buildSpellIconUrl: vi.fn(
      (imageFull: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${imageFull}`,
    ),
  };

  return {
    service: new ChampionStaticService(champions as never, media as never),
    champions,
    media,
  };
}

describe('ChampionStaticService', () => {
  it('rejects numeric-only champion keys', async () => {
    const { service, champions } = createService();
    await expect(service.getByKey('23')).rejects.toBeInstanceOf(ChampionNotFoundError);
    expect(champions.findByChampionKey).not.toHaveBeenCalled();
  });

  it('returns canonicalChampionKey for case-insensitive match', async () => {
    const { service } = createService();
    const response = await service.getByKey('ahri');
    expect(response.champion.championKey).toBe('Ahri');
    expect(response.champion.canonicalChampionKey).toBe('Ahri');
    expect(response.champion.iconUrl).toContain('/Ahri.png');
    expect(response.champion.splashUrl).toContain('/Ahri_0.jpg');
  });

  it('returns normalized P/Q/W/E/R abilities from stored static data', async () => {
    const { service } = createService({
      row: {
        championId: 103,
        championKey: 'Ahri',
        name: 'Ahri',
        title: 'the Nine-Tailed Fox',
        tags: ['Mage'],
        patchVersion: '16.10.1',
        dataDragonVersion: '16.10.1',
        passive: {
          name: 'Essence Theft',
          description: "Ahri's <font color='#FFF'>next spell</font> heals her.",
          imageFull: 'Ahri_SoulEater2.png',
        },
        spells: [
          {
            name: 'Orb of Deception',
            description: 'Ahri sends out her orb.',
            imageFull: 'AhriQ.png',
            cooldownBurn: '7',
            costBurn: '55/65/75/85/95',
            rangeBurn: '900',
          },
          { name: 'Fox-Fire', description: 'Fox-fires.', imageFull: 'AhriW.png' },
          { name: 'Charm', description: 'Charm.', imageFull: 'AhriE.png' },
          { name: 'Spirit Rush', description: 'Dash.', imageFull: 'AhriR.png' },
        ],
      },
    });
    const response = await service.getByKey('Ahri');
    expect(response.champion.abilities?.map((ability) => ability.slot)).toEqual([
      'PASSIVE',
      'Q',
      'W',
      'E',
      'R',
    ]);
    expect(response.champion.abilities?.[0]?.name).toBe('Essence Theft');
    expect(response.champion.abilities?.[0]?.description).toBe("Ahri's next spell heals her.");
    expect(response.champion.abilities?.[0]?.iconUrl).toContain('/img/passive/Ahri_SoulEater2.png');
    expect(response.champion.abilities?.[1]?.cooldown).toBe('7');
    expect(JSON.stringify(response)).not.toMatch(/<font/);
    expect(JSON.stringify(response).toLowerCase()).not.toContain('puuid');
  });

  it('lists champions with static patch metadata', async () => {
    const { service } = createService();
    const response = await service.list();
    expect(response.champions).toHaveLength(1);
    expect(response.staticDataPatch).toBe('14.1.1.seed');
    expect(response.staticDataVersion).toBe('14.1.1');
  });

  it('throws CHAMPION_NOT_FOUND for unknown keys', async () => {
    const { service } = createService({ row: null });
    await expect(service.getByKey('NotAChamp')).rejects.toBeInstanceOf(ChampionNotFoundError);
  });

  it('throws CHAMPION_NOT_FOUND for hidden League Classic keys', async () => {
    const { service, champions } = createService({ row: null });
    await expect(service.getByKey('Jade_Ahri')).rejects.toBeInstanceOf(ChampionNotFoundError);
    expect(champions.findByChampionKey).toHaveBeenCalledWith('Jade_Ahri');
  });

  it('lists only rows returned by the public repository filter', async () => {
    const { service } = createService({
      listRows: [
        {
          championId: 103,
          championKey: 'Ahri',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage'],
          patchVersion: '16.15.1',
          dataDragonVersion: '16.15.1',
        },
      ],
    });
    const response = await service.list();
    expect(response.champions.map((c) => c.championKey)).toEqual(['Ahri']);
    expect(response.champions.some((c) => c.championKey.startsWith('Jade_'))).toBe(false);
  });
});
