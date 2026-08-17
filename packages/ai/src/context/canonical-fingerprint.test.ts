import { describe, expect, it } from 'vitest';
import type { ChampionAggregateMetrics, PlayerMetricComparison } from '@league-helper/shared';
import { CHAMPION_AI_PROMPT_VERSION, PLAYER_PLAYSTYLE_PROMPT_VERSION } from '@league-helper/shared';
import { buildChampionInsightContext } from './builder';
import { FINGERPRINT_VOLATILE_KEYS, fingerprintCanonicalPayload } from './canonical-fingerprint';
import { fingerprintChampionInsightContext, fingerprintPlayerPlaystyleContext } from './fingerprint';
import { buildPlayerPlaystyleContext } from './player-playstyle-builder';
import type { PlayerPlaystyleBuilderInput } from './player-playstyle-types';
import type { ChampionInsightContextInput } from './types';

function metrics(overrides: Partial<ChampionAggregateMetrics> = {}): ChampionAggregateMetrics {
  return {
    sampleSize: 120,
    wins: 65,
    winRate: 0.5417,
    wilsonInterval: { lowerBound: 0.45, upperBound: 0.63, confidenceLevel: 0.95 },
    sampleConfidence: 'MEDIUM',
    aggregateKdaRatio: 3.1,
    averageCsPerMinute: 7.4,
    averageDamagePerMinute: 580,
    averageVisionScorePerMinute: 1.1,
    averageGoldPerMinute: 400,
    averageGoldDifferenceAt10: 80,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function championInput(stats: ChampionAggregateMetrics = metrics()): ChampionInsightContextInput {
  return {
    champion: { championId: 103, championKey: 'Ahri', name: 'Ahri', position: 'MIDDLE' },
    scope: { patch: '16.15', platform: 'na1', queueId: 420, tier: 'GOLD' },
    stats,
    builds: {
      coreBuilds: [],
      startingItems: [],
      boots: [],
      runes: [],
      summonerSpells: [],
      skillOrder: [],
    },
    matchups: { strongAgainst: [], weakAgainst: [] },
    abilities: [],
  };
}

const CHAMPION_FINGERPRINT_PARAMS = {
  promptVersion: CHAMPION_AI_PROMPT_VERSION,
  model: 'test-model',
  provider: 'test-provider',
} as const;

const PLAYER_FINGERPRINT_PARAMS = {
  promptVersion: PLAYER_PLAYSTYLE_PROMPT_VERSION,
  model: 'test-model',
  provider: 'test-provider',
} as const;

function overallRow(
  metric: PlayerMetricComparison['metric'],
  overrides: Partial<PlayerMetricComparison> = {},
): PlayerMetricComparison {
  return {
    metric,
    playerValue: null,
    baseline: {
      value: null,
      sampleSize: 800,
      sampleConfidence: 'HIGH',
      rankTier: 'GOLD',
      usedAllTierFallback: false,
    },
    delta: 1.2,
    comparableMatchCount: 12,
    direction: 'ABOVE_BASELINE',
    interpretationAllowed: true,
    ...overrides,
  };
}

function playerInput(
  overrides: Partial<PlayerPlaystyleBuilderInput> = {},
): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [
      { matchId: 'NA1_200', participantId: 2 },
      { matchId: 'NA1_100', participantId: 1 },
    ],
    profile: {
      windowSize: 20,
      matchesAnalyzed: 12,
      comparableMatchCount: 12,
      wins: 7,
      playerSampleBand: 'CREDIBLE',
      patchRange: { min: '16.14', max: '16.15' },
      mix: [
        {
          championKey: 'Ahri',
          championName: 'Ahri',
          position: 'MIDDLE',
          matchCount: 12,
        },
      ],
      overall: {
        comparisons: [overallRow('CS_PER_MIN'), overallRow('GOLD_PER_MIN')],
      },
      championSlices: [],
      skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
    },
    ...overrides,
  };
}

describe('fingerprintCanonicalPayload', () => {
  it('includes generatedAt among volatile keys without changing champion hashes', () => {
    expect(FINGERPRINT_VOLATILE_KEYS.has('calculatedAt')).toBe(true);
    expect(FINGERPRINT_VOLATILE_KEYS.has('latestEligibleMatchAt')).toBe(true);
    expect(FINGERPRINT_VOLATILE_KEYS.has('generatedAt')).toBe(true);

    const context = buildChampionInsightContext(championInput());
    const fromChampionHelper = fingerprintChampionInsightContext({
      context,
      ...CHAMPION_FINGERPRINT_PARAMS,
    });
    const fromCanonical = fingerprintCanonicalPayload({
      context,
      ...CHAMPION_FINGERPRINT_PARAMS,
    });
    const withGeneratedAt = fingerprintCanonicalPayload({
      context: { ...context, generatedAt: '2026-08-17T00:00:00.000Z' },
      ...CHAMPION_FINGERPRINT_PARAMS,
    });

    expect(fromChampionHelper).toMatch(/^[a-f0-9]{64}$/);
    expect(fromCanonical).toBe(fromChampionHelper);
    expect(withGeneratedAt).toBe(fromChampionHelper);
  });
});

