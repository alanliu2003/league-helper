import { formatRiotId, getPlatformDisplayName, type PlatformRoute } from '@league-helper/shared';

const STORAGE_KEY = 'lh-recent-players';
const MAX_RECENT = 5;

export const RECENT_PLAYERS_STORAGE_KEY = STORAGE_KEY;

export interface RecentPlayerEntry {
  playerId: string;
  riotIdDisplay: string;
  platformLabel: string;
  lastSearchedAt: string;
}

export function readRecentPlayersStorage(): RecentPlayerEntry[] {
  return readStorage();
}

export function writeRecentPlayersStorage(entries: RecentPlayerEntry[]): void {
  writeStorage(entries);
}

function readStorage(): RecentPlayerEntry[] {
  if (import.meta.server) {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecentPlayerEntry);
  } catch {
    return [];
  }
}

function writeStorage(entries: RecentPlayerEntry[]): void {
  if (import.meta.server) {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function isRecentPlayerEntry(value: unknown): value is RecentPlayerEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.playerId === 'string' &&
    typeof entry.riotIdDisplay === 'string' &&
    typeof entry.platformLabel === 'string' &&
    typeof entry.lastSearchedAt === 'string' &&
    !('puuid' in entry) &&
    !('PUUID' in entry)
  );
}

export function useRecentPlayers() {
  const recentPlayers = useState<RecentPlayerEntry[]>('recent-players', () => []);

  function hydrate(): void {
    recentPlayers.value = readStorage();
  }

  function addRecent(input: {
    playerId: string;
    gameName: string;
    tagLine: string;
    platform: PlatformRoute;
  }): void {
    const entry: RecentPlayerEntry = {
      playerId: input.playerId,
      riotIdDisplay: formatRiotId({ gameName: input.gameName, tagLine: input.tagLine }),
      platformLabel: getPlatformDisplayName(input.platform),
      lastSearchedAt: new Date().toISOString(),
    };

    const filtered = recentPlayers.value.filter((item) => item.playerId !== entry.playerId);
    recentPlayers.value = [entry, ...filtered].slice(0, MAX_RECENT);
    writeStorage(recentPlayers.value);
  }

  function clearRecent(): void {
    recentPlayers.value = [];
    writeStorage([]);
  }

  if (import.meta.client) {
    onMounted(hydrate);
  }

  return {
    recentPlayers,
    addRecent,
    clearRecent,
    hydrate,
  };
}
