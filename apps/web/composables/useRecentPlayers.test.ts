import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_PLAYERS_STORAGE_KEY,
  readRecentPlayersStorage,
  writeRecentPlayersStorage,
  type RecentPlayerEntry,
} from './useRecentPlayers';

const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
});

describe('useRecentPlayers storage shape', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('stores recent players without PUUID fields', () => {
    const entries: RecentPlayerEntry[] = [
      {
        playerId: '00000000-0000-4000-8000-000000000001',
        riotIdDisplay: 'Example#NA1',
        platformLabel: 'North America',
        lastSearchedAt: '2026-08-04T08:00:00.000Z',
      },
    ];

    writeRecentPlayersStorage(entries);

    expect(readRecentPlayersStorage()).toEqual(entries);

    const raw = storage.get(RECENT_PLAYERS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).not.toMatch(/puuid/i);
    expect(JSON.parse(raw!)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ puuid: expect.anything() })]),
    );
    expect(Object.keys(JSON.parse(raw!)[0]).sort()).toEqual([
      'lastSearchedAt',
      'platformLabel',
      'playerId',
      'riotIdDisplay',
    ]);
  });

  it('filters out entries that contain puuid when reading', () => {
    storage.set(
      RECENT_PLAYERS_STORAGE_KEY,
      JSON.stringify([
        {
          playerId: '00000000-0000-4000-8000-000000000001',
          riotIdDisplay: 'Example#NA1',
          platformLabel: 'North America',
          lastSearchedAt: '2026-08-04T08:00:00.000Z',
          puuid: 'secret-puuid-value',
        },
      ]),
    );

    expect(readRecentPlayersStorage()).toEqual([]);
  });
});
