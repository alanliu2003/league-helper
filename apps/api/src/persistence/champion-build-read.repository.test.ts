import { describe, expect, it } from 'vitest';
import type { ChampionBuildAggregate } from '@prisma/client';
import { mergeBuildRowsBySignature } from './champion-build-read.repository';

function row(
  overrides: Partial<ChampionBuildAggregate> &
    Pick<ChampionBuildAggregate, 'signature' | 'rankTier'>,
): ChampionBuildAggregate {
  return {
    id: overrides.id ?? `${overrides.rankTier}-${overrides.signature}`,
    patch: '16.15',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    queueId: 420,
    teamPosition: 'MIDDLE',
    championId: 103,
    category: 'BOOTS',
    entityIds: [3006],
    auxIds: [],
    primaryStyleId: null,
    secondaryStyleId: null,
    sampleSize: 5,
    wins: 3,
    eligibleGames: 10,
    aggregationVersion: '1',
    latestEligibleMatchAt: null,
    calculatedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceNormalizationVersion: '1',
    ...overrides,
  };
}

describe('mergeBuildRowsBySignature', () => {
  it('adds sampleSize/wins and uses per-tier eligible pools, not averaged percentages', () => {
    const merged = mergeBuildRowsBySignature(
      [
        row({ signature: '3006', rankTier: 'GOLD', sampleSize: 6, wins: 4, eligibleGames: 10 }),
        row({ signature: '3006', rankTier: 'PLATINUM', sampleSize: 4, wins: 1, eligibleGames: 8 }),
        row({
          signature: '3047',
          rankTier: 'GOLD',
          sampleSize: 4,
          wins: 2,
          eligibleGames: 10,
          entityIds: [3047],
        }),
      ],
      'BOOTS',
    );

    const berserker = merged.find((item) => item.signature === '3006');
    const plated = merged.find((item) => item.signature === '3047');
    expect(berserker).toMatchObject({ sampleSize: 10, wins: 5, eligibleGames: 18 });
    expect(plated).toMatchObject({ sampleSize: 4, wins: 2, eligibleGames: 18 });
    expect(berserker && berserker.wins / berserker.sampleSize).toBe(0.5);
  });
});
