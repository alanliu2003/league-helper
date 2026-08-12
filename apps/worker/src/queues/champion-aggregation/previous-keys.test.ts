import { describe, expect, it } from 'vitest';
import {
  ALL_RANK_TIER_SENTINEL,
  UNKNOWN_RANK_TIER_SENTINEL,
  buildChampionAggregateDimensionKey,
} from '@league-helper/match-analytics';
import {
  expandCurrentDimensionKeys,
  expandPreviousDimensionKeys,
  mergeRecalcScopeKeys,
  unionDimensionKeys,
  type PreviousParticipantDimensionSnapshot,
} from './previous-keys.js';
import { expandDimensionKeysForRankClassification } from './rank-dimension-keys.js';
import { classifyParticipantRankForAggregates } from '@league-helper/shared';

const VERSIONS = { sourceNormalizationVersion: '1', aggregationVersion: '1' };

function snapshot(
  overrides: Partial<PreviousParticipantDimensionSnapshot> = {},
): PreviousParticipantDimensionSnapshot {
  return {
    patch: '14.1',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    mapId: 11,
    gameMode: 'CLASSIC',
    remake: false,
    championId: 103,
    teamPosition: 'MIDDLE',
    individualPosition: 'MIDDLE',
    lane: 'MIDDLE',
    role: 'SOLO',
    rankTierAtIngestion: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    ...overrides,
  };
}

/** Count keys whose rankTier dimension (index 4) equals tier. */
function countTier(keys: string[], tier: string): number {
  return keys.filter((key) => {
    try {
      const parsed: unknown = JSON.parse(key);
      return Array.isArray(parsed) && parsed[4] === tier;
    } catch {
      return false;
    }
  }).length;
}

function countPosition(keys: string[], position: string): number {
  return keys.filter((key) => {
    try {
      const parsed: unknown = JSON.parse(key);
      return Array.isArray(parsed) && parsed[5] === position;
    } catch {
      return false;
    }
  }).length;
}

