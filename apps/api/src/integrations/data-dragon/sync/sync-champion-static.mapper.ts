import type { MappedChampionStaticRow, SyncDataDragonChampionEntry } from './sync-champion-static.types';

const BASE_URL = 'https://ddragon.leagueoflegends.com';

export function mapDataDragonChampionEntry(
  entry: SyncDataDragonChampionEntry,
): MappedChampionStaticRow {
  if (!/^\d+$/.test(entry.key)) {
    throw new Error(`Data Dragon key must be a numeric string; received ${entry.key}`);
  }
  const championId = Number.parseInt(entry.key, 10);
  if (!Number.isInteger(championId) || championId < 0) {
    throw new Error(`Failed to parse championId from key ${entry.key}`);
  }
  return {
    championId,
    championKey: entry.id,
    name: entry.name,
    title: entry.title,
    tags: entry.tags ?? [],
    baseStats: entry.stats ?? {},
    passive: {},
    spells: [],
    imageData: entry.image ?? {},
  };
}

export function normalizeMajorMinor(version: string): string {
  const parts = version.trim().split('.');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Cannot derive normalizedMajorMinor from version ${version}`);
  }
  return `${parts[0]}.${parts[1]}`;
}

export function buildChampionIconUrl(championKey: string, version: string): string {
  const key = championKey.trim();
  const ver = version.trim();
  if (!key || !ver) {
    throw new Error('championKey and version are required to build an icon URL');
  }
  return `${BASE_URL}/cdn/${encodeURIComponent(ver)}/img/champion/${encodeURIComponent(key)}.png`;
}

export function buildChampionSplashUrl(championKey: string): string {
  const key = championKey.trim();
  if (!key) {
    throw new Error('championKey is required to build a splash URL');
  }
  return `${BASE_URL}/cdn/img/champion/splash/${encodeURIComponent(key)}_0.jpg`;
}
