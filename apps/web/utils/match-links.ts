export function buildMatchPath(matchId: string, playerId?: string | null): string {
  const base = `/matches/${encodeURIComponent(matchId)}`;
  if (!playerId?.trim()) return base;
  return `${base}?player=${encodeURIComponent(playerId.trim())}`;
}
