import { describe, expect, it } from 'vitest';
import type { PlayerMetricComparison, PlayerPlaystyleMetricId, PlayerPlaystyleStoredInsight } from '@league-helper/shared';
import { buildPlayerPlaystyleContext } from '../context/player-playstyle-builder';
import { buildPlayerPlaystyleEvidenceHandleMapping } from '../context/player-playstyle-evidence';
import type {
  PlayerPlaystyleBuilderInput,
  PlayerPlaystyleBuilderProfile,
  PlayerPlaystyleInternalContext,
} from '../context/player-playstyle-types';
import {
  PlayerPlaystyleValidationError,
  validatePlayerPlaystyleInsight,
} from './player-playstyle-output';

const SUMMARY_TEXT =
  "This player's farming pace is above the matched baseline in the collected ranked sample, with a more farm-oriented profile overall.";
const ECONOMY_TEXT =
  'Farming pace is above the matched baseline relative to similar collected samples.';
const COMBAT_TEXT =
  'Combat damage pace is lower than the matched baseline in this collected sample.';
const TENDENCY_TEXT =
  'Ahri in middle shows a stronger early-lane profile than the matched champion baseline.';

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

const ECONOMY_METRICS: PlayerPlaystyleMetricId[] = [
  'CS_PER_MIN',
  'GOLD_PER_MIN',
  'VISION_PER_MIN',
  'GOLD_DIFF_AT_10',
  'GOLD_DIFF_AT_15',
  'CS_DIFF_AT_10',
  'CS_DIFF_AT_15',
];

const COMBAT_METRICS: PlayerPlaystyleMetricId[] = [
  'KILLS_PER_GAME',
  'DEATHS_PER_GAME',
  'ASSISTS_PER_GAME',
  'DAMAGE_PER_MIN',
];

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
    mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 8 }],
    overall: {
      comparisons: [...ECONOMY_METRICS, ...COMBAT_METRICS].map((metric) => allowedRow(metric)),
    },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
        sampleBand: 'CREDIBLE',
        comparisons: [allowedRow('CS_PER_MIN'), allowedRow('KDA')],
      },
    ],
    skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
    ...overrides,
  };
}

function input(overrides: Partial<PlayerPlaystyleBuilderInput> = {}): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [{ matchId: 'PRIVACY_MATCH_AAA', participantId: 1 }],
    playerAccountId: 'player-account-uuid',
    profile: baseProfile(),
    ...overrides,
  };
}

function eligibleContext(
  overrides: Partial<PlayerPlaystyleBuilderInput> = {},
): PlayerPlaystyleInternalContext {
  return buildPlayerPlaystyleContext(input(overrides));
}

function validInsight(
  overrides: Partial<PlayerPlaystyleStoredInsight> & {
    summaryText?: string;
    summaryEvidence?: string[];
  } = {},
): PlayerPlaystyleStoredInsight {
  const { summaryText, summaryEvidence, ...rest } = overrides;
  return {
    summary: {
      text: summaryText ?? SUMMARY_TEXT,
      evidence: summaryEvidence ?? ['OVERALL_CS_PER_MIN'],
    },
    economy: { text: ECONOMY_TEXT, evidence: ['OVERALL_CS_PER_MIN'] },
    combat: { text: COMBAT_TEXT, evidence: ['OVERALL_DAMAGE_PER_MIN'] },
    strengths: [],
    tradeoffs: [],
    championTendencies: [],
    ...rest,
  };
}

function expectValidationError(
  raw: string,
  context: PlayerPlaystyleInternalContext,
  code: PlayerPlaystyleValidationError['code'],
  reason?: PlayerPlaystyleValidationError['details']['reason'],
): PlayerPlaystyleValidationError {
  let thrown: unknown;
  try {
    validatePlayerPlaystyleInsight(raw, context);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PlayerPlaystyleValidationError);
  const error = thrown as PlayerPlaystyleValidationError;
  expect(error.code).toBe(code);
  if (reason !== undefined) {
    expect(error.details.reason).toBe(reason);
  }
  return error;
}

