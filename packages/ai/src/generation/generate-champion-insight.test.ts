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
import type { ChampionInsightContextInput } from '../context/types';
import { ChampionAiInsightValidationError } from '../validation/output';
import { buildChampionInsightSystemPrompt, buildChampionInsightUserPrompt } from '../prompts/champion-insight-v1';
import { AiProviderError } from '../provider/errors';
import type { AiGenerationRawResult, AiGenerationRequest, AiProvider } from '../provider/types';
import { CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA } from './stored-insight.json-schema';
import { AiOutputValidationError, generateChampionInsight } from './generate-champion-insight';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function metrics(): ChampionAggregateMetrics {
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
  };
}

function coreBuild(names: [string, string, string]): ChampionCoreBuild {
  return {
    items: [item(3001, names[0]), item(3002, names[1]), item(3003, names[2])],
    sampleSize: 40,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample: false,
    sampleBand: 'CREDIBLE',
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

function matchup(championKey: string, name: string): ChampionMatchupRow {
  return {
    opponent: {
      championId: 134,
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

function performanceInput(): ChampionInsightContextInput {
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
      strongAgainst: [matchup('Syndra', 'Syndra')],
      weakAgainst: [],
    },
    abilities: [
      ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.'),
    ],
  };
}

const QUALITATIVE_SUMMARY =
  'Ahri looks slightly above even in this collected sample for middle lane, with observed results staying close to even rather than a decisive advantage.';

function validInsight(): ChampionAiStoredInsight {
  return {
    summary: {
      text: QUALITATIVE_SUMMARY,
      evidence: ['CHAMPION_WIN_RATE'],
    },
    strengths: [],
    weaknesses: [],
    buildInsight: null,
    matchupInsights: [],
  };
}

function invalidEvidenceInsight(): ChampionAiStoredInsight {
  return {
    ...validInsight(),
    summary: {
      text: QUALITATIVE_SUMMARY,
      evidence: ['NOT_A_REAL_ID'],
    },
  };
}

class FakeProvider implements AiProvider {
  readonly id = 'fake';
  readonly requests: AiGenerationRequest[] = [];
  structuredOutputMode: AiGenerationRawResult['structuredOutputMode'] = 'json_schema';

  constructor(
    private readonly handler: (
      request: AiGenerationRequest,
      callIndex: number,
    ) => Promise<string> | string,
  ) {}

  async generate(request: AiGenerationRequest): Promise<AiGenerationRawResult> {
    this.requests.push(request);
    const content = await this.handler(request, this.requests.length - 1);
    return {
      content,
      structuredOutputMode: this.structuredOutputMode,
    };
  }
}

describe('generateChampionInsight', () => {
  const context = buildChampionInsightContext(performanceInput());
  const originalUserPrompt = buildChampionInsightUserPrompt(context);

  it('accepts valid qualitative JSON from the provider', async () => {
    const provider = new FakeProvider(() => JSON.stringify(validInsight()));

    const insight = await generateChampionInsight({
      provider,
      context,
      config: {},
    });

    expect(insight.summary.text).toContain('slightly above even');
    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.system).toBe(buildChampionInsightSystemPrompt());
    expect(provider.requests[0]?.user).toBe(originalUserPrompt);
    expect(provider.requests[0]?.temperature).toBe(0.2);
    expect(provider.requests[0]?.maxOutputTokens).toBe(1200);
    expect(provider.requests[0]?.timeoutMs).toBe(60_000);
    expect(provider.requests[0]?.jsonSchema).toEqual(CHAMPION_AI_STORED_INSIGHT_JSON_SCHEMA);
  });

  it('repairs bad evidence on a second generate call', async () => {
    const provider = new FakeProvider((_request, callIndex) =>
      JSON.stringify(callIndex === 0 ? invalidEvidenceInsight() : validInsight()),
    );

    const insight = await generateChampionInsight({
      provider,
      context,
      config: {},
    });

    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.jsonSchema).toEqual(provider.requests[0]?.jsonSchema);
    expect(provider.requests[1]?.user).toContain(originalUserPrompt);
    expect(provider.requests[1]?.user).toMatch(/VALIDATION ERROR/i);
    expect(provider.requests[1]?.user).toMatch(/unknown evidence id/i);
    expect(provider.requests[1]?.user).toContain('evidence handles');
    expect(provider.requests[1]?.user).toMatch(/corrected JSON only/i);
  });

  it('throws AiOutputValidationError when output stays invalid', async () => {
    const provider = new FakeProvider(() => JSON.stringify(invalidEvidenceInsight()));

    let thrown: unknown;
    try {
      await generateChampionInsight({
        provider,
        context,
        config: {},
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiOutputValidationError);
    const validationError = thrown as AiOutputValidationError;
    expect(validationError.retryable).toBe(false);
    expect(validationError.cause).toBeInstanceOf(ChampionAiInsightValidationError);
    expect(provider.requests).toHaveLength(2);
  });

  it('propagates retryable AiProviderError without converting it to validation', async () => {
    const providerError = new AiProviderError('provider unavailable', {
      retryable: true,
      statusCode: 503,
    });
    const provider = new FakeProvider(() => {
      throw providerError;
    });

    let thrown: unknown;
    try {
      await generateChampionInsight({
        provider,
        context,
        config: {},
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(providerError);
    expect(thrown).toBeInstanceOf(AiProviderError);
    expect(thrown).not.toBeInstanceOf(AiOutputValidationError);
    expect((thrown as AiProviderError).retryable).toBe(true);
  });

  it('validates json_object provider output in the generation layer', async () => {
    const provider = new FakeProvider(() => JSON.stringify(validInsight()));
    provider.structuredOutputMode = 'json_object';

    const insight = await generateChampionInsight({
      provider,
      context,
      config: {},
    });

    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
  });

  it('accepts short evidence handles from the model and stores canonical ids', async () => {
    const mapping = buildEvidenceHandleMapping(context.evidenceCatalog);
    const handle = mapping.idToHandle.get('CHAMPION_WIN_RATE');
    const provider = new FakeProvider(() =>
      JSON.stringify({
        ...validInsight(),
        summary: { text: QUALITATIVE_SUMMARY, evidence: [handle!] },
      }),
    );

    const insight = await generateChampionInsight({
      provider,
      context,
      config: {},
    });

    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
    expect(provider.requests[0]?.user).toContain(handle);
    expect(provider.requests[0]?.user).not.toContain('CHAMPION_WIN_RATE');
  });

  it('repairs an unknown handle with a handle-specific instruction', async () => {
    const provider = new FakeProvider((_request, callIndex) =>
      JSON.stringify(
        callIndex === 0
          ? { ...validInsight(), summary: { text: QUALITATIVE_SUMMARY, evidence: ['E99'] } }
          : validInsight(),
      ),
    );

    const insight = await generateChampionInsight({
      provider,
      context,
      config: {},
    });

    expect(insight.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.user).toContain('unknown evidence handle: E99');
    expect(provider.requests[1]?.user).toContain('Use only the evidence handles listed in the input.');
  });
});
