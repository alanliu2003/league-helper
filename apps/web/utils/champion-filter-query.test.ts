import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  type ChampionStatsFiltersResponse,
} from '@league-helper/shared';
import {
  parseAggregateFiltersFromQuery,
  parseDirectoryFiltersFromQuery,
  resolveAggregateFilterDefaults,
  resolveDirectoryFilterDefaults,
} from './champion-filter-query';

function meta(): ChampionStatsFiltersResponse {
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    defaultPlatform: 'na1',
    defaultQueueId: 420,
    defaultPatch: '14.11',
    availablePlatforms: ['na1'],
    availablePatches: ['14.11'],
    availableQueues: [{ queueId: 420, label: 'Ranked Solo/Duo', supportsStandardPositions: true }],
    availableTiers: ['ALL', 'GOLD'],
    availablePositions: ['TOP', 'MIDDLE'],
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  };
}

describe('champion-filter-query', () => {
  it('parses aggregate filters and flags queueId alias + directory-only params', () => {
    const parsed = parseAggregateFiltersFromQuery({
      queueId: '420',
      tier: 'GOLD',
      position: 'MIDDLE',
      search: 'ah',
      tag: 'Mage',
    });

    expect(parsed.hadQueueIdAlias).toBe(true);
    expect(parsed.hadDirectoryOnlyParams).toBe(true);
    expect(parsed.filters.queue).toBe(420);
    expect(parsed.filters.tier).toBe('GOLD');
    expect(parsed.filters.position).toBe('MIDDLE');
  });

  it('parses directory filters including search/tag', () => {
    const parsed = parseDirectoryFiltersFromQuery({
      platform: 'euw1',
      queue: '440',
      search: 'fox',
      tag: 'Mage',
    });

    expect(parsed.filters.platform).toBe('euw1');
    expect(parsed.filters.queue).toBe(440);
    expect(parsed.filters.search).toBe('fox');
    expect(parsed.filters.tag).toBe('Mage');
  });

  it('resolves aggregate and directory defaults identically for shared fields', () => {
    const aggregate = resolveAggregateFilterDefaults(
      {
        platform: null,
        queue: null,
        tier: null,
        position: null,
        patch: null,
      },
      meta(),
    );
    const directory = resolveDirectoryFilterDefaults(
      {
        platform: null,
        queue: null,
        tier: null,
        position: null,
        patch: null,
        search: 'ah',
        tag: null,
      },
      meta(),
    );

    expect(aggregate).toEqual({
      platform: 'na1',
      queue: 420,
      tier: 'ALL',
      position: null,
      patch: '14.11',
    });
    expect(directory.platform).toBe(aggregate.platform);
    expect(directory.queue).toBe(aggregate.queue);
    expect(directory.tier).toBe(aggregate.tier);
    expect(directory.patch).toBe(aggregate.patch);
    expect(directory.search).toBe('ah');
  });
});
