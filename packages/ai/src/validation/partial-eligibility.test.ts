import { describe, expect, it } from 'vitest';
import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionAiStoredInsight,
  ChampionCoreBuild,
} from '@league-helper/shared';
import { buildChampionInsightContext } from '../context/builder';
import type { ChampionInsightContext, ChampionInsightContextInput } from '../context/types';
import { ChampionAiInsightValidationError, validateChampionAiInsight } from './output';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function metrics(overrides: Partial<ChampionAggregateMetrics> = {}): ChampionAggregateMetrics {
  return {
    sampleSize: 8,
    wins: 3,
    winRate: 0.375,
    wilsonInterval: {
      lowerBound: 0.12,
      upperBound: 0.7,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'INSUFFICIENT',
    aggregateKdaRatio: 2.1,
    averageCsPerMinute: 6.2,
    averageDamagePerMinute: 400,
    averageVisionScorePerMinute: 0.8,
    averageGoldDifferenceAt10: 10,
    averageGoldDifferenceAt15: 20,
    averageCsDifferenceAt10: 1,
    averageCsDifferenceAt15: 2,
    latestEligibleMatchAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function coreBuild(
  names: [string, string, string],
  sampleBand: ChampionCoreBuild['sampleBand'] = 'CREDIBLE',
): ChampionCoreBuild {
  return {
    items: [item(3001, names[0]), item(3002, names[1]), item(3003, names[2])],
    sampleSize: sampleBand === 'CREDIBLE' ? 16 : 6,
    pickRate: 0.22,
    wins: 8,
    winRate: 0.5,
    lowSample: false,
    sampleBand,
  };
}

function ability(
  slot: ChampionAbilitySummary['slot'],
  name: string,
  description: string,
): ChampionAbilitySummary {
  return {
    slot,
    name,
    description,
    iconUrl: 'https://example.com/ability.png',
    cooldown: '12/11/10',
    cost: '70/75/80',
    range: '900',
  };
}

const AHRI_ABILITIES: ChampionAbilitySummary[] = [
  ability('PASSIVE', 'Essence Theft', 'Ahri heals when she hits champions with her abilities.'),
  ability(
    'Q',
    'Orb of Deception',
    'Ahri sends out and pulls back her orb, dealing magic then true damage.',
  ),
  ability('W', 'Fox-Fire', 'Ahri releases fox-fires that lock onto nearby enemies.'),
  ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.'),
  ability('R', 'Spirit Rush', 'Ahri dashes and fires essence bolts at nearby enemies.'),
];

function emptyBuilds(): ChampionInsightContextInput['builds'] {
  return {
    coreBuilds: [],
    startingItems: [],
    boots: [],
    runes: [],
    summonerSpells: [],
    skillOrder: [],
  };
}

function partialEligibilityInput(
  overrides: Partial<ChampionInsightContextInput> = {},
): ChampionInsightContextInput {
  return {
    champion: {
      championId: 103,
      championKey: 'Ahri',
      name: 'Ahri',
      position: 'MIDDLE',
    },
    scope: {
      patch: '16.15',
      platform: 'na1',
      queueId: 420,
      tier: 'GOLD',
      kind: 'COLLECTED_SAMPLE',
    },
    stats: metrics(),
    builds: {
      ...emptyBuilds(),
      coreBuilds: [
        coreBuild(
          ["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"],
          'CREDIBLE',
        ),
      ],
    },
    matchups: { strongAgainst: [], weakAgainst: [] },
    abilities: AHRI_ABILITIES,
    opponentAbilities: [],
    ...overrides,
  };
}

const QUALITATIVE_SUMMARY =
  'The primary core build is a commonly observed path in this collected sample, with limited overall performance evidence for Ahri.';

const QUALITATIVE_BUILD =
  'The primary core build is a commonly observed path in this collected sample rather than a proven best choice.';

function validPartialInsight(
  overrides: Partial<ChampionAiStoredInsight> & {
    summaryText?: string;
    summaryEvidence?: string[];
  } = {},
): ChampionAiStoredInsight {
  const { summaryText, summaryEvidence, summary, ...rest } = overrides;
  return {
    summary: summary ?? {
      text: summaryText ?? QUALITATIVE_SUMMARY,
      evidence: summaryEvidence ?? ['BUILD_CORE_PRIMARY', 'CONFIDENCE_WARNING'],
    },
    strengths: [],
    weaknesses: [],
    buildInsight: null,
    matchupInsights: [],
    ...rest,
  };
}

function expectValidationError(
  raw: string,
  context: ChampionInsightContext,
  code: ChampionAiInsightValidationError['code'],
): void {
  let thrown: unknown;
  try {
    validateChampionAiInsight(raw, context);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
  expect((thrown as ChampionAiInsightValidationError).code).toBe(code);
}

describe('validateChampionAiInsight partial eligibility', () => {
  const context = buildChampionInsightContext(partialEligibilityInput());

  it('marks the Task 3 INSUFFICIENT plus CREDIBLE-build fixture as partial', () => {
    expect(context.generationEligible).toBe(true);
    expect(context.performanceConclusionsAllowed).toBe(false);
    expect(context.buildInsightAllowed).toBe(true);
    expect(context.matchupExplanationsAllowed).toBe(false);
    expect(
      context.evidenceCatalog.find((entry) => entry.id === 'CHAMPION_WIN_RATE')
        ?.interpretationAllowed,
    ).toBe(false);
    expect(
      context.evidenceCatalog.find((entry) => entry.id === 'BUILD_CORE_PRIMARY')
        ?.interpretationAllowed,
    ).toBe(true);
  });

  it('accepts buildInsight citing BUILD_CORE_PRIMARY', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validPartialInsight({
          buildInsight: {
            text: QUALITATIVE_BUILD,
            evidence: ['BUILD_CORE_PRIMARY'],
          },
        }),
      ),
      context,
    );
    expect(insight.buildInsight?.evidence).toContain('BUILD_CORE_PRIMARY');
  });

  it('rejects a summary that cites CHAMPION_WIN_RATE', () => {
    const raw = JSON.stringify(
      validPartialInsight({
        summaryEvidence: ['CHAMPION_WIN_RATE'],
      }),
    );
    expectValidationError(raw, context, 'EVIDENCE');
  });

  it('rejects strengths that cite CHAMPION_WIN_RATE', () => {
    const raw = JSON.stringify(
      validPartialInsight({
        strengths: [
          {
            text: 'Ahri looks like a winning pick in this collected sample of middle lane games.',
            evidence: ['CHAMPION_WIN_RATE'],
          },
        ],
      }),
    );
    expectValidationError(raw, context, 'EVIDENCE');
  });

  it('accepts a summary citing BUILD_CORE_PRIMARY and CONFIDENCE_WARNING with no performance statistical ids', () => {
    const insight = validateChampionAiInsight(JSON.stringify(validPartialInsight()), context);
    expect(insight.summary.evidence).toEqual(['BUILD_CORE_PRIMARY', 'CONFIDENCE_WARNING']);
    expect(insight.summary.evidence).not.toContain('CHAMPION_WIN_RATE');
  });

  it('rejects matchupInsights when no allowed matchups exist', () => {
    const raw = JSON.stringify(
      validPartialInsight({
        matchupInsights: [
          {
            opponentChampionKey: 'Syndra',
            side: 'STRONG',
            text: 'Syndra looks like a favorable lane pairing for Ahri in this collected sample.',
            evidence: ['BUILD_CORE_PRIMARY'],
          },
        ],
      }),
    );
    expectValidationError(raw, context, 'SLICE');
  });

  it('rejects ability-only evidence as the sole support for a statistical conclusion', () => {
    const raw = JSON.stringify(
      validPartialInsight({
        summaryEvidence: ['ABILITY_Ahri_E'],
      }),
    );
    expectValidationError(raw, context, 'EVIDENCE');
  });
});
