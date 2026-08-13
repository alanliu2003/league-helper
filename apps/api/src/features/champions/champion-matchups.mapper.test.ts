import { describe, expect, it } from 'vitest';
import type { MatchupAggregate } from '@prisma/client';
import type { ChampionStaticRow } from '../../persistence/champion-static.repository';
import { mapMatchupRow, mergeMatchupRowsByOpponent } from './champion-matchups.mapper';

function aggregate(overrides: Partial<MatchupAggregate>): MatchupAggregate {
  return {
    id: 'row',
    patch: '16.15',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    rankTier: 'DIAMOND',
    teamPosition: 'MIDDLE',
    championId: 103,
    opponentChampionId: 1,
    sampleSize: 4,
    wins: 3,
    totalGoldDifferenceAt10: 400,
    goldDifferenceAt10Samples: 4,
    totalGoldDifferenceAt15: null,
    goldDifferenceAt15Samples: 0,
    totalCsDifferenceAt10: null,
    csDifferenceAt10Samples: 0,
    totalCsDifferenceAt15: null,
    csDifferenceAt15Samples: 0,
    soloKills: null,
    firstDeaths: null,
    totalKillDifference: null,
    totalDeathDifference: null,
    totalAssistDifference: null,
    aggregationVersion: '1',
    latestEligibleMatchAt: new Date('2026-08-01T00:00:00.000Z'),
    calculatedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceNormalizationVersion: '1',
    ...overrides,
  };
}

describe('mergeMatchupRowsByOpponent', () => {
  it('sums sampleSize and wins instead of averaging win rates', () => {
    const merged = mergeMatchupRowsByOpponent([
      aggregate({ rankTier: 'DIAMOND', sampleSize: 4, wins: 3 }),
      aggregate({
        id: 'plat',
        rankTier: 'PLATINUM',
        sampleSize: 6,
        wins: 4,
        totalGoldDifferenceAt10: 600,
        goldDifferenceAt10Samples: 6,
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sampleSize).toBe(10);
    expect(merged[0]?.wins).toBe(7);
    expect(merged[0]?.totalGoldDifferenceAt10).toBe(1000);
    expect(merged[0]?.goldDifferenceAt10Samples).toBe(10);
  });
});

describe('mapMatchupRow', () => {
  it('exposes opponent key/name/icon without player identity', () => {
    const opponent: ChampionStaticRow = {
      championId: 134,
      championKey: 'Syndra',
      name: 'Syndra',
      title: 'the Dark Sovereign',
      tags: ['Mage'],
      patchVersion: '16.15.1',
      dataDragonVersion: '16.15.1',
    };
    const media = {
      buildChampionIconUrl: (key: string, version: string) =>
        `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`,
    };
    const row = mapMatchupRow(
      aggregate({
        opponentChampionId: 134,
        sampleSize: 10,
        wins: 4,
        totalGoldDifferenceAt10: null,
        goldDifferenceAt10Samples: 0,
      }),
      opponent,
      media as never,
      { confidenceLevel: 0.95, displayFloor: 10 },
    );
    expect(row.opponent.championKey).toBe('Syndra');
    expect(row.opponent.name).toBe('Syndra');
    expect(row.opponent.iconUrl).toContain('/img/champion/Syndra.png');
    expect(row.wins).toBe(4);
    expect(row.losses).toBe(6);
    expect(row.winRate).toBe(0.4);
    expect(row.lowSample).toBe(true);
    expect(row.averageGoldDifferenceAt10).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/puuid/i);
  });
});
