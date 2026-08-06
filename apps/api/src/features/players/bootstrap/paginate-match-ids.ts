import type { PlayerAccount as ProviderAccount } from '@league-helper/shared';

export type GetRecentMatchIdsFn = (
  account: ProviderAccount,
  options: { queue?: number; start?: number; count?: number },
) => Promise<string[]>;

/**
 * Paginate Riot `getRecentMatchIds` until `maxMatches` or a short page.
 * Dedupes overlapping IDs across pages while preserving first-seen order.
 */
export async function paginateRecentMatchIds(input: {
  getRecentMatchIds: GetRecentMatchIdsFn;
  account: ProviderAccount;
  queueId: number;
  maxMatches: number;
  pageSize: number;
}): Promise<string[]> {
  const { getRecentMatchIds, account, queueId, maxMatches, pageSize } = input;
  if (maxMatches < 1) {
    return [];
  }

  const effectivePageSize = Math.min(Math.max(1, pageSize), 100);
  const collected: string[] = [];
  const seen = new Set<string>();
  let start = 0;

  while (collected.length < maxMatches) {
    const remaining = maxMatches - collected.length;
    const count = Math.min(effectivePageSize, remaining);
    const page = await getRecentMatchIds(account, {
      queue: queueId,
      start,
      count,
    });

    if (page.length === 0) {
      break;
    }

    const sizeBefore = collected.length;
    for (const id of page) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      collected.push(id);
      if (collected.length >= maxMatches) {
        break;
      }
    }

    // No forward progress (full overlap) or short page → stop.
    if (collected.length === sizeBefore || page.length < count) {
      break;
    }

    start += count;
  }

  return collected;
}
