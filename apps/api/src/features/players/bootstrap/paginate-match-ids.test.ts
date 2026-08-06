import { describe, expect, it, vi } from 'vitest';
import type { PlayerAccount as ProviderAccount } from '@league-helper/shared';
import { paginateRecentMatchIds } from './paginate-match-ids';

const account = {
  provider: 'RIOT',
  externalAccountId: 'ext-1',
  platform: 'na1',
  regionalRoute: 'americas',
  riotId: { gameName: 'A', tagLine: 'NA1' },
} as ProviderAccount;

describe('paginateRecentMatchIds', () => {
  it('returns a single page when maxMatches ≤ pageSize', async () => {
    const getRecentMatchIds = vi.fn(async () => ['m1', 'm2', 'm3']);

    const ids = await paginateRecentMatchIds({
      getRecentMatchIds,
      account,
      queueId: 420,
      maxMatches: 50,
      pageSize: 100,
    });

    expect(ids).toEqual(['m1', 'm2', 'm3']);
    expect(getRecentMatchIds).toHaveBeenCalledTimes(1);
    expect(getRecentMatchIds).toHaveBeenCalledWith(account, {
      queue: 420,
      start: 0,
      count: 50,
    });
  });

  it('fetches multiple pages until maxMatches', async () => {
    const getRecentMatchIds = vi.fn(async (_account, options) => {
      if (options.start === 0) {
        return Array.from({ length: 100 }, (_, i) => `p0-${i}`);
      }
      if (options.start === 100) {
        return Array.from({ length: 50 }, (_, i) => `p1-${i}`);
      }
      return [];
    });

    const ids = await paginateRecentMatchIds({
      getRecentMatchIds,
      account,
      queueId: 420,
      maxMatches: 150,
      pageSize: 100,
    });

    expect(ids).toHaveLength(150);
    expect(ids[0]).toBe('p0-0');
    expect(ids[100]).toBe('p1-0');
    expect(getRecentMatchIds).toHaveBeenCalledTimes(2);
    expect(getRecentMatchIds).toHaveBeenNthCalledWith(1, account, {
      queue: 420,
      start: 0,
      count: 100,
    });
    expect(getRecentMatchIds).toHaveBeenNthCalledWith(2, account, {
      queue: 420,
      start: 100,
      count: 50,
    });
  });

  it('stops early when a page returns fewer than requested', async () => {
    const getRecentMatchIds = vi.fn(async (_account, options) => {
      if (options.start === 0) {
        return Array.from({ length: 100 }, (_, i) => `a-${i}`);
      }
      return ['short-1', 'short-2'];
    });

    const ids = await paginateRecentMatchIds({
      getRecentMatchIds,
      account,
      queueId: 420,
      maxMatches: 300,
      pageSize: 100,
    });

    expect(ids).toHaveLength(102);
    expect(getRecentMatchIds).toHaveBeenCalledTimes(2);
  });

  it('dedupes overlapping IDs if provider returns overlap', async () => {
    const getRecentMatchIds = vi.fn(async (_account, options) => {
      if (options.start === 0) {
        return ['a', 'b', 'c'];
      }
      return ['c', 'd', 'e'];
    });

    const ids = await paginateRecentMatchIds({
      getRecentMatchIds,
      account,
      queueId: 420,
      maxMatches: 6,
      pageSize: 3,
    });

    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('passes queue through on every page', async () => {
    const getRecentMatchIds = vi.fn(async () => ['x']);

    await paginateRecentMatchIds({
      getRecentMatchIds,
      account,
      queueId: 440,
      maxMatches: 1,
      pageSize: 100,
    });

    expect(getRecentMatchIds).toHaveBeenCalledWith(account, {
      queue: 440,
      start: 0,
      count: 1,
    });
  });
});
