import { describe, expect, it } from 'vitest';
import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionAiStoredInsight,
  ChampionCoreBuild,
} from '@league-helper/shared';
import { AiOutputValidationError } from '../generation/generate-champion-insight';
import { ChampionAiInsightValidationError } from '../validation/output';
import { AiProviderError } from '../provider/errors';
import type { AiGenerationRawResult, AiGenerationRequest, AiProvider } from '../provider/types';
import type { ChampionInsightEvalFixture } from './fixture-schema';
import { runLiveEval } from './live';

function item(id: number, name: string) {
  return { id, name, iconUrl: 'https://example.com/item.png' };
}

function highMetrics(): ChampionAggregateMetrics {
  return {
    sampleSize: 180,
    wins: 108,
    winRate: 0.6,
    wilsonInterval: { lowerBound: 0.53, upperBound: 0.67, confidenceLevel: 0.95 },
    sampleConfidence: 'HIGH',
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
  };
}

function coreBuild(): ChampionCoreBuild {
  return {
    items: [
      item(3001, "Rylai's Crystal Scepter"),
      item(3002, "Liandry's Torment"),
      item(3003, "Zhonya's Hourglass"),
    ],
    sampleSize: 40,
    pickRate: 0.22,
    wins: 20,
    winRate: 0.5,
    lowSample: false,
    sampleBand: 'CREDIBLE',
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

function emptyBuilds() {
  return {
    coreBuilds: [] as ChampionCoreBuild[],
    startingItems: [],
    boots: [],
    runes: [],
    summonerSpells: [],
    skillOrder: [],
  };
}

function eligibleFixture(): ChampionInsightEvalFixture {
  return {
    id: 'live-eligible',
    expectGenerationEligible: true,
    expectPerformanceConclusionsAllowed: true,
    expectBuildInsightAllowed: true,
    input: {
      champion: { championId: 103, championKey: 'Ahri', name: 'Ahri', position: 'MIDDLE' },
      scope: { patch: '16.15', platform: 'na1', queueId: 420, tier: 'GOLD' },
      stats: highMetrics(),
      builds: { ...emptyBuilds(), coreBuilds: [coreBuild()] },
      matchups: { strongAgainst: [], weakAgainst: [] },
      abilities: [
        ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.'),
      ],
    },
  };
}

function ineligibleFixture(): ChampionInsightEvalFixture {
  return {
    id: 'live-ineligible',
    expectGenerationEligible: false,
    expectPerformanceConclusionsAllowed: false,
    expectBuildInsightAllowed: false,
    input: {
      champion: { championId: 103, championKey: 'Ahri', name: 'Ahri', position: 'MIDDLE' },
      scope: { patch: '16.15', platform: 'na1', queueId: 420, tier: 'UNKNOWN' },
      stats: null,
      builds: emptyBuilds(),
      matchups: { strongAgainst: [], weakAgainst: [] },
      abilities: [
        ability('E', 'Charm', 'Ahri blows a kiss that damages and charms the first enemy hit.'),
      ],
    },
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

class FakeProvider implements AiProvider {
  readonly id = 'fake';
  generateCalls = 0;
  structuredOutputMode: AiGenerationRawResult['structuredOutputMode'] = 'json_schema';

  constructor(
    private readonly handler: (
      request: AiGenerationRequest,
      callIndex: number,
    ) => Promise<string> | string,
  ) {}

  async generate(request: AiGenerationRequest): Promise<AiGenerationRawResult> {
    const content = await this.handler(request, this.generateCalls);
    this.generateCalls += 1;
    return { content, structuredOutputMode: this.structuredOutputMode };
  }
}

function captureWriter() {
  const lines: string[] = [];
  return {
    lines,
    write(line: string) {
      lines.push(line);
    },
    text() {
      return lines.join('\n');
    },
  };
}

describe('live eval harness', () => {
  it('prints live eval skipped and exits 0 when AI_ENABLED is false', async () => {
    const capture = captureWriter();
    const provider = new FakeProvider(() => {
      throw new Error('provider must not be contacted when AI is disabled');
    });

    const result = await runLiveEval({
      env: { AI_ENABLED: 'false' },
      provider,
      fixtures: [eligibleFixture()],
      write: capture.write,
    });

    expect(result.exitCode).toBe(0);
    expect(result.skipped).toBe(true);
    expect(capture.text()).toMatch(/live eval skipped/i);
    expect(provider.generateCalls).toBe(0);
  });

  it('defaults AI_MODEL to the shared 14b product default when unset', async () => {
    const result = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider: new FakeProvider(() => JSON.stringify(validInsight())),
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(result.metrics?.model).toBe('qwen2.5:14b');
  });

  it('uses AI_MODEL when it is set', async () => {
    const result = await runLiveEval({
      env: { AI_ENABLED: 'true', AI_MODEL: 'qwen2.5:32b' },
      provider: new FakeProvider(() => JSON.stringify(validInsight())),
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(result.metrics?.model).toBe('qwen2.5:32b');
  });

  it('increments generated, validation_pass, and json_schema_mode on fake success and skips ineligible fixtures', async () => {
    const capture = captureWriter();
    const provider = new FakeProvider(() => JSON.stringify(validInsight()));

    const result = await runLiveEval({
      env: { AI_ENABLED: 'true', AI_API_KEY: 'secret-test-key-xyz' },
      provider,
      fixtures: [ineligibleFixture(), eligibleFixture()],
      write: capture.write,
    });

    expect(result.skipped).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.metrics?.fixtures).toBe(2);
    expect(result.metrics?.skipped_ineligible).toBe(1);
    expect(result.metrics?.generated).toBe(1);
    expect(result.metrics?.validation_pass).toBe(1);
    expect(result.metrics?.first_pass_validation).toBe(1);
    expect(result.metrics?.repair_used).toBe(0);
    expect(result.metrics?.repair_success).toBe(0);
    expect(result.metrics?.json_schema_mode).toBe(1);
    expect(result.metrics?.json_object_mode).toBe(0);
    expect(result.metrics?.validation_fail).toBe(0);
    expect(result.metrics?.model).toBe('qwen2.5:14b');
    expect(provider.generateCalls).toBe(1);
    expect(capture.text()).toMatch(/live-eligible/);
    expect(capture.text()).toMatch(/live-ineligible/);
    expect(capture.text()).not.toContain('secret-test-key-xyz');
    expect(capture.text()).toMatch(/json_schema_mode/);
    expect(capture.text()).toMatch(/p50_ms/);
    expect(capture.text()).toMatch(/p95_ms/);
  });

  it('maps NUMERIC validation failures separately from EVIDENCE failures', async () => {
    const numericProvider = new FakeProvider(() =>
      JSON.stringify({
        ...validInsight(),
        summary: {
          text: 'Ahri sits at 51.2 percent win rate in this collected sample of middle lane games which looks slightly above even overall.',
          evidence: ['CHAMPION_WIN_RATE'],
        },
      }),
    );
    const evidenceProvider = new FakeProvider(() =>
      JSON.stringify({
        ...validInsight(),
        summary: {
          text: QUALITATIVE_SUMMARY,
          evidence: ['NOT_A_REAL_ID'],
        },
      }),
    );

    const numericResult = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider: numericProvider,
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });
    const evidenceResult = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider: evidenceProvider,
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(numericResult.exitCode).not.toBe(0);
    expect(numericResult.metrics?.validation_fail).toBe(1);
    expect(numericResult.metrics?.terminal_validation_fail).toBe(1);
    expect(numericResult.metrics?.numeric_grounding_fail).toBe(1);
    expect(numericResult.metrics?.evidence_fail).toBe(0);
    expect(numericResult.metrics?.generated).toBe(1);
    expect(numericResult.metrics?.json_schema_mode).toBe(1);
    expect(numericResult.metrics?.validation_pass).toBe(0);

    expect(evidenceResult.exitCode).not.toBe(0);
    expect(evidenceResult.metrics?.validation_fail).toBe(1);
    expect(evidenceResult.metrics?.terminal_validation_fail).toBe(1);
    expect(evidenceResult.metrics?.evidence_fail).toBe(1);
    expect(evidenceResult.metrics?.numeric_grounding_fail).toBe(0);
    expect(evidenceResult.metrics?.generated).toBe(1);
    expect(evidenceResult.metrics?.json_schema_mode).toBe(1);
    expect(evidenceResult.metrics?.validation_pass).toBe(0);
    expect(evidenceResult.metrics?.first_pass_validation).toBe(0);
    expect(evidenceResult.metrics?.repair_used).toBe(1);
    expect(evidenceResult.metrics?.repair_success).toBe(0);
  });

  it('increments retryable_provider_fail without counting a validation_fail', async () => {
    const provider = new FakeProvider(() => {
      throw new AiProviderError('provider timeout', { retryable: true, statusCode: 503 });
    });

    const result = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider,
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.metrics?.retryable_provider_fail).toBe(1);
    expect(result.metrics?.validation_fail).toBe(0);
    expect(result.metrics?.generated).toBe(0);
  });

  it('counts repair_used when the wrapped generate is called twice then succeeds', async () => {
    const provider = new FakeProvider((_request, callIndex) =>
      JSON.stringify(
        callIndex === 0
          ? {
              ...validInsight(),
              summary: { text: QUALITATIVE_SUMMARY, evidence: ['NOT_A_REAL_ID'] },
            }
          : validInsight(),
      ),
    );

    const result = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider,
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(provider.generateCalls).toBe(2);
    expect(result.metrics?.repair_used).toBe(1);
    expect(result.metrics?.repair_success).toBe(1);
    expect(result.metrics?.first_pass_validation).toBe(0);
    expect(result.metrics?.generated).toBe(1);
    expect(result.metrics?.validation_pass).toBe(1);
  });

  it('does not count non-retryable AiProviderError as retryable_provider_fail', async () => {
    const provider = new FakeProvider(() => {
      throw new AiProviderError('unauthorized', { retryable: false, statusCode: 401 });
    });

    const result = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider,
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.metrics?.retryable_provider_fail).toBe(0);
    expect(result.metrics?.validation_fail).toBe(0);
    expect(result.metrics?.generated).toBe(0);
  });

  it('does not treat AiOutputValidationError as a retryable provider failure', async () => {
    const cause = new ChampionAiInsightValidationError('EVIDENCE', 'bad evidence');
    const provider = new FakeProvider(() => {
      throw new AiOutputValidationError('forced', { cause });
    });

    const capture = captureWriter();
    const result = await runLiveEval({
      env: { AI_ENABLED: 'true' },
      provider,
      fixtures: [eligibleFixture()],
      write: capture.write,
    });

    expect(result.metrics?.validation_fail).toBe(1);
    expect(result.metrics?.retryable_provider_fail).toBe(0);
    expect(capture.text()).toContain('Champion AI validation failed');
    expect(capture.text()).toContain('kind=EVIDENCE');
  });
});
