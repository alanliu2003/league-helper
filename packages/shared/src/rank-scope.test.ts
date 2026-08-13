import { describe, expect, it } from 'vitest';
import { RankTierSchema } from './ranks';
import { RANK_SEGMENTS } from './rank-segments';
import {
  RankScopeSchema,
  assertProductRankScope,
  exactTiersForRankScope,
  legacyTierFilterToRankScope,
  parseRankScope,
  parseRankScopeCacheToken,
  rankScopeEquals,
  serializeRankScopeCacheToken,
} from './rank-scope';

describe('rank scope contract', () => {
  it('distinguishes ALL from UNKNOWN', () => {
    const all = parseRankScope({ kind: 'ALL' });
    const unknown = parseRankScope({ kind: 'UNKNOWN' });
    expect(rankScopeEquals(all, unknown)).toBe(false);
    expect(serializeRankScopeCacheToken(all)).not.toBe(serializeRankScopeCacheToken(unknown));
  });

  it('distinguishes ALL from HIGH segment', () => {
    const all = parseRankScope({ kind: 'ALL' });
    const high = parseRankScope({ kind: 'SEGMENT', segment: 'HIGH' });
    expect(rankScopeEquals(all, high)).toBe(false);
    expect(serializeRankScopeCacheToken(all)).not.toBe(serializeRankScopeCacheToken(high));
  });

  it('distinguishes HIGH segment from exact DIAMOND', () => {
    const high = parseRankScope({ kind: 'SEGMENT', segment: 'HIGH' });
    const diamond = parseRankScope({ kind: 'EXACT', tier: 'DIAMOND' });
    expect(rankScopeEquals(high, diamond)).toBe(false);
    expect(serializeRankScopeCacheToken(high)).not.toBe(serializeRankScopeCacheToken(diamond));
  });

  it('distinguishes exact GOLD from segment MID', () => {
    const gold = parseRankScope({ kind: 'EXACT', tier: 'GOLD' });
    const mid = parseRankScope({ kind: 'SEGMENT', segment: 'MID' });
    expect(rankScopeEquals(gold, mid)).toBe(false);
    // MID contains only GOLD, but product scopes remain distinct.
    expect(exactTiersForRankScope(mid)).toEqual(['GOLD']);
    expect(exactTiersForRankScope(gold)).toEqual(['GOLD']);
    expect(serializeRankScopeCacheToken(gold)).not.toBe(serializeRankScopeCacheToken(mid));
  });

  it('maps segments to exact tiers without UNKNOWN', () => {
    expect(exactTiersForRankScope({ kind: 'SEGMENT', segment: 'APEX' })).toEqual([
      ...RANK_SEGMENTS.APEX,
    ]);
    expect(exactTiersForRankScope({ kind: 'SEGMENT', segment: 'HIGH' })).toEqual([
      ...RANK_SEGMENTS.HIGH,
    ]);
    expect(exactTiersForRankScope({ kind: 'SEGMENT', segment: 'MID' })).toEqual([
      ...RANK_SEGMENTS.MID,
    ]);
    expect(exactTiersForRankScope({ kind: 'SEGMENT', segment: 'LOW' })).toEqual([
      ...RANK_SEGMENTS.LOW,
    ]);
    for (const segment of ['APEX', 'HIGH', 'MID', 'LOW'] as const) {
      expect(exactTiersForRankScope({ kind: 'SEGMENT', segment })).not.toContain('UNKNOWN');
      expect(exactTiersForRankScope({ kind: 'SEGMENT', segment })).not.toContain('ALL');
    }
  });

  it('rejects invalid tier and segment', () => {
    expect(() => RankScopeSchema.parse({ kind: 'EXACT', tier: 'PLAT' })).toThrow();
    expect(() => RankScopeSchema.parse({ kind: 'SEGMENT', segment: 'ELITE' })).toThrow();
    expect(() => parseRankScope({ kind: 'EXACT', tier: 'UNKNOWN' as 'GOLD' })).toThrow();
  });

  it('rejects unresolved statuses as product exact/segment scopes', () => {
    expect(() =>
      assertProductRankScope({
        kind: 'EXACT',
        tier: 'GOLD',
        // @ts-expect-error intentional invalid shape for runtime guard
        resolutionStatus: 'PENDING',
      }),
    ).toThrow(/product rank scope/i);

    for (const status of ['PENDING', 'FAILED_RETRYABLE', 'FAILED_PERMANENT'] as const) {
      expect(() =>
        assertProductRankScope({
          kind: 'SEGMENT',
          segment: 'HIGH',
          fromResolutionStatus: status,
        } as never),
      ).toThrow(/unresolved|FAILED|product/i);
    }
  });

  it('maps legacy tier filter without changing ALL/UNKNOWN/exact meaning', () => {
    expect(legacyTierFilterToRankScope('ALL')).toEqual({ kind: 'ALL' });
    expect(legacyTierFilterToRankScope('UNKNOWN')).toEqual({ kind: 'UNKNOWN' });
    expect(legacyTierFilterToRankScope('DIAMOND')).toEqual({ kind: 'EXACT', tier: 'DIAMOND' });
    for (const tier of RankTierSchema.options) {
      expect(legacyTierFilterToRankScope(tier)).toEqual({ kind: 'EXACT', tier });
    }
  });

  it('serializes cache tokens deterministically and collision-free for key cases', () => {
    expect(serializeRankScopeCacheToken({ kind: 'ALL' })).toBe('ALL');
    expect(serializeRankScopeCacheToken({ kind: 'UNKNOWN' })).toBe('UNKNOWN');
    expect(serializeRankScopeCacheToken({ kind: 'EXACT', tier: 'GOLD' })).toBe('EXACT:GOLD');
    expect(serializeRankScopeCacheToken({ kind: 'SEGMENT', segment: 'HIGH' })).toBe('SEGMENT:HIGH');

    const tokens = new Set([
      serializeRankScopeCacheToken({ kind: 'ALL' }),
      serializeRankScopeCacheToken({ kind: 'UNKNOWN' }),
      serializeRankScopeCacheToken({ kind: 'SEGMENT', segment: 'HIGH' }),
      serializeRankScopeCacheToken({ kind: 'EXACT', tier: 'DIAMOND' }),
      serializeRankScopeCacheToken({ kind: 'EXACT', tier: 'GOLD' }),
      serializeRankScopeCacheToken({ kind: 'SEGMENT', segment: 'MID' }),
    ]);
    expect(tokens.size).toBe(6);
  });

  it('parses cache tokens back to the same rank scopes', () => {
    expect(parseRankScopeCacheToken('ALL')).toEqual({ kind: 'ALL' });
    expect(parseRankScopeCacheToken('UNKNOWN')).toEqual({ kind: 'UNKNOWN' });
    expect(parseRankScopeCacheToken('EXACT:GOLD')).toEqual({ kind: 'EXACT', tier: 'GOLD' });
    expect(parseRankScopeCacheToken('SEGMENT:HIGH')).toEqual({
      kind: 'SEGMENT',
      segment: 'HIGH',
    });
    expect(() => parseRankScopeCacheToken('FOO')).toThrow(/Invalid rank scope token/);
    expect(() => parseRankScopeCacheToken('EXACT:PLAT')).toThrow();
  });
});
