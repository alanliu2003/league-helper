import { describe, expect, it } from 'vitest';
import type { PlayerMetricComparison, PlayerPlaystyleMetricId } from '@league-helper/shared';
import { buildPlayerPlaystyleContext } from './player-playstyle-builder';
import { buildPlayerPlaystyleGenerationPayload } from './player-playstyle-evidence';
import type { PlayerPlaystyleBuilderInput, PlayerPlaystyleBuilderProfile } from './player-playstyle-types';

const OVERALL_METRICS: PlayerPlaystyleMetricId[] = [
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'DAMAGE_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
];

function notComparable(metric: PlayerPlaystyleMetricId): PlayerMetricComparison {
  return {
    metric,
    playerValue: null,
    baseline: null,
    delta: null,
    comparableMatchCount: 3,
    direction: 'NOT_COMPARABLE',
    interpretationAllowed: false,
  };
}

function allowedRow(
  metric: PlayerPlaystyleMetricId,
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
    delta: 1.1,
    comparableMatchCount: 12,
    direction: 'ABOVE_BASELINE',
    interpretationAllowed: true,
    ...overrides,
  };
}

function disallowedAbove(metric: PlayerPlaystyleMetricId): PlayerMetricComparison {
  return allowedRow(metric, {
    interpretationAllowed: false,
    comparableMatchCount: 8,
    baseline: {
      value: null,
      sampleSize: 8,
      sampleConfidence: 'INSUFFICIENT',
      rankTier: 'GOLD',
      usedAllTierFallback: true,
    },
  });
}

function baseProfile(
  overrides: Partial<PlayerPlaystyleBuilderProfile> = {},
): PlayerPlaystyleBuilderProfile {
  return {
    windowSize: 20,
    matchesAnalyzed: 12,
    comparableMatchCount: 12,
    wins: 7,
    playerSampleBand: 'CREDIBLE',
    patchRange: { min: '16.14', max: '16.15' },
    mix: [
      { championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 8 },
      { championKey: 'Jinx', championName: 'Jinx', position: 'BOTTOM', matchCount: 4 },
    ],
    overall: {
      comparisons: OVERALL_METRICS.map((metric) => allowedRow(metric)),
    },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
        sampleBand: 'EXPLORATORY',
        comparisons: [
          allowedRow('CS_PER_MIN'),
          allowedRow('KDA', { playerValue: 3.2, baseline: {
            value: 2.8,
            sampleSize: 800,
            sampleConfidence: 'HIGH',
            rankTier: 'GOLD',
            usedAllTierFallback: false,
          }, delta: 0.4 }),
        ],
      },
    ],
    skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
    ...overrides,
  };
}

function input(overrides: Partial<PlayerPlaystyleBuilderInput> = {}): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [
      { matchId: 'PRIVACY_MATCH_BBB', participantId: 6 },
      { matchId: 'PRIVACY_MATCH_AAA', participantId: 3 },
      { matchId: 'PRIVACY_MATCH_AAA', participantId: 1 },
    ],
    profile: baseProfile(),
    ...overrides,
  };
}

describe('buildPlayerPlaystyleContext generationEligible', () => {
  it('is false when every comparison is disallowed and the sample band is INSUFFICIENT', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          comparableMatchCount: 3,
          matchesAnalyzed: 3,
          playerSampleBand: 'INSUFFICIENT',
          overall: { comparisons: OVERALL_METRICS.map((metric) => notComparable(metric)) },
          championSlices: [],
        }),
      }),
    );

    expect(context.generationEligible).toBe(false);
    expect(context.playerSample.generationEligible).toBe(false);
  });

  it('is true when any overall or slice comparison is interpretationAllowed', () => {
    const overallOnly = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          championSlices: [
            {
              championKey: 'Ahri',
              championName: 'Ahri',
              position: 'MIDDLE',
              matchCount: 8,
              sampleBand: 'EXPLORATORY',
              comparisons: [notComparable('KDA'), notComparable('CS_PER_MIN')],
            },
          ],
        }),
      }),
    );
    const sliceOnly = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          overall: { comparisons: OVERALL_METRICS.map((metric) => notComparable(metric)) },
          championSlices: [
            {
              championKey: 'Ahri',
              championName: 'Ahri',
              position: 'MIDDLE',
              matchCount: 8,
              sampleBand: 'EXPLORATORY',
              comparisons: [notComparable('CS_PER_MIN'), allowedRow('KDA')],
            },
          ],
        }),
      }),
    );

    expect(overallOnly.generationEligible).toBe(true);
    expect(sliceOnly.generationEligible).toBe(true);
  });
});

