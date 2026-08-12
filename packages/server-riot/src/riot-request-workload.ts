import { AsyncLocalStorage } from 'node:async_hooks';
import type { RiotEndpointCategory } from './riot-api.types';

/**
 * Cross-workload Riot request budget classes.
 *
 * Priority (highest → lowest urgency for capacity under contention):
 * 1. match — match detail / timeline / match-id discovery for source dataset
 * 2. refresh — tracked-root refresh / softSync ranks
 * 3. enrichment — participant-rank League-v4 (may lag; ALL remains source-complete)
 * 4. ladder / identity — new ladder acquisition / Account-v1 resolve
 * 5. product — PRODUCT_SEARCH / player refresh (reserved headroom)
 */
export type RiotRequestWorkload =
  | 'match'
  | 'refresh'
  | 'enrichment'
  | 'ladder'
  | 'identity'
  | 'product'
  | 'unknown';

const workloadStorage = new AsyncLocalStorage<RiotRequestWorkload>();

/** Run `fn` with an explicit Riot request workload tag for budget accounting. */
export function withRiotWorkload<T>(
  workload: RiotRequestWorkload,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return workloadStorage.run(workload, fn);
}

export function getRiotWorkloadContext(): RiotRequestWorkload | undefined {
  return workloadStorage.getStore();
}

/** Infer a conservative default workload from the Riot endpoint category. */
export function defaultWorkloadForCategory(category: RiotEndpointCategory): RiotRequestWorkload {
  switch (category) {
    case 'match-v5':
      return 'match';
    case 'league-v4':
      return 'refresh';
    case 'account-v1':
    case 'summoner-v4':
      return 'identity';
    case 'champion-mastery-v4':
      return 'product';
    default:
      return 'unknown';
  }
}

export function resolveRiotRequestWorkload(input: {
  explicit?: RiotRequestWorkload | null;
  category: RiotEndpointCategory;
}): RiotRequestWorkload {
  return input.explicit ?? getRiotWorkloadContext() ?? defaultWorkloadForCategory(input.category);
}
