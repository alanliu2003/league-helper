import { describe, expect, it, vi } from 'vitest';
import type { ChampionMasterySnapshot } from '@prisma/client';
import { mapPublicMastery } from './player-response.mapper';

describe('mapPublicMastery enrichment', () => {
  const snapshot = {
    id: '11111111-1111-1111-1111-111111111111',
    playerAccountId: 'acct',
    championId: 23,
    championLevel: 7,
    championPoints: 1000,
    lastPlayTime: new Date('2024-01-01T00:00:00.000Z'),
    chestGranted: true,
    tokensEarned: 0,
    capturedAt: new Date('2024-01-02T00:00:00.000Z'),
  } as ChampionMasterySnapshot;

  it('includes champion metadata when provided', () => {
    const mapped = mapPublicMastery(snapshot, {
      id: 'Tryndamere',
      key: '23',
      name: 'Tryndamere',
      title: 'the Barbarian King',
      iconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.15.1/img/champion/Tryndamere.png',
      splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg',
    });

    expect(mapped.championName).toBe('Tryndamere');
    expect(mapped.championKey).toBe('Tryndamere');
    expect(mapped.championIconUrl).toContain('/img/champion/Tryndamere.png');
    expect(mapped.championSplashUrl).toBe(
      'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg',
    );
    expect(mapped.championSplashUrl).toContain('_0.jpg');
    expect(mapped.championId).toBe(23);
  });

  it('uses DrMundo asset key for splash URL (not display name)', () => {
    const mapped = mapPublicMastery(snapshot, {
      id: 'DrMundo',
      key: '36',
      name: 'Dr. Mundo',
      title: 'the Madman of Zaun',
      iconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.15.1/img/champion/DrMundo.png',
      splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/DrMundo_0.jpg',
    });

    expect(mapped.championKey).toBe('DrMundo');
    expect(mapped.championSplashUrl).toContain('/splash/DrMundo_0.jpg');
    expect(mapped.championSplashUrl).not.toContain('Dr. Mundo');
    expect(mapped.championSplashUrl).not.toContain('Dr.%20Mundo');
  });

  it('falls back to null champion fields when metadata missing', () => {
    const mapped = mapPublicMastery(snapshot, null);
    expect(mapped.championName).toBeNull();
    expect(mapped.championKey).toBeNull();
    expect(mapped.championIconUrl).toBeNull();
    expect(mapped.championSplashUrl).toBeNull();
    expect(mapped.championId).toBe(23);
  });
});

describe('profile mastery enrichment resilience', () => {
  it('maps with null metadata when Data Dragon getAllChampions rejects', async () => {
    const dataDragon = {
      getAllChampions: vi.fn(async () => {
        throw new Error('cdn unavailable');
      }),
    };

    const rows = [snapshot()];
    let result;
    try {
      const champions = await dataDragon.getAllChampions();
      const byNumericId = new Map(
        (champions as Array<{ key: string; name: string }>).map((c) => [Number(c.key), c]),
      );
      result = rows.map((row) => mapPublicMastery(row, byNumericId.get(row.championId) ?? null));
    } catch {
      result = rows.map((row) => mapPublicMastery(row, null));
    }

    expect(result).toHaveLength(1);
    expect(result[0]?.championName).toBeNull();
    expect(result[0]?.championId).toBe(23);
  });
});

function snapshot(): ChampionMasterySnapshot {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    playerAccountId: 'acct',
    championId: 23,
    championLevel: 7,
    championPoints: 1000,
    lastPlayTime: new Date('2024-01-01T00:00:00.000Z'),
    chestGranted: true,
    tokensEarned: 0,
    capturedAt: new Date('2024-01-02T00:00:00.000Z'),
  } as ChampionMasterySnapshot;
}