describe('buildPlayerPlaystyleGenerationPayload', () => {
  it('strips numeric delta, playerValue, and nested baseline numbers from mixed-role overall comparisons', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          overall: {
            comparisons: [
              allowedRow('CS_PER_MIN', { delta: 1.4, playerValue: null }),
              allowedRow('GOLD_PER_MIN', { delta: 40, playerValue: null }),
            ],
          },
        }),
      }),
    );
    const payload = buildPlayerPlaystyleGenerationPayload(context);

    expect(context.overall.comparisons[0]?.delta).toBe(1.4);
    expect(payload.subject).toEqual({ label: 'player' });
    for (const row of payload.overall.comparisons) {
      expect(row).not.toHaveProperty('delta');
      expect(row).not.toHaveProperty('playerValue');
      expect(row).not.toHaveProperty('baseline');
      expect(row).not.toHaveProperty('comparableMatchCount');
      expect(row).toEqual(
        expect.objectContaining({
          metric: expect.any(String),
          direction: expect.stringMatching(/BASELINE$/),
          interpretationAllowed: expect.any(Boolean),
          usedAllTierFallback: expect.any(Boolean),
        }),
      );
    }
    expect(JSON.stringify(payload.overall)).not.toMatch(/"value"\s*:/);
  });

  it('omits NOT_COMPARABLE overall rows from the generation payload', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          overall: {
            comparisons: [allowedRow('CS_PER_MIN'), notComparable('DAMAGE_PER_MIN')],
          },
        }),
      }),
    );
    const payload = buildPlayerPlaystyleGenerationPayload(context);

    expect(payload.overall.comparisons.map((row) => row.metric)).toEqual(['CS_PER_MIN']);
  });

  it('omits platform, match ids, playerAccountId, and PUUID-like keys from the generation payload', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        playerAccountId: '11111111-2222-3333-4444-555555555555',
      }),
    );
    const payload = buildPlayerPlaystyleGenerationPayload(context);
    const serialized = JSON.stringify(payload);
    const keys = serialized.match(/"([a-zA-Z]+)"\s*:/g)?.join(' ') ?? '';

    expect(payload.scope).not.toHaveProperty('platform');
    expect(serialized).not.toContain('PRIVACY_MATCH_AAA');
    expect(serialized).not.toContain('PRIVACY_MATCH_BBB');
    expect(serialized).not.toContain('playerAccountId');
    expect(serialized).not.toContain('11111111-2222-3333-4444-555555555555');
    expect(keys.toLowerCase()).not.toMatch(/puuid|externalaccountid|riotid|summonerid/);
    expect(payload).not.toHaveProperty('matchIdentity');
  });

  it('keeps sorted matchIdentity on the internal context only', () => {
    const context = buildPlayerPlaystyleContext(input());

    expect(context.matchIdentity).toEqual([
      { matchId: 'PRIVACY_MATCH_AAA', participantId: 1 },
      { matchId: 'PRIVACY_MATCH_AAA', participantId: 3 },
      { matchId: 'PRIVACY_MATCH_BBB', participantId: 6 },
    ]);
  });

  it('omits integer mix matchCount from generation while keeping counts internally', () => {
    const context = buildPlayerPlaystyleContext(input());
    const payload = buildPlayerPlaystyleGenerationPayload(context);

    expect(context.mix[0]?.matchCount).toBe(8);
    expect(payload.mix[0]).toEqual({
      championKey: 'Ahri',
      championName: 'Ahri',
      position: 'MIDDLE',
    });
    expect(payload.mix[0]).not.toHaveProperty('matchCount');
    expect(JSON.stringify(payload.mix)).not.toContain('matchCount');
  });

  it('omits raw match counts from generation player sample', () => {
    const payload = buildPlayerPlaystyleGenerationPayload(buildPlayerPlaystyleContext(input()));

    expect(payload.playerSample).toEqual({
      playerSampleBand: 'CREDIBLE',
      generationEligible: true,
    });
    expect(payload.playerSample).not.toHaveProperty('matchesAnalyzed');
    expect(payload.playerSample).not.toHaveProperty('comparableMatchCount');
    expect(payload.playerSample).not.toHaveProperty('wins');
  });

  it('includes patch range and ranked solo queue identity without platform', () => {
    const payload = buildPlayerPlaystyleGenerationPayload(buildPlayerPlaystyleContext(input()));

    expect(payload.scope).toEqual({
      queueId: 420,
      queueLabel: 'Ranked Solo/Duo',
      kind: 'COLLECTED_SAMPLE',
      patchRange: { min: '16.14', max: '16.15' },
    });
  });

  it('sets economy, combat, and championTendencies flags from spec §10.4', () => {
    const allAllowed = buildPlayerPlaystyleGenerationPayload(buildPlayerPlaystyleContext(input()));
    const economyOnly = buildPlayerPlaystyleGenerationPayload(
      buildPlayerPlaystyleContext(
        input({
          profile: baseProfile({
            overall: {
              comparisons: [
                allowedRow('CS_PER_MIN'),
                notComparable('KILLS_PER_GAME'),
                notComparable('DEATHS_PER_GAME'),
                notComparable('ASSISTS_PER_GAME'),
                notComparable('DAMAGE_PER_MIN'),
              ],
            },
            championSlices: [],
          }),
        }),
      ),
    );
    const combatOnly = buildPlayerPlaystyleGenerationPayload(
      buildPlayerPlaystyleContext(
        input({
          profile: baseProfile({
            overall: {
              comparisons: [
                allowedRow('KILLS_PER_GAME'),
                notComparable('CS_PER_MIN'),
                notComparable('GOLD_PER_MIN'),
                notComparable('VISION_PER_MIN'),
                notComparable('GOLD_DIFF_AT_10'),
                notComparable('GOLD_DIFF_AT_15'),
                notComparable('CS_DIFF_AT_10'),
                notComparable('CS_DIFF_AT_15'),
              ],
            },
            championSlices: [],
          }),
        }),
      ),
    );
    const tendenciesOnly = buildPlayerPlaystyleGenerationPayload(
      buildPlayerPlaystyleContext(
        input({
          profile: baseProfile({
            overall: { comparisons: OVERALL_METRICS.map((metric) => notComparable(metric)) },
            championSlices: [
              {
                championKey: 'Ahri',
                championName: 'Ahri',
                position: 'MIDDLE',
                matchCount: 8,
                sampleBand: 'EXPLORATORY',
                comparisons: [allowedRow('KDA')],
              },
            ],
          }),
        }),
      ),
    );

    expect(allAllowed.outputPolicy).toEqual({
      economyAllowed: true,
      combatAllowed: true,
      championTendenciesAllowed: true,
    });
    expect(economyOnly.outputPolicy).toEqual({
      economyAllowed: true,
      combatAllowed: false,
      championTendenciesAllowed: false,
    });
    expect(combatOnly.outputPolicy).toEqual({
      economyAllowed: false,
      combatAllowed: true,
      championTendenciesAllowed: false,
    });
    expect(tendenciesOnly.outputPolicy).toEqual({
      economyAllowed: false,
      combatAllowed: false,
      championTendenciesAllowed: true,
    });
  });

  it('does not treat overall KDA as a combat unlock because there is no overall KDA', () => {
    const payload = buildPlayerPlaystyleGenerationPayload(
      buildPlayerPlaystyleContext(
        input({
          profile: baseProfile({
            overall: {
              comparisons: [
                allowedRow('KDA'),
                notComparable('KILLS_PER_GAME'),
                notComparable('DEATHS_PER_GAME'),
                notComparable('ASSISTS_PER_GAME'),
                notComparable('DAMAGE_PER_MIN'),
                notComparable('CS_PER_MIN'),
                notComparable('GOLD_PER_MIN'),
                notComparable('VISION_PER_MIN'),
                notComparable('GOLD_DIFF_AT_10'),
                notComparable('GOLD_DIFF_AT_15'),
                notComparable('CS_DIFF_AT_10'),
                notComparable('CS_DIFF_AT_15'),
              ],
            },
            championSlices: [],
          }),
        }),
      ),
    );

    expect(payload.outputPolicy.combatAllowed).toBe(false);
    expect(payload.outputPolicy.economyAllowed).toBe(false);
  });

  it('includes CONFIDENCE_WARNING when the player sample band is EXPLORATORY or INSUFFICIENT', () => {
    const exploratory = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({ playerSampleBand: 'EXPLORATORY' }),
      }),
    );
    const insufficient = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          playerSampleBand: 'INSUFFICIENT',
          comparableMatchCount: 3,
          overall: { comparisons: OVERALL_METRICS.map((metric) => notComparable(metric)) },
          championSlices: [],
        }),
      }),
    );
    const credible = buildPlayerPlaystyleContext(input());

    for (const context of [exploratory, insufficient]) {
      const warning = context.evidenceCatalog.find((entry) => entry.id === 'CONFIDENCE_WARNING');
      expect(warning).toEqual({ id: 'CONFIDENCE_WARNING', interpretationAllowed: true });
      expect(context.evidenceCatalog.map((entry) => entry.id)).toEqual(
        expect.arrayContaining(['SCOPE_QUEUE', 'SCOPE_PATCH_RANGE', 'SCOPE_MIX']),
      );
    }
    expect(credible.evidenceCatalog.some((entry) => entry.id === 'CONFIDENCE_WARNING')).toBe(false);
  });

  it('does not give generation handles to disallowed ABOVE_BASELINE metrics', () => {
    const context = buildPlayerPlaystyleContext(
      input({
        profile: baseProfile({
          overall: {
            comparisons: [allowedRow('CS_PER_MIN'), disallowedAbove('GOLD_PER_MIN')],
          },
          championSlices: [],
        }),
      }),
    );
    const payload = buildPlayerPlaystyleGenerationPayload(context);

    expect(payload.overall.comparisons.map((row) => row.metric)).toEqual(['CS_PER_MIN', 'GOLD_PER_MIN']);
    expect(payload.overall.comparisons[1]?.interpretationAllowed).toBe(false);
    expect(JSON.stringify(payload.evidence)).not.toMatch(/GOLD_PER_MIN/);
  });
});
