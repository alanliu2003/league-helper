import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PlayerMetricComparison, PlayerPlaystyleMetricId } from '@league-helper/shared';
import { buildPlayerPlaystyleContext } from '../context/player-playstyle-builder';
import {
  PlayerPlaystyleEvalFixtureSchema,
  type PlayerPlaystyleEvalFixture,
} from './player-playstyle-fixture-schema';
import {
  assertPlayerPlaystyleFixtureExpectations,
  runPlayerPlaystyleOfflineEval,
} from './player-playstyle-offline';
import { getDefaultFixturesDir } from './load-fixtures';

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

function eligibleFixture(
  overrides: Partial<PlayerPlaystyleEvalFixture> = {},
): PlayerPlaystyleEvalFixture {
  return PlayerPlaystyleEvalFixtureSchema.parse({
    id: 'test-eligible-playstyle',
    description: 'Injectable eligible fixture for offline playstyle eval tests',
    expectGenerationEligible: true,
    expectEconomyAllowed: true,
    expectCombatAllowed: true,
    expectSliceChampionKeys: ['Ahri'],
    expectEvidenceNotCitable: [],
    expectOverallCsPlayerValueNull: true,
    expectNoOverallKda: true,
    expectEvidenceContains: ['OVERALL_CS_PER_MIN', 'OVERALL_DAMAGE_PER_MIN'],
    input: {
      queueId: 420,
      playerAccountId: 'player-account-uuid',
      matchIdentity: [{ matchId: 'PRIVACY_MATCH_AAA', participantId: 1 }],
      profile: {
        windowSize: 20,
        matchesAnalyzed: 12,
        comparableMatchCount: 12,
        wins: 7,
        playerSampleBand: 'CREDIBLE',
        patchRange: { min: '16.14', max: '16.15' },
        mix: [{ championKey: 'Ahri', championName: 'Ahri', position: 'MIDDLE', matchCount: 12 }],
        overall: {
          comparisons: OVERALL_METRICS.map((metric) => allowedRow(metric)),
        },
        championSlices: [
          {
            championKey: 'Ahri',
            championName: 'Ahri',
            position: 'MIDDLE',
            matchCount: 12,
            sampleBand: 'CREDIBLE',
            comparisons: [
              allowedRow('CS_PER_MIN', {
                playerValue: 7.4,
                baseline: {
                  value: 6.8,
                  sampleSize: 800,
                  sampleConfidence: 'HIGH',
                  rankTier: 'GOLD',
                  usedAllTierFallback: false,
                },
              }),
              allowedRow('KDA', {
                playerValue: 3.2,
                baseline: {
                  value: 2.8,
                  sampleSize: 800,
                  sampleConfidence: 'HIGH',
                  rankTier: 'GOLD',
                  usedAllTierFallback: false,
                },
                delta: 0.4,
              }),
            ],
          },
        ],
        skipped: { remake: 4, incomplete: 2, unknownPosition: 2, noBaseline: 0 },
      },
    },
    ...overrides,
  });
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

describe('player playstyle offline eval harness', () => {
  it('passes injected fixtures whose expectations match the context builder', async () => {
    const capture = captureWriter();
    const result = await runPlayerPlaystyleOfflineEval({
      fixtures: [eligibleFixture()],
      write: capture.write,
    });

    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(1);
    expect(result.fixtures).toBe(1);
    expect(capture.text().toLowerCase()).toMatch(/offline playstyle eval passed/);
  });

  it('fails with the fixture id when an expectation does not match the builder', () => {
    const fixture = eligibleFixture({
      id: 'mutated-generation-flag',
      expectGenerationEligible: false,
    });
    const context = buildPlayerPlaystyleContext(fixture.input);

    expect(() => assertPlayerPlaystyleFixtureExpectations(fixture, context)).toThrow(
      /mutated-generation-flag/,
    );
  });

  it('rejects invalidModelOutput that contains numeric prose', async () => {
    const fixture = eligibleFixture({
      id: 'numeric-prose',
      invalidModelOutput: {
        summary: {
          text: "This player's farming pace sits at 6.1 CS/min in the collected ranked sample, which looks more farm-oriented than the matched baseline.",
          evidence: ['OVERALL_CS_PER_MIN'],
        },
        economy: {
          text: 'Farming pace is above the matched baseline relative to similar collected samples.',
          evidence: ['OVERALL_CS_PER_MIN'],
        },
        combat: {
          text: 'Combat damage pace is lower than the matched baseline in this collected sample.',
          evidence: ['OVERALL_DAMAGE_PER_MIN'],
        },
        strengths: [],
        tradeoffs: [],
        championTendencies: [],
      },
    });

    const capture = captureWriter();
    const result = await runPlayerPlaystyleOfflineEval({
      fixtures: [fixture],
      write: capture.write,
    });

    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(1);
  });

  it('fails when invalidModelOutput is qualitative and would pass validation', async () => {
    const fixture = eligibleFixture({
      id: 'qualitative-should-fail-eval',
      invalidModelOutput: {
        summary: {
          text: "This player's farming pace is above the matched baseline in the collected ranked sample, with a more farm-oriented profile overall.",
          evidence: ['OVERALL_CS_PER_MIN'],
        },
        economy: {
          text: 'Farming pace is above the matched baseline relative to similar collected samples.',
          evidence: ['OVERALL_CS_PER_MIN'],
        },
        combat: {
          text: 'Combat damage pace is lower than the matched baseline in this collected sample.',
          evidence: ['OVERALL_DAMAGE_PER_MIN'],
        },
        strengths: [],
        tradeoffs: [],
        championTendencies: [],
      },
    });

    const capture = captureWriter();
    const result = await runPlayerPlaystyleOfflineEval({
      fixtures: [fixture],
      write: capture.write,
    });

    expect(result.exitCode).toBe(1);
    expect(capture.text()).toMatch(/qualitative-should-fail-eval/);
  });

  it('does not place player json in the champion fixtures directory', () => {
    const names = readdirSync(getDefaultFixturesDir()).filter((name) => name.endsWith('.json'));
    expect(names.some((name) => name.includes('playstyle'))).toBe(false);
  });

  it('loads committed player playstyle fixtures from disk and asserts every catalog expectation', async () => {
    const capture = captureWriter();
    const result = await runPlayerPlaystyleOfflineEval({ write: capture.write });

    expect(result.exitCode).toBe(0);
    expect(result.fixtures).toBeGreaterThanOrEqual(19);
    expect(result.passed).toBe(result.fixtures);
    expect(capture.text().toLowerCase()).toMatch(/offline playstyle eval passed/);
  });
});
