/**
 * Public champion directory/detail visibility.
 *
 * Data Dragon includes League of Legends Classic roster variants alongside the
 * normal Summoner's Rift champions. Classic entries use:
 * - championKey prefix pattern `Jade_*` (underscore-separated asset keys)
 * - championId offset in the 60000+ range (base championId + 60000)
 *
 * Full ChampionStaticData rows remain synced for identity/history; public APIs
 * filter these out. No hardcoded champion name allow/deny list.
 */

/** Classic / non-standard Data Dragon champion IDs start at this offset. */
export const CLASSIC_CHAMPION_ID_MIN = 60_000;

export type ChampionVisibilityIdentity = {
  championKey: string;
  championId: number;
};

/**
 * Returns true when a champion should appear in public directory/detail APIs.
 */
export function isPublicChampionEntry(input: ChampionVisibilityIdentity): boolean {
  const key = input.championKey.trim();
  if (!key || key.includes('_')) {
    return false;
  }
  if (!Number.isInteger(input.championId) || input.championId < 0) {
    return false;
  }
  if (input.championId >= CLASSIC_CHAMPION_ID_MIN) {
    return false;
  }
  return true;
}

/**
 * Prisma where-clause fragment restricting reads to public champions.
 * Compose with patch/search filters via AND.
 *
 * Only the classic ID offset is applied in SQL. Do not use `contains: '_'` —
 * Prisma maps that to SQL LIKE where `_` is a single-character wildcard and
 * would match every non-empty championKey. Underscore keys are still rejected
 * by {@link isPublicChampionEntry} on loaded rows.
 */
export function publicChampionStaticWhere(): {
  championId: { lt: number };
} {
  return {
    championId: { lt: CLASSIC_CHAMPION_ID_MIN },
  };
}