describe('fingerprintPlayerPlaystyleContext', () => {
  it('defaults promptVersion to PLAYER_PLAYSTYLE_PROMPT_VERSION', () => {
    const context = buildPlayerPlaystyleContext(playerInput());
    const explicit = fingerprintPlayerPlaystyleContext({
      context,
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const implied = fingerprintPlayerPlaystyleContext({
      context,
      model: PLAYER_FINGERPRINT_PARAMS.model,
      provider: PLAYER_FINGERPRINT_PARAMS.provider,
    });

    expect(implied).toBe(explicit);
  });

  it('changes when a comparison direction, delta, or comparable count changes', () => {
    const baseline = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(playerInput()),
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const directionChanged = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(
        playerInput({
          profile: {
            ...playerInput().profile,
            overall: {
              comparisons: [
                overallRow('CS_PER_MIN', { direction: 'BELOW_BASELINE', delta: -1.2 }),
                overallRow('GOLD_PER_MIN'),
              ],
            },
          },
        }),
      ),
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const deltaChanged = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(
        playerInput({
          profile: {
            ...playerInput().profile,
            overall: {
              comparisons: [overallRow('CS_PER_MIN', { delta: 2.4 }), overallRow('GOLD_PER_MIN')],
            },
          },
        }),
      ),
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const countChanged = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(
        playerInput({
          profile: {
            ...playerInput().profile,
            overall: {
              comparisons: [
                overallRow('CS_PER_MIN', { comparableMatchCount: 11 }),
                overallRow('GOLD_PER_MIN'),
              ],
            },
          },
        }),
      ),
      ...PLAYER_FINGERPRINT_PARAMS,
    });

    expect(directionChanged).not.toBe(baseline);
    expect(deltaChanged).not.toBe(baseline);
    expect(countChanged).not.toBe(baseline);
  });

  it('changes when the analyzed matchIdentity set changes', () => {
    const original = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(playerInput()),
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const changed = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(
        playerInput({
          matchIdentity: [
            { matchId: 'NA1_100', participantId: 1 },
            { matchId: 'NA1_300', participantId: 4 },
          ],
        }),
      ),
      ...PLAYER_FINGERPRINT_PARAMS,
    });

    expect(changed).not.toBe(original);
  });

  it('changes when promptVersion, model, or provider change', () => {
    const context = buildPlayerPlaystyleContext(playerInput());
    const original = fingerprintPlayerPlaystyleContext({
      context,
      ...PLAYER_FINGERPRINT_PARAMS,
    });

    expect(
      fingerprintPlayerPlaystyleContext({
        context,
        ...PLAYER_FINGERPRINT_PARAMS,
        promptVersion: 'player-playstyle-v2',
      }),
    ).not.toBe(original);
    expect(
      fingerprintPlayerPlaystyleContext({
        context,
        ...PLAYER_FINGERPRINT_PARAMS,
        model: 'other-model',
      }),
    ).not.toBe(original);
    expect(
      fingerprintPlayerPlaystyleContext({
        context,
        ...PLAYER_FINGERPRINT_PARAMS,
        provider: 'other-provider',
      }),
    ).not.toBe(original);
  });

  it('does not change when generatedAt, calculatedAt, or latestEligibleMatchAt change', () => {
    const context = buildPlayerPlaystyleContext(playerInput());
    const original = fingerprintPlayerPlaystyleContext({
      context,
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const withVolatile = fingerprintCanonicalPayload({
      context: {
        ...context,
        generatedAt: '2026-08-17T12:00:00.000Z',
        calculatedAt: '2026-08-17T12:01:00.000Z',
        latestEligibleMatchAt: '2026-08-16T00:00:00.000Z',
      },
      ...PLAYER_FINGERPRINT_PARAMS,
    });

    expect(withVolatile).toBe(original);
  });

  it('does not hash playerAccountId', () => {
    const withoutAccount = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(playerInput()),
      ...PLAYER_FINGERPRINT_PARAMS,
    });
    const withAccount = fingerprintPlayerPlaystyleContext({
      context: buildPlayerPlaystyleContext(
        playerInput({ playerAccountId: '11111111-2222-3333-4444-555555555555' }),
      ),
      ...PLAYER_FINGERPRINT_PARAMS,
    });

    expect(withAccount).toBe(withoutAccount);
    expect(JSON.stringify(buildPlayerPlaystyleContext(playerInput({ playerAccountId: 'acct-1' })))).not.toContain(
      'acct-1',
    );
  });
});
