import { describe, expect, it } from 'vitest';
import type { PlayerMetricComparison, PlayerPlaystyleMetricId } from '@league-helper/shared';
import type { AiGenerationRawResult, AiGenerationRequest, AiProvider } from '../provider/types';
import {
  PlayerPlaystyleEvalFixtureSchema,
  type PlayerPlaystyleEvalFixture,
} from './player-playstyle-fixture-schema';
import { runPlayerPlaystyleLiveEval } from './player-playstyle-live';

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

function eligibleFixture(): PlayerPlaystyleEvalFixture {
  return PlayerPlaystyleEvalFixtureSchema.parse({
    id: 'live-eligible',
    description: 'Injectable eligible fixture for live playstyle skip test',
    expectGenerationEligible: true,
    expectEconomyAllowed: true,
    expectCombatAllowed: true,
    expectSliceChampionKeys: [],
    expectEvidenceNotCitable: [],
    expectOverallCsPlayerValueNull: true,
    expectNoOverallKda: true,
    input: {
      queueId: 420,
      matchIdentity: [{ matchId: 'NA1_LIVE_00000001', participantId: 1 }],
      profile: {
        windowSize: 20,
        matchesAnalyzed: 12,
        comparableMatchCount: 12,
        wins: 7,
        playerSampleBand: 'CREDIBLE',
        patchRange: { min: '16.14', max: '16.15' },
        mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 12 }],
        overall: {
          comparisons: [
            allowedRow('CS_PER_MIN'),
            allowedRow('GOLD_PER_MIN'),
            allowedRow('DAMAGE_PER_MIN'),
          ],
        },
        championSlices: [],
        skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
      },
    },
  });
}

class FakeProvider implements AiProvider {
  readonly id = 'fake';
  generateCalls = 0;

  constructor(
    private readonly handler: (
      request: AiGenerationRequest,
      callIndex: number,
    ) => Promise<string> | string,
  ) {}

  async generate(request: AiGenerationRequest): Promise<AiGenerationRawResult> {
    const content = await this.handler(request, this.generateCalls);
    this.generateCalls += 1;
    return { content, structuredOutputMode: 'json_schema' };
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

describe('player playstyle live eval harness', () => {
  it('prints live eval skipped and exits 0 when AI_ENABLED is false', async () => {
    const capture = captureWriter();
    const provider = new FakeProvider(() => {
      throw new Error('provider must not be contacted when AI is disabled');
    });

    const result = await runPlayerPlaystyleLiveEval({
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
    const result = await runPlayerPlaystyleLiveEval({
      env: { AI_ENABLED: 'true' },
      provider: new FakeProvider(() => '{"not":"valid"}'),
      fixtures: [eligibleFixture()],
      write: () => undefined,
    });

    expect(result.metrics?.model).toBe('qwen2.5:14b');
  });
});
