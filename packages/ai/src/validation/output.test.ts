import { describe, expect, it } from 'vitest';
import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionAiStoredInsight,
  ChampionBootRow,
  ChampionCoreBuild,
  ChampionMatchupRow,
  ChampionRuneSetup,
  ChampionSkillOrderRow,
  ChampionSpellPair,
  ChampionStartingItemSet,
} from '@league-helper/shared';
import { buildChampionInsightContext } from '../context/builder';
import { buildEvidenceHandleMapping } from '../context/evidence-handles';
import type { ChampionInsightContext, ChampionInsightContextInput } from '../context/types';
import { ChampionAiInsightValidationError, validateChampionAiInsight } from './output';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function metrics(overrides: Partial<ChampionAggregateMetrics> = {}): ChampionAggregateMetrics {
  return {
    sampleSize: 120,
    wins: 61,
    winRate: 0.512,
    wilsonInterval: {
      lowerBound: 0.42,
      upperBound: 0.6,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'HIGH',
    aggregateKdaRatio: 3.2,
    averageCsPerMinute: 8.4,
    averageDamagePerMinute: 580,
    averageVisionScorePerMinute: 1.1,
    averageGoldPerMinute: 400,
    averageGoldDifferenceAt10: 212,
    averageGoldDifferenceAt15: 150,
    averageCsDifferenceAt10: 3,
    averageCsDifferenceAt15: 5,
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
    sampleSize: 40,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample: false,
    sampleBand,
  };
}

function startingSet(): ChampionStartingItemSet {
  return {
    items: [item(1056, "Doran's Ring"), item(2003, 'Health Potion')],
    sampleSize: 30,
    pickRate: 0.4,
    wins: 16,
    winRate: 0.53,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function bootRow(): ChampionBootRow {
  return {
    item: item(3020, "Sorcerer's Shoes"),
    sampleSize: 30,
    pickRate: 0.6,
    wins: 18,
    winRate: 0.6,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function runePage(): ChampionRuneSetup {
  return {
    keystone: item(8010, 'Conqueror'),
    primaryPerks: [item(9101, 'Absorb Life')],
    secondaryPerks: [item(8226, 'Manaflow Band')],
    statShards: [item(5008, 'Adaptive Force')],
    primaryStyleName: 'Precision',
    secondaryStyleName: 'Sorcery',
    stylesComplete: true,
    sampleSize: 28,
    pickRate: 0.55,
    wins: 16,
    winRate: 0.57,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function spellPair(): ChampionSpellPair {
  return {
    spells: [item(4, 'Flash'), item(14, 'Ignite')],
    sampleSize: 40,
    pickRate: 0.7,
    wins: 22,
    winRate: 0.55,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function skillOrder(): ChampionSkillOrderRow {
  return {
    maxOrder: ['Q', 'W', 'E'],
    levelSequence: ['Q', 'W', 'E', 'Q', 'Q', 'R'],
    sampleSize: 25,
    pickRate: 0.8,
    wins: 14,
    winRate: 0.56,
    lowSample: false,
    sampleBand: 'CREDIBLE',
  };
}

function matchup(
  championKey: string,
  name: string,
  overrides: Partial<Omit<ChampionMatchupRow, 'opponent'>> & { championId?: number } = {},
): ChampionMatchupRow {
  const { championId, ...row } = overrides;
  return {
    opponent: {
      championId: championId ?? 134,
      championKey,
      name,
      iconUrl: 'https://example.com/champ.png',
    },
    position: 'MIDDLE',
    sampleSize: 40,
    wins: 24,
    losses: 16,
    winRate: 0.6,
    wilsonInterval: { lowerBound: 0.44, upperBound: 0.74, confidenceLevel: 0.95 },
    sampleConfidence: 'MEDIUM',
    lowSample: false,
    averageGoldDifferenceAt10: 50,
    averageGoldDifferenceAt15: 90,
    averageCsDifferenceAt10: 2,
    averageCsDifferenceAt15: 4,
    ...row,
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

function performanceInput(
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
      coreBuilds: [
        coreBuild(["Rylai's Crystal Scepter", "Liandry's Torment", "Zhonya's Hourglass"]),
      ],
      startingItems: [startingSet()],
      boots: [bootRow()],
      runes: [runePage()],
      summonerSpells: [spellPair()],
      skillOrder: [skillOrder()],
    },
    matchups: {
      strongAgainst: [matchup('Syndra', 'Syndra', { championId: 134 })],
      weakAgainst: [
        matchup('Yasuo', 'Yasuo', { championId: 157, wins: 14, losses: 26, winRate: 0.35 }),
      ],
    },
    abilities: AHRI_ABILITIES,
    opponentAbilities: [
      {
        championKey: 'Syndra',
        abilities: [
          ability(
            'E',
            'Scatter the Weak',
            'Syndra knocks enemies away and stuns those hitting a dark sphere.',
          ),
        ],
      },
    ],
    ...overrides,
  };
}

const QUALITATIVE_SUMMARY =
  'Ahri looks slightly above even in this collected sample for middle lane, with observed results staying close to even rather than a decisive advantage.';

function validInsight(
  overrides: Partial<ChampionAiStoredInsight> & {
    summaryText?: string;
    summaryEvidence?: string[];
  } = {},
): ChampionAiStoredInsight {
  const { summaryText, summaryEvidence, summary, ...rest } = overrides;
  return {
    summary: summary ?? {
      text: summaryText ?? QUALITATIVE_SUMMARY,
      evidence: summaryEvidence ?? ['CHAMPION_WIN_RATE'],
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

describe('validateChampionAiInsight', () => {
  const context = buildChampionInsightContext(performanceInput());

  it('rejects truncated JSON', () => {
    expectValidationError(
      '{"summary": {"text": "Ahri looks slightly above even"',
      context,
      'PARSE',
    );
  });

  it('accepts JSON wrapped in a single json fence', () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validInsight())}\n\`\`\``;
    const insight = validateChampionAiInsight(fenced, context);
    expect(insight.summary.text).toContain('slightly above even');
  });

  it('rejects a payload with a missing summary', () => {
    const raw = JSON.stringify({
      strengths: [],
      weaknesses: [],
      buildInsight: null,
      matchupInsights: [],
    });
    expectValidationError(raw, context, 'SCHEMA');
  });

  it('includes flattened Zod issue path and message in SCHEMA errors', () => {
    const raw = JSON.stringify({
      strengths: [],
      weaknesses: [],
      buildInsight: null,
      matchupInsights: [],
    });
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('SCHEMA');
    expect(error.message).toMatch(/summary/i);
    expect(error.message).toMatch(/required/i);
    expect(error.message.length).toBeLessThanOrEqual(1500);
  });

  it('includes summary.text bounds in SCHEMA errors for overlong text', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText: 'x'.repeat(5000),
      }),
    );
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('SCHEMA');
    expect(error.message).toContain('summary.text');
    expect(error.message.length).toBeLessThanOrEqual(1500);
  });

  it('rejects five-thousand-character text', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText: 'x'.repeat(5000),
      }),
    );
    expectValidationError(raw, context, 'SCHEMA');
  });

  it('rejects unknown evidence id NOT_A_REAL_ID', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryEvidence: ['NOT_A_REAL_ID'],
      }),
    );
    expectValidationError(raw, context, 'EVIDENCE');
  });

  it('rejects SCOPE_PATCH as the only support for a statistical conclusion', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryEvidence: ['SCOPE_PATCH'],
      }),
    );
    expectValidationError(raw, context, 'EVIDENCE');
  });

  it('rejects opponent key Zed when context only has Syndra', () => {
    const syndraOnly = buildChampionInsightContext(
      performanceInput({
        matchups: {
          strongAgainst: [matchup('Syndra', 'Syndra', { championId: 134 })],
          weakAgainst: [],
        },
        opponentAbilities: [
          {
            championKey: 'Syndra',
            abilities: [
              ability(
                'E',
                'Scatter the Weak',
                'Syndra knocks enemies away and stuns those hitting a dark sphere.',
              ),
            ],
          },
        ],
      }),
    );
    const raw = JSON.stringify(
      validInsight({
        matchupInsights: [
          {
            opponentChampionKey: 'Zed',
            side: 'STRONG',
            text: 'Zed looks like a favorable lane pairing for Ahri in this collected sample.',
            evidence: ['CHAMPION_WIN_RATE'],
          },
        ],
      }),
    );
    expectValidationError(raw, syndraOnly, 'SLICE');
  });

  it('rejects side STRONG for a weak-only opponent', () => {
    const weakOnly = buildChampionInsightContext(
      performanceInput({
        matchups: {
          strongAgainst: [],
          weakAgainst: [
            matchup('Yasuo', 'Yasuo', { championId: 157, wins: 14, losses: 26, winRate: 0.35 }),
          ],
        },
        opponentAbilities: [],
      }),
    );
    const raw = JSON.stringify(
      validInsight({
        matchupInsights: [
          {
            opponentChampionKey: 'Yasuo',
            side: 'STRONG',
            text: 'Yasuo looks like a favorable lane pairing for Ahri in this collected sample.',
            evidence: ['MATCHUP_WEAK_Yasuo'],
          },
        ],
      }),
    );
    expectValidationError(raw, weakOnly, 'SLICE');
  });

  it('rejects HTML script tags', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText: `${QUALITATIVE_SUMMARY} <script>bad</script>`,
      }),
    );
    expectValidationError(raw, context, 'HTML');
  });

  it('rejects 54.8% when context winRate is 0.512', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri sits at 54.8% in this collected sample which would look like a clear edge if numbers were allowed in this prose.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects a correct 51.2% restatement of win rate', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri sits at 51.2% in this collected sample which matches the supplied win rate and still must not appear as digits.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects a correct 51.2 percent restatement of win rate', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri sits at 51.2 percent in this collected sample which matches the supplied win rate and still must not appear as digits.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects digit sample size 120 games', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even across 120 games in this collected sample rather than showing a decisive advantage.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects digit sample size n=8', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even with n=8 in this collected sample rather than showing a decisive advantage overall.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects KDA 3.2 restatement', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even with KDA 3.2 in this collected sample rather than showing a decisive advantage.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects 8.4 CS/min restatement', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even with 8.4 CS/min in this collected sample rather than showing a decisive advantage.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects +212 gold at 10 restatement', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even with +212 gold at 10 in this collected sample rather than showing a decisive advantage.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('accepts qualitative slightly above even in this collected sample', () => {
    const insight = validateChampionAiInsight(JSON.stringify(validInsight()), context);
    expect(insight.summary.text).toContain('slightly above even in this collected sample');
    expect(insight.summary.evidence).toContain('CHAMPION_WIN_RATE');
  });

  it('accepts ability cooldown digits that appear verbatim in supplied ability text', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          summaryText:
            'Charm cooldown 12/11/10 is a notable window, and Ahri looks slightly above even in this collected sample overall.',
        }),
      ),
      context,
    );
    expect(insight.summary.text).toContain('12/11/10');
  });

  it('accepts patch 16.15 when scope.patch is 16.15', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          summaryText:
            'On patch 16.15 Ahri looks slightly above even in this collected sample for middle lane without a decisive advantage.',
        }),
      ),
      context,
    );
    expect(insight.summary.text).toContain('16.15');
  });

  it('accepts platform identity NA1 in prose when scope.platform is na1', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          summaryText:
            'Ahri looks slightly above even in this collected sample across Gold tier matches on NA1 without a decisive advantage.',
        }),
      ),
      context,
    );
    expect(insight.summary.text).toContain('NA1');
  });

  it('still rejects a lone analytics 1 that is not part of the platform label', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even with +1 CS at 10 in this collected sample rather than showing a decisive advantage overall.',
      }),
    );
    expectValidationError(raw, context, 'NUMERIC');
  });

  it('rejects restated gold lead timing windows such as 10 and 15 minutes', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even with a gold lead at 10 and 15 minutes in this collected sample rather than showing a decisive advantage.',
      }),
    );
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('NUMERIC');
    expect(error.details.reason).toBe('UNSUPPORTED_NUMERIC_TOKEN');
    expect(error.details.token).toBe('15');
    expect(error.details.tokenKind).toBe('timing');
  });

  it('rejects by minute 20 as an unsupported analytics timing number', () => {
    const raw = JSON.stringify(
      validInsight({
        summaryText:
          'Ahri looks slightly above even by minute 20 in this collected sample rather than showing a decisive advantage overall.',
      }),
    );
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('NUMERIC');
    expect(error.details.reason).toBe('UNSUPPORTED_NUMERIC_TOKEN');
    expect(error.details.token).toBe('20');
    expect(error.details.tokenKind).toBe('timing');
  });

  it('accepts qualitative early-game checkpoint wording without timing digits', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          summaryText:
            'Ahri looks slightly above even across the early-game checkpoints in this collected sample rather than showing a decisive advantage.',
        }),
      ),
      context,
    );
    expect(insight.summary.text).toContain('across the early-game checkpoints');
  });

  it('accepts qualitative during the early lane wording without timing digits', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          summaryText:
            'Ahri looks slightly above even during the early lane in this collected sample rather than showing a decisive advantage overall.',
        }),
      ),
      context,
    );
    expect(insight.summary.text).toContain('during the early lane');
  });

  it('rejects fabricated ability-only claims when ability handles are not generation-facing', () => {
    const similarCores = buildChampionInsightContext(
      performanceInput({
        matchups: { strongAgainst: [], weakAgainst: [] },
        opponentAbilities: [],
      }),
    );
    const mapping = buildEvidenceHandleMapping(similarCores.evidenceCatalog, similarCores);
    expect(similarCores.matchupExplanationsAllowed).toBe(false);
    expect(mapping.idToHandle.get('ABILITY_Ahri_E')).toBeUndefined();
    expect(similarCores.evidenceCatalog.some((entry) => entry.id === 'ABILITY_Ahri_E')).toBe(true);

    const raw = JSON.stringify(validInsight({ summaryEvidence: ['ABILITY_Ahri_E'] }));
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, similarCores);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('EVIDENCE');
    expect(error.details.reason).toBe('MISSING_STATISTICAL_EVIDENCE');
  });

  it('does not treat evidence-handle digits in prose as analytics numbers', () => {
    const mapping = buildEvidenceHandleMapping(context.evidenceCatalog);
    const handle = mapping.idToHandle.get('CHAMPION_WIN_RATE');
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          summaryText: `${QUALITATIVE_SUMMARY} Supporting handle ${handle}.`,
        }),
      ),
      context,
    );
    expect(insight.summary.text).toContain(handle);
  });

  it('accepts a qualitative summary citing CHAMPION_WIN_RATE with no digits when performance is allowed', () => {
    const insight = validateChampionAiInsight(JSON.stringify(validInsight()), context);
    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
    expect(insight.summary.text).not.toMatch(/\d/);
  });

  it('accepts matchupInsights for an interpretation-allowed STRONG Syndra matchup', () => {
    expect(context.matchups.strongAgainst[0]?.opponentChampionKey).toBe('Syndra');
    expect(context.matchups.strongAgainst[0]?.interpretationAllowed).toBe(true);

    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          matchupInsights: [
            {
              opponentChampionKey: 'Syndra',
              side: 'STRONG',
              text: 'Syndra looks like a favorable lane pairing for Ahri in this collected sample.',
              evidence: ['MATCHUP_STRONG_Syndra'],
            },
          ],
        }),
      ),
      context,
    );

    expect(insight.matchupInsights).toHaveLength(1);
    expect(insight.matchupInsights[0]?.opponentChampionKey).toBe('Syndra');
    expect(insight.matchupInsights[0]?.side).toBe('STRONG');
    expect(insight.matchupInsights[0]?.evidence).toContain('MATCHUP_STRONG_Syndra');
    expect(insight.matchupInsights[0]?.text).not.toMatch(/\d/);
  });

  it('resolves short evidence handles to canonical ids in the stored insight', () => {
    const mapping = buildEvidenceHandleMapping(context.evidenceCatalog);
    const handle = mapping.idToHandle.get('CHAMPION_WIN_RATE');
    expect(handle).toMatch(/^E\d+$/);

    const insight = validateChampionAiInsight(
      JSON.stringify(validInsight({ summaryEvidence: [handle!] })),
      context,
    );
    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
  });

  it('rejects unknown evidence handle E99', () => {
    const mapping = buildEvidenceHandleMapping(context.evidenceCatalog);
    expect(mapping.handleToId.has('E99')).toBe(false);

    const raw = JSON.stringify(validInsight({ summaryEvidence: ['E99'] }));
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('EVIDENCE');
    expect(error.details.reason).toBe('UNKNOWN_EVIDENCE_HANDLE');
    expect(error.details.handle).toBe('E99');
  });

  it('rejects fabricated forbidden canonical evidence even when it has no generation handle', () => {
    const lowSample = buildChampionInsightContext(
      performanceInput({
        stats: metrics({ sampleConfidence: 'INSUFFICIENT' }),
      }),
    );
    const mapping = buildEvidenceHandleMapping(lowSample.evidenceCatalog, lowSample);
    expect(mapping.idToHandle.get('CHAMPION_WIN_RATE')).toBeUndefined();

    const raw = JSON.stringify(validInsight({ summaryEvidence: ['CHAMPION_WIN_RATE'] }));
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, lowSample);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('EVIDENCE');
    expect(error.details.reason).toBe('DISALLOWED_STATISTICAL_EVIDENCE');
    expect(error.details.evidenceId).toBe('CHAMPION_WIN_RATE');
  });

  it('rejects buildInsight that invents item mechanics not supplied in context', () => {
    const raw = JSON.stringify(
      validInsight({
        buildInsight: {
          text: "Rylai's is chosen for its health scaling and Liandry's for consistent magic penetration.",
          evidence: ['BUILD_CORE_PRIMARY'],
        },
      }),
    );
    let thrown: unknown;
    try {
      validateChampionAiInsight(raw, context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChampionAiInsightValidationError);
    const error = thrown as ChampionAiInsightValidationError;
    expect(error.code).toBe('EVIDENCE');
    expect(error.details.reason).toBe('UNSUPPORTED_ITEM_MECHANICS');
  });

  it('accepts buildInsight limited to observed statistical support', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          buildInsight: {
            text: 'The primary core is the stronger-supported option in the current collected sample.',
            evidence: ['BUILD_CORE_PRIMARY'],
          },
        }),
      ),
      context,
    );
    expect(insight.buildInsight?.evidence).toEqual(['BUILD_CORE_PRIMARY']);
    expect(insight.buildInsight?.text).toContain('stronger-supported');
  });

  it('accepts non-causal matchup wording that cites ability text as a plausible explanation', () => {
    const insight = validateChampionAiInsight(
      JSON.stringify(
        validInsight({
          matchupInsights: [
            {
              opponentChampionKey: 'Syndra',
              side: 'STRONG',
              text: "Charm may help explain Ahri's favorable collected-sample pairing into Syndra.",
              evidence: ['MATCHUP_STRONG_Syndra', 'ABILITY_Ahri_E'],
            },
          ],
        }),
      ),
      context,
    );
    expect(insight.matchupInsights[0]?.text).toContain('may help explain');
    expect(insight.matchupInsights[0]?.evidence).toEqual([
      'MATCHUP_STRONG_Syndra',
      'ABILITY_Ahri_E',
    ]);
  });
});
