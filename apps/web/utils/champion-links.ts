/** Public URL helpers for champion routes. Aggregate filters only on detail links. */

export type ChampionAggregateLinkFilters = {
  platform?: string | null;
  queue?: number | string | null;
  tier?: string | null;
  position?: string | null;
  patch?: string | null;
};

export type ChampionDirectoryLinkFilters = ChampionAggregateLinkFilters & {
  search?: string | null;
  tag?: string | null;
};

const AGGREGATE_KEYS = ['platform', 'queue', 'tier', 'position', 'patch'] as const;

function appendParam(params: URLSearchParams, key: string, value: string | number | null | undefined): void {
  if (value === null || value === undefined || value === '') {
    return;
  }
  params.set(key, String(value));
}

/**
 * Detail path with aggregate filters only.
 * Never includes directory-only `search` / `tag` (even if present on the input object).
 */
export function buildChampionPath(
  championKey: string,
  filters: ChampionAggregateLinkFilters & { search?: string | null; tag?: string | null } = {},
): string {
  const params = new URLSearchParams();
  for (const key of AGGREGATE_KEYS) {
    appendParam(params, key, filters[key]);
  }
  const query = params.toString();
  const encodedKey = encodeURIComponent(championKey);
  return query ? `/champions/${encodedKey}?${query}` : `/champions/${encodedKey}`;
}

/** Directory path including aggregate filters plus optional search/tag. */
export function buildChampionsDirectoryPath(filters: ChampionDirectoryLinkFilters = {}): string {
  const params = new URLSearchParams();
  for (const key of AGGREGATE_KEYS) {
    appendParam(params, key, filters[key]);
  }
  appendParam(params, 'search', filters.search);
  appendParam(params, 'tag', filters.tag);
  const query = params.toString();
  return query ? `/champions?${query}` : '/champions';
}

/** Serialize public filter state to canonical query params (queue, never queueId). */
export function toChampionPublicQuery(filters: ChampionDirectoryLinkFilters): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of AGGREGATE_KEYS) {
    const value = filters[key];
    if (value !== null && value !== undefined && value !== '') {
      params[key] = String(value);
    }
  }
  if (filters.search) {
    params.search = filters.search;
  }
  if (filters.tag) {
    params.tag = filters.tag;
  }
  return params;
}