describe('previous-keys', () => {
  it('expands RESOLVED_RANKED to exact + ALL tier + ALL position (3 keys)', () => {
    const keys = expandPreviousDimensionKeys([snapshot()], VERSIONS);
    expect(keys).toHaveLength(3);
    expect(countTier(keys, 'GOLD')).toBe(2); // exact + ALL-position
    expect(countTier(keys, ALL_RANK_TIER_SENTINEL)).toBe(1);
  });

  it('PENDING expands to ALL only (never UNKNOWN)', () => {
    const keys = expandPreviousDimensionKeys(
      [
        snapshot({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'PENDING',
        }),
      ],
      VERSIONS,
    );
    expect(keys).toHaveLength(1);
    expect(countTier(keys, ALL_RANK_TIER_SENTINEL)).toBe(1);
    expect(countTier(keys, UNKNOWN_RANK_TIER_SENTINEL)).toBe(0);
  });

  it('FAILED_PERMANENT expands to ALL only (never UNKNOWN)', () => {
    const keys = expandPreviousDimensionKeys(
      [
        snapshot({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'FAILED_PERMANENT',
        }),
      ],
      VERSIONS,
    );
    expect(keys).toHaveLength(1);
    expect(countTier(keys, ALL_RANK_TIER_SENTINEL)).toBe(1);
    expect(countTier(keys, UNKNOWN_RANK_TIER_SENTINEL)).toBe(0);
  });

  it('RESOLVED_UNRANKED expands to UNKNOWN + ALL tier + UNKNOWN ALL-position', () => {
    const keys = expandPreviousDimensionKeys(
      [
        snapshot({
          rankTierAtIngestion: null,
          rankResolutionStatus: 'RESOLVED_UNRANKED',
        }),
      ],
      VERSIONS,
    );
    expect(keys).toHaveLength(3);
    expect(countTier(keys, UNKNOWN_RANK_TIER_SENTINEL)).toBe(2);
    expect(countTier(keys, ALL_RANK_TIER_SENTINEL)).toBe(1);
  });

  it('unions previous and current keys for SUPPORT→MIDDLE correction', () => {
    const previous = expandPreviousDimensionKeys(
      [
        snapshot({
          teamPosition: 'UTILITY',
          individualPosition: 'UTILITY',
          lane: 'BOTTOM',
          role: 'DUO_SUPPORT',
        }),
      ],
      VERSIONS,
    );
    const classification = classifyParticipantRankForAggregates({
      status: 'RESOLVED_RANKED',
      resolvedTier: 'GOLD',
    });
    const current = expandCurrentDimensionKeys([
      {
        base: {
          patch: '14.1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
          position: 'MIDDLE',
          championId: 103,
          ...VERSIONS,
        },
        rankClassification: classification,
      },
    ]);
    const union = unionDimensionKeys(previous, current);

    expect(countPosition(previous, 'SUPPORT')).toBeGreaterThan(0);
    expect(countPosition(current, 'MIDDLE')).toBeGreaterThan(0);
    expect(union.length).toBeGreaterThan(previous.length);
    expect(union).toEqual([...new Set([...previous, ...current])].sort());
  });

  it('returns empty previous keys for create (no snapshots)', () => {
    expect(expandPreviousDimensionKeys([], VERSIONS)).toEqual([]);
  });

  it('mergeRecalcScopeKeys unions without dropping prior pending keys', () => {
    expect(mergeRecalcScopeKeys(['a'], ['b'])).toEqual(['a', 'b']);
    expect(mergeRecalcScopeKeys(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});

describe('generic affected-key convergence', () => {
  const base = {
    patch: '14.1',
    platformRoute: 'na1' as const,
    regionalRoute: 'americas' as const,
    queueId: 420,
    position: 'SUPPORT' as const,
    championId: 164,
    ...VERSIONS,
  };

  function keysFor(
    status: PreviousParticipantDimensionSnapshot['rankResolutionStatus'],
    tier: string | null,
  ): string[] {
    return expandDimensionKeysForRankClassification(
      base,
      classifyParticipantRankForAggregates({
        status,
        resolvedTier: tier,
      }),
    );
  }

  function assertTransition(input: {
    fromStatus: PreviousParticipantDimensionSnapshot['rankResolutionStatus'];
    fromTier: string | null;
    toStatus: PreviousParticipantDimensionSnapshot['rankResolutionStatus'];
    toTier: string | null;
    expectOldExactGone: string | null;
    expectNewExact: string | null;
    expectUnknownInCurrent: boolean;
  }) {
    const previous = keysFor(input.fromStatus, input.fromTier);
    const current = keysFor(input.toStatus, input.toTier);
    const affected = unionDimensionKeys(previous, current);

    expect(countTier(current, ALL_RANK_TIER_SENTINEL)).toBe(1);
    expect(countTier(previous, ALL_RANK_TIER_SENTINEL)).toBe(1);
    expect(affected).toEqual([...new Set([...previous, ...current])].sort());

    if (input.expectOldExactGone) {
      expect(countTier(current, input.expectOldExactGone)).toBe(0);
      expect(countTier(affected, input.expectOldExactGone)).toBeGreaterThan(0);
    }
    if (input.expectNewExact) {
      expect(countTier(current, input.expectNewExact)).toBeGreaterThan(0);
    }
    expect(countTier(current, UNKNOWN_RANK_TIER_SENTINEL) > 0).toBe(input.expectUnknownInCurrent);

    // Idempotent same-state recalculation
    const again = keysFor(input.toStatus, input.toTier);
    expect(again).toEqual(current);
    expect(unionDimensionKeys(current, again)).toEqual(current);
  }

  it('PENDING → DIAMOND', () => {
    assertTransition({
      fromStatus: 'PENDING',
      fromTier: null,
      toStatus: 'RESOLVED_RANKED',
      toTier: 'DIAMOND',
      expectOldExactGone: null,
      expectNewExact: 'DIAMOND',
      expectUnknownInCurrent: false,
    });
  });

  it('FAILED_PERMANENT → DIAMOND: ALL preserved, no stale UNKNOWN, DIAMOND added', () => {
    const previous = keysFor('FAILED_PERMANENT', null);
    const current = keysFor('RESOLVED_RANKED', 'DIAMOND');
    const affected = unionDimensionKeys(previous, current);

    expect(countTier(previous, ALL_RANK_TIER_SENTINEL)).toBe(1);
    expect(countTier(previous, UNKNOWN_RANK_TIER_SENTINEL)).toBe(0);
    expect(countTier(current, ALL_RANK_TIER_SENTINEL)).toBe(1);
    expect(countTier(current, UNKNOWN_RANK_TIER_SENTINEL)).toBe(0);
    expect(countTier(current, 'DIAMOND')).toBeGreaterThan(0);
    expect(countTier(affected, UNKNOWN_RANK_TIER_SENTINEL)).toBe(0);

    const previousAll = previous.find((k) => {
      const parsed: unknown = JSON.parse(k);
      return Array.isArray(parsed) && parsed[4] === ALL_RANK_TIER_SENTINEL;
    });
    const currentAll = current.find((k) => {
      const parsed: unknown = JSON.parse(k);
      return Array.isArray(parsed) && parsed[4] === ALL_RANK_TIER_SENTINEL;
    });
    expect(previousAll).toBeDefined();
    expect(currentAll).toBe(previousAll);
  });

  it('FAILED_RETRYABLE → MASTER', () => {
    assertTransition({
      fromStatus: 'FAILED_RETRYABLE',
      fromTier: null,
      toStatus: 'RESOLVED_RANKED',
      toTier: 'MASTER',
      expectOldExactGone: null,
      expectNewExact: 'MASTER',
      expectUnknownInCurrent: false,
    });
  });

  it('RESOLVED_UNRANKED → DIAMOND (stale UNKNOWN removed from current)', () => {
    assertTransition({
      fromStatus: 'RESOLVED_UNRANKED',
      fromTier: null,
      toStatus: 'RESOLVED_RANKED',
      toTier: 'DIAMOND',
      expectOldExactGone: UNKNOWN_RANK_TIER_SENTINEL,
      expectNewExact: 'DIAMOND',
      expectUnknownInCurrent: false,
    });
  });

  it('DIAMOND → EMERALD', () => {
    assertTransition({
      fromStatus: 'RESOLVED_RANKED',
      fromTier: 'DIAMOND',
      toStatus: 'RESOLVED_RANKED',
      toTier: 'EMERALD',
      expectOldExactGone: 'DIAMOND',
      expectNewExact: 'EMERALD',
      expectUnknownInCurrent: false,
    });
  });

  it('DIAMOND → RESOLVED_UNRANKED', () => {
    assertTransition({
      fromStatus: 'RESOLVED_RANKED',
      fromTier: 'DIAMOND',
      toStatus: 'RESOLVED_UNRANKED',
      toTier: null,
      expectOldExactGone: 'DIAMOND',
      expectNewExact: null,
      expectUnknownInCurrent: true,
    });
  });

  it('repeated same-state recalculation is idempotent', () => {
    const keys = keysFor('RESOLVED_RANKED', 'DIAMOND');
    expect(unionDimensionKeys(keys, keys)).toEqual(keys);
    expect(keysFor('RESOLVED_RANKED', 'DIAMOND')).toEqual(keys);
  });

  it('position change includes old SUPPORT and new MIDDLE in affected closure', () => {
    const previous = expandPreviousDimensionKeys(
      [
        snapshot({
          championId: 164,
          teamPosition: 'UTILITY',
          individualPosition: 'UTILITY',
          lane: 'BOTTOM',
          role: 'DUO_SUPPORT',
          rankTierAtIngestion: 'DIAMOND',
          rankResolutionStatus: 'RESOLVED_RANKED',
        }),
      ],
      VERSIONS,
    );
    const current = expandDimensionKeysForRankClassification(
      { ...base, position: 'MIDDLE' },
      classifyParticipantRankForAggregates({
        status: 'RESOLVED_RANKED',
        resolvedTier: 'DIAMOND',
      }),
    );
    const affected = unionDimensionKeys(previous, current);
    expect(countPosition(previous, 'SUPPORT')).toBeGreaterThan(0);
    expect(countPosition(current, 'MIDDLE')).toBeGreaterThan(0);
    expect(countPosition(affected, 'SUPPORT')).toBeGreaterThan(0);
    expect(countPosition(affected, 'MIDDLE')).toBeGreaterThan(0);
  });
});

describe('champion-position smoke fixtures', () => {
  const fixtures = [
    { name: 'Camille SUPPORT', championId: 164, position: 'SUPPORT' as const },
    { name: 'Akali MIDDLE', championId: 84, position: 'MIDDLE' as const },
    { name: 'Jinx BOTTOM', championId: 222, position: 'BOTTOM' as const },
    { name: 'LeeSin JUNGLE', championId: 64, position: 'JUNGLE' as const },
    { name: 'Darius TOP', championId: 122, position: 'TOP' as const },
  ];

  for (const fixture of fixtures) {
    it(`${fixture.name}: ALL preserved across PENDING→DIAMOND`, () => {
      const baseDims = {
        patch: '14.1',
        platformRoute: 'na1' as const,
        regionalRoute: 'americas' as const,
        queueId: 420,
        position: fixture.position,
        championId: fixture.championId,
        ...VERSIONS,
      };
      const pending = expandDimensionKeysForRankClassification(
        baseDims,
        classifyParticipantRankForAggregates({ status: 'PENDING' }),
      );
      const diamond = expandDimensionKeysForRankClassification(
        baseDims,
        classifyParticipantRankForAggregates({
          status: 'RESOLVED_RANKED',
          resolvedTier: 'DIAMOND',
        }),
      );
      expect(countTier(pending, ALL_RANK_TIER_SENTINEL)).toBe(1);
      expect(countTier(diamond, ALL_RANK_TIER_SENTINEL)).toBe(1);
      expect(countTier(pending, UNKNOWN_RANK_TIER_SENTINEL)).toBe(0);
      expect(countTier(diamond, 'DIAMOND')).toBeGreaterThan(0);

      // Same ALL-tier key string for the position cell
      const pendingAll = pending.find((k) => {
        const parsed: unknown = JSON.parse(k);
        return Array.isArray(parsed) && parsed[4] === ALL_RANK_TIER_SENTINEL;
      });
      const diamondAll = diamond.find((k) => {
        const parsed: unknown = JSON.parse(k);
        return Array.isArray(parsed) && parsed[4] === ALL_RANK_TIER_SENTINEL;
      });
      expect(pendingAll).toBeDefined();
      expect(diamondAll).toBe(pendingAll);
      const parsedAll: unknown = JSON.parse(pendingAll!);
      expect(Array.isArray(parsedAll) && parsedAll[5]).toBe(fixture.position);
      expect(Array.isArray(parsedAll) && parsedAll[6]).toBe(fixture.championId);
    });
  }
});

describe('expandCurrentDimensionKeys', () => {
  it('builds stable key strings from contributor classification', () => {
    const keys = expandCurrentDimensionKeys([
      {
        base: {
          patch: '14.1',
          platformRoute: 'na1',
          regionalRoute: 'americas',
          queueId: 420,
          position: 'MIDDLE',
          championId: 103,
          ...VERSIONS,
        },
        rankClassification: classifyParticipantRankForAggregates({
          status: 'RESOLVED_RANKED',
          resolvedTier: 'GOLD',
        }),
      },
    ]);
    expect(keys).toContain(
      buildChampionAggregateDimensionKey({
        patch: '14.1',
        platformRoute: 'na1',
        regionalRoute: 'americas',
        queueId: 420,
        rankTier: ALL_RANK_TIER_SENTINEL,
        position: 'MIDDLE',
        championId: 103,
        ...VERSIONS,
      }),
    );
  });
});
