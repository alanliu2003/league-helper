import { describe, expect, it } from 'vitest';
import type {
  PlayerMetricComparison,
  PlayerPlaystyleMetricId,
  PlayerPlaystyleStoredInsight,
} from '@league-helper/shared';
import { buildPlayerPlaystyleContext } from '../context/player-playstyle-builder';
import { buildPlayerPlaystyleEvidenceHandleMapping } from '../context/player-playstyle-evidence';
import type {
  PlayerPlaystyleBuilderInput,
  PlayerPlaystyleBuilderProfile,
} from '../context/player-playstyle-types';
import { PlayerPlaystyleValidationError } from '../validation/player-playstyle-output';
import {
  buildPlayerPlaystyleSystemPrompt,
  buildPlayerPlaystyleUserPrompt,
} from '../prompts/player-playstyle-v1';
import { AiProviderError } from '../provider/errors';
import type { AiGenerationRawResult, AiGenerationRequest, AiProvider } from '../provider/types';
import { PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA } from './stored-player-playstyle.json-schema';
import { AiOutputValidationError, generatePlayerPlaystyle } from './generate-player-playstyle';

function allowedRow(metric: PlayerPlaystyleMetricId): PlayerMetricComparison {
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
  };
}

function profile(): PlayerPlaystyleBuilderProfile {
  return {
    windowSize: 20,
    matchesAnalyzed: 12,
    comparableMatchCount: 12,
    wins: 7,
    playerSampleBand: 'CREDIBLE',
    patchRange: { min: '16.14', max: '16.15' },
    mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 8 }],
    overall: {
      comparisons: [
        allowedRow('CS_PER_MIN'),
        allowedRow('GOLD_PER_MIN'),
        allowedRow('DAMAGE_PER_MIN'),
        allowedRow('KILLS_PER_GAME'),
      ],
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
  };
}

function input(): PlayerPlaystyleBuilderInput {
  return {
    queueId: 420,
    matchIdentity: [{ matchId: 'PRIVACY_MATCH_AAA', participantId: 1 }],
    profile: profile(),
  };
}

const QUALITATIVE_SUMMARY =
  "This player's farming pace is above the matched baseline in the collected ranked sample, with a more farm-oriented profile overall.";
const ECONOMY_TEXT =
  'Farming pace is above the matched baseline relative to similar collected samples.';
const COMBAT_TEXT =
  'Combat damage pace is lower than the matched baseline in this collected sample.';

function validInsight(evidence: string[] = ['OVERALL_CS_PER_MIN']): PlayerPlaystyleStoredInsight {
  return {
    summary: { text: QUALITATIVE_SUMMARY, evidence },
    economy: { text: ECONOMY_TEXT, evidence },
    combat: {
      text: COMBAT_TEXT,
      evidence: evidence[0] === 'OVERALL_CS_PER_MIN' ? ['OVERALL_DAMAGE_PER_MIN'] : evidence,
    },
    strengths: [],
    tradeoffs: [],
    championTendencies: [],
  };
}

function invalidEvidenceInsight(): PlayerPlaystyleStoredInsight {
  return {
    ...validInsight(),
    summary: { text: QUALITATIVE_SUMMARY, evidence: ['NOT_A_REAL_ID'] },
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

describe('generatePlayerPlaystyle', () => {
  const context = buildPlayerPlaystyleContext(input());
  const originalUserPrompt = buildPlayerPlaystyleUserPrompt(context);

  it('accepts valid JSON and stores canonical evidence ids', async () => {
    const mapping = buildPlayerPlaystyleEvidenceHandleMapping(context.evidenceCatalog);
    const csHandle = mapping.idToHandle.get('OVERALL_CS_PER_MIN');
    const dpmHandle = mapping.idToHandle.get('OVERALL_DAMAGE_PER_MIN');
    expect(csHandle).toMatch(/^E\d+$/);
    expect(dpmHandle).toMatch(/^E\d+$/);

    const provider = new FakeProvider(() =>
      JSON.stringify({
        summary: { text: QUALITATIVE_SUMMARY, evidence: [csHandle!] },
        economy: { text: ECONOMY_TEXT, evidence: [csHandle!] },
        combat: { text: COMBAT_TEXT, evidence: [dpmHandle!] },
        strengths: [],
        tradeoffs: [],
        championTendencies: [],
      }),
    );

    const insight = await generatePlayerPlaystyle({
      provider,
      context,
      config: {},
    });

    expect(insight.summary.evidence).toEqual(['OVERALL_CS_PER_MIN']);
    expect(insight.economy?.evidence).toEqual(['OVERALL_CS_PER_MIN']);
    expect(insight.combat?.evidence).toEqual(['OVERALL_DAMAGE_PER_MIN']);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.system).toBe(buildPlayerPlaystyleSystemPrompt());
    expect(provider.requests[0]?.user).toBe(originalUserPrompt);
    expect(provider.requests[0]?.jsonSchema).toEqual(PLAYER_PLAYSTYLE_STORED_INSIGHT_JSON_SCHEMA);
    expect(provider.requests[0]?.user).not.toContain('PRIVACY_MATCH_AAA');
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
      await generatePlayerPlaystyle({
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

  it('throws AiOutputValidationError.retryable false when output stays invalid after repair', async () => {
    const provider = new FakeProvider(() => JSON.stringify(invalidEvidenceInsight()));

    let thrown: unknown;
    try {
      await generatePlayerPlaystyle({
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
    expect(validationError.cause).toBeInstanceOf(PlayerPlaystyleValidationError);
    expect(validationError.cause.code).toBe('EVIDENCE');
    expect(provider.requests).toHaveLength(2);
  });
});