describe('validatePlayerPlaystyleInsight', () => {
  const context = eligibleContext();

  it('rejects unknown evidence id NOT_A_REAL_ID', () => {
    expectValidationError(
      JSON.stringify(validInsight({ summaryEvidence: ['NOT_A_REAL_ID'] })),
      context,
      'EVIDENCE',
      'UNKNOWN_EVIDENCE_ID',
    );
  });

  it('rejects unknown evidence handle E99', () => {
    const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);
    expect(mapping.handleToId.has('E99')).toBe(false);

    const error = expectValidationError(
      JSON.stringify(validInsight({ summaryEvidence: ['E99'] })),
      context,
      'EVIDENCE',
      'UNKNOWN_EVIDENCE_HANDLE',
    );
    expect(error.details.handle).toBe('E99');
  });

  it('rejects a statistical claim citing only SCOPE_MIX', () => {
    expectValidationError(
      JSON.stringify(validInsight({ summaryEvidence: ['SCOPE_MIX'] })),
      context,
      'EVIDENCE',
      'MISSING_STATISTICAL_EVIDENCE',
    );
  });

  it('rejects a statistical claim citing only SCOPE_* or CONFIDENCE_WARNING', () => {
    const exploratory = eligibleContext({
      profile: baseProfile({ playerSampleBand: 'EXPLORATORY' }),
    });
    expectValidationError(
      JSON.stringify(validInsight({ summaryEvidence: ['SCOPE_QUEUE', 'SCOPE_PATCH_RANGE'] })),
      context,
      'EVIDENCE',
      'MISSING_STATISTICAL_EVIDENCE',
    );
    expectValidationError(
      JSON.stringify(
        validInsight({ summaryEvidence: ['CONFIDENCE_WARNING', 'SCOPE_MIX'] }),
      ),
      exploratory,
      'EVIDENCE',
      'MISSING_STATISTICAL_EVIDENCE',
    );
  });

  it('rejects economy when outputPolicy.economyAllowed is false', () => {
    const economyBlocked = eligibleContext({
      profile: baseProfile({
        overall: {
          comparisons: [
            ...ECONOMY_METRICS.map((metric) => notComparable(metric)),
            ...COMBAT_METRICS.map((metric) => allowedRow(metric)),
          ],
        },
        championSlices: [],
      }),
    });
    expect(economyBlocked.outputPolicy.economyAllowed).toBe(false);

    expectValidationError(
      JSON.stringify(
        validInsight({
          summaryEvidence: ['OVERALL_DAMAGE_PER_MIN'],
          economy: { text: ECONOMY_TEXT, evidence: ['OVERALL_DAMAGE_PER_MIN'] },
          combat: { text: COMBAT_TEXT, evidence: ['OVERALL_DAMAGE_PER_MIN'] },
        }),
      ),
      economyBlocked,
      'SLICE',
      'ECONOMY_NOT_ALLOWED',
    );
  });

  it('rejects combat when outputPolicy.combatAllowed is false', () => {
    const combatBlocked = eligibleContext({
      profile: baseProfile({
        overall: {
          comparisons: [
            ...ECONOMY_METRICS.map((metric) => allowedRow(metric)),
            ...COMBAT_METRICS.map((metric) => notComparable(metric)),
          ],
        },
      }),
    });
    expect(combatBlocked.outputPolicy.combatAllowed).toBe(false);

    expectValidationError(
      JSON.stringify(
        validInsight({
          combat: { text: COMBAT_TEXT, evidence: ['OVERALL_CS_PER_MIN'] },
        }),
      ),
      combatBlocked,
      'SLICE',
      'COMBAT_NOT_ALLOWED',
    );
  });

  it('rejects championTendencies for an unknown championKey and position', () => {
    expectValidationError(
      JSON.stringify(
        validInsight({
          championTendencies: [
            {
              championKey: 'Jinx',
              position: 'BOTTOM',
              text: TENDENCY_TEXT,
              evidence: ['OVERALL_CS_PER_MIN'],
            },
          ],
        }),
      ),
      context,
      'SLICE',
      'DISALLOWED_CHAMPION_TENDENCY',
    );
  });

  it('rejects championTendencies that do not cite a matching SLICE_* statistical id', () => {
    expectValidationError(
      JSON.stringify(
        validInsight({
          championTendencies: [
            {
              championKey: 'Ahri',
              position: 'MIDDLE',
              text: TENDENCY_TEXT,
              evidence: ['OVERALL_CS_PER_MIN'],
            },
          ],
        }),
      ),
      context,
      'EVIDENCE',
      'MISSING_SLICE_EVIDENCE',
    );
  });

  it('does not allow OVERALL_KDA even if the model emits it', () => {
    const withOverallKda: PlayerPlaystyleInternalContext = {
      ...context,
      evidenceCatalog: [...context.evidenceCatalog, { id: 'OVERALL_KDA', interpretationAllowed: true }],
    };

    expectValidationError(
      JSON.stringify(validInsight({ summaryEvidence: ['OVERALL_KDA'] })),
      withOverallKda,
      'EVIDENCE',
    );
  });

  it('rejects prose containing 6.1', () => {
    const error = expectValidationError(
      JSON.stringify(
        validInsight({
          summaryText:
            "This player's farming pace sits at 6.1 in the collected ranked sample, which looks more farm-oriented than the matched baseline overall.",
        }),
      ),
      context,
      'NUMERIC',
      'UNSUPPORTED_NUMERIC_TOKEN',
    );
    expect(error.details.token).toBe('6.1');
  });

  it('rejects prose containing 7.0', () => {
    const error = expectValidationError(
      JSON.stringify(
        validInsight({
          summaryText:
            'Combat damage pace looks like 7.0 relative to the matched baseline in this collected ranked sample, which is a lower-volume combat profile.',
        }),
      ),
      context,
      'NUMERIC',
      'UNSUPPORTED_NUMERIC_TOKEN',
    );
    expect(error.details.token).toBe('7.0');
  });

  it('allows patch token 14.16 when that patch is in scope.patchRange', () => {
    const patched = eligibleContext({
      profile: baseProfile({ patchRange: { min: '14.16', max: '14.16' } }),
    });
    const insight = validatePlayerPlaystyleInsight(
      JSON.stringify(
        validInsight({
          summaryText:
            'On patch 14.16 this player farming pace is above the matched baseline, with a more farm-oriented profile in the collected sample.',
        }),
      ),
      patched,
    );
    expect(insight.summary.text).toContain('14.16');
  });

  it('rejects HTML tags such as <p>', () => {
    expectValidationError(
      JSON.stringify(
        validInsight({
          summaryText: `<p>${SUMMARY_TEXT}</p>`,
        }),
      ),
      context,
      'HTML',
      'HTML_NOT_ALLOWED',
    );
  });

  it('resolves short evidence handles to canonical ids in the stored insight', () => {
    const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);
    const handle = mapping.idToHandle.get('OVERALL_CS_PER_MIN');
    expect(handle).toMatch(/^E\d+$/);

    const insight = validatePlayerPlaystyleInsight(
      JSON.stringify(
        validInsight({
          summaryEvidence: [handle!],
          economy: { text: ECONOMY_TEXT, evidence: [handle!] },
        }),
      ),
      context,
    );
    expect(insight.summary.evidence).toEqual(['OVERALL_CS_PER_MIN']);
    expect(insight.economy?.evidence).toEqual(['OVERALL_CS_PER_MIN']);
  });

  it('accepts JSON wrapped in a single json fence', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validInsight())}\n\`\`\``;
    const insight = validatePlayerPlaystyleInsight(fenced, context);
    expect(insight.summary.text).toContain('farming pace is above the matched baseline');
  });

  it('accepts a qualitative insight with matching slice evidence for champion tendencies', () => {
    const insight = validatePlayerPlaystyleInsight(
      JSON.stringify(
        validInsight({
          championTendencies: [
            {
              championKey: 'Ahri',
              position: 'MIDDLE',
              text: TENDENCY_TEXT,
              evidence: ['SLICE_Ahri_MIDDLE_CS_PER_MIN'],
            },
          ],
        }),
      ),
      context,
    );
    expect(insight.championTendencies).toHaveLength(1);
    expect(insight.championTendencies[0]?.evidence).toEqual(['SLICE_Ahri_MIDDLE_CS_PER_MIN']);
  });

  it('requires championTendencies to be empty when championTendenciesAllowed is false', () => {
    const noSlices = eligibleContext({
      profile: baseProfile({ championSlices: [] }),
    });
    expect(noSlices.outputPolicy.championTendenciesAllowed).toBe(false);

    expectValidationError(
      JSON.stringify(
        validInsight({
          championTendencies: [
            {
              championKey: 'Ahri',
              position: 'MIDDLE',
              text: TENDENCY_TEXT,
              evidence: ['OVERALL_CS_PER_MIN'],
            },
          ],
        }),
      ),
      noSlices,
      'SLICE',
      'CHAMPION_TENDENCIES_NOT_ALLOWED',
    );
  });
});
