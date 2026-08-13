import { describe, expect, it } from 'vitest';
import {
  attachEligibleGames,
  recordBuildContribution,
  type BuildAggregateScratch,
} from './build-accumulation';
import type { MaterializedChampionDimensions } from '@league-helper/match-analytics';

const dims: MaterializedChampionDimensions = {
  patch: '16.15',
  platformRoute: 'na1',
  regionalRoute: 'americas',
  queueId: 420,
  rankTier: 'ALL',
  position: 'MIDDLE',
  championId: 103,
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
};

describe('build accumulation', () => {
  it('adds sampleSize and wins without averaging percentages', () => {
    const scratch: BuildAggregateScratch = { rows: new Map(), pools: new Map() };
    recordBuildContribution(scratch, {
      dims,
      category: 'BOOTS',
      signature: '3006',
      entityIds: [3006],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: true,
      matchEndedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    recordBuildContribution(scratch, {
      dims,
      category: 'BOOTS',
      signature: '3006',
      entityIds: [3006],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: false,
      matchEndedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    recordBuildContribution(scratch, {
      dims,
      category: 'BOOTS',
      signature: '3047',
      entityIds: [3047],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: true,
      matchEndedAt: null,
    });

    const rows = attachEligibleGames(scratch);
    const berserker = rows.find((row) => row.signature === '3006');
    const plated = rows.find((row) => row.signature === '3047');
    expect(berserker).toMatchObject({ sampleSize: 2, wins: 1, eligibleGames: 3 });
    expect(plated).toMatchObject({ sampleSize: 1, wins: 1, eligibleGames: 3 });
  });

  it('keeps SKILL_PRIORITY and SKILL_SEQUENCE eligible pools independent', () => {
    const scratch: BuildAggregateScratch = { rows: new Map(), pools: new Map() };
    recordBuildContribution(scratch, {
      dims,
      category: 'SKILL_SEQUENCE',
      signature: 'E-W-Q',
      entityIds: [3, 2, 1],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: true,
      matchEndedAt: null,
    });
    recordBuildContribution(scratch, {
      dims,
      category: 'SKILL_SEQUENCE',
      signature: 'Q-W-E',
      entityIds: [1, 2, 3],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: false,
      matchEndedAt: null,
    });
    recordBuildContribution(scratch, {
      dims,
      category: 'SKILL_PRIORITY',
      signature: 'W>E>Q',
      entityIds: [2, 3, 1],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: true,
      matchEndedAt: null,
    });

    const rows = attachEligibleGames(scratch);
    expect(
      rows.find((row) => row.category === 'SKILL_SEQUENCE' && row.signature === 'E-W-Q'),
    ).toMatchObject({ sampleSize: 1, eligibleGames: 2 });
    expect(rows.find((row) => row.category === 'SKILL_PRIORITY')).toMatchObject({
      sampleSize: 1,
      eligibleGames: 1,
    });
  });

  it('is idempotent for the same contributions replayed into a fresh scratch', () => {
    const first: BuildAggregateScratch = { rows: new Map(), pools: new Map() };
    const second: BuildAggregateScratch = { rows: new Map(), pools: new Map() };
    const contribution = {
      dims,
      category: 'SUMMONER_SPELLS' as const,
      signature: '4-12',
      entityIds: [4, 12],
      auxIds: [],
      primaryStyleId: null,
      secondaryStyleId: null,
      won: true,
      matchEndedAt: null,
    };
    recordBuildContribution(first, contribution);
    recordBuildContribution(second, contribution);
    expect(attachEligibleGames(first)).toEqual(attachEligibleGames(second));
  });
});
