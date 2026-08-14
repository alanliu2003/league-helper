import { describe, expect, it } from 'vitest';
import { CHAMPION_AI_PROMPT_VERSION } from '@league-helper/shared';
import type { ChampionAggregateMetrics } from '@league-helper/shared';
import { buildChampionInsightContext } from './builder';
import { fingerprintChampionInsightContext } from './fingerprint';
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
    averageGoldDifferenceAt10: 80,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function input(stats: ChampionAggregateMetrics = metrics()): ChampionInsightContextInput {
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

const FINGERPRINT_PARAMS = {
  promptVersion: CHAMPION_AI_PROMPT_VERSION,
  model: 'test-model',
  provider: 'test-provider',
} as const;

describe('fingerprintChampionInsightContext', () => {
  it('returns the same sha256 hex for the same context', () => {
    const context = buildChampionInsightContext(input());
    const first = fingerprintChampionInsightContext({ context, ...FINGERPRINT_PARAMS });
    const second = fingerprintChampionInsightContext({ context, ...FINGERPRINT_PARAMS });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });

  it('changes when winRate changes', () => {
    const original = fingerprintChampionInsightContext({
      context: buildChampionInsightContext(input(metrics({ winRate: 0.5417 }))),
      ...FINGERPRINT_PARAMS,
    });
    const changed = fingerprintChampionInsightContext({
      context: buildChampionInsightContext(input(metrics({ winRate: 0.6 }))),
      ...FINGERPRINT_PARAMS,
    });

    expect(changed).not.toBe(original);
  });

  it('changes when the prompt version changes', () => {
    const context = buildChampionInsightContext(input());
    const original = fingerprintChampionInsightContext({ context, ...FINGERPRINT_PARAMS });
    const changed = fingerprintChampionInsightContext({
      context,
      ...FINGERPRINT_PARAMS,
      promptVersion: 'champion-insight-v2',
    });

    expect(changed).not.toBe(original);
  });

  it('changes when the model changes', () => {
    const context = buildChampionInsightContext(input());
    const original = fingerprintChampionInsightContext({ context, ...FINGERPRINT_PARAMS });
    const changed = fingerprintChampionInsightContext({
      context,
      ...FINGERPRINT_PARAMS,
      model: 'other-model',
    });

    expect(changed).not.toBe(original);
  });

  it('does not change when calculatedAt or latestEligibleMatchAt change', () => {
    const baseline = fingerprintChampionInsightContext({
      context: buildChampionInsightContext(input(metrics())),
      ...FINGERPRINT_PARAMS,
    });
    const withCalculatedAt = fingerprintChampionInsightContext({
      context: buildChampionInsightContext(
        input(metrics({ calculatedAt: '2026-08-13T12:00:00.000Z' })),
      ),
      ...FINGERPRINT_PARAMS,
    });
    const withLaterMatch = fingerprintChampionInsightContext({
      context: buildChampionInsightContext(
        input(metrics({ latestEligibleMatchAt: '2026-08-13T18:00:00.000Z' })),
      ),
      ...FINGERPRINT_PARAMS,
    });

    expect(withCalculatedAt).toBe(baseline);
    expect(withLaterMatch).toBe(baseline);
  });

  it('defaults promptVersion to CHAMPION_AI_PROMPT_VERSION', () => {
    const context = buildChampionInsightContext(input());
    const explicit = fingerprintChampionInsightContext({
      context,
      promptVersion: CHAMPION_AI_PROMPT_VERSION,
      model: FINGERPRINT_PARAMS.model,
      provider: FINGERPRINT_PARAMS.provider,
    });
    const implied = fingerprintChampionInsightContext({
      context,
      model: FINGERPRINT_PARAMS.model,
      provider: FINGERPRINT_PARAMS.provider,
    });

    expect(implied).toBe(explicit);
  });
});
