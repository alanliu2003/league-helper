import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  PLAYER_AI_PLAYSTYLE_JOB_NAME,
  PLAYER_AI_PLAYSTYLE_QUEUE_NAME,
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  PLAYER_PLAYSTYLE_PROMPT_VERSION,
  PlayerMetricComparisonSchema,
  PlayerPlaystyleGroundedClaimSchema,
  PlayerPlaystylePublicInsightSchema,
  PlayerPlaystyleResponseSchema,
  PlayerPlaystyleStoredInsightSchema,
  RANK_TIER_SEMANTICS,
  buildPlayerPlaystyleInsightBullMqJobId,
} from './index';

const SUMMARY_TEXT = 'x'.repeat(80);
const CLAIM_TEXT = 'y'.repeat(40);
const TENDENCY_TEXT = 'z'.repeat(40);
const GENERATED_AT = '2026-08-14T07:00:00.000Z';

const comparableComparison = {
  metric: 'CS_PER_MIN' as const,
  playerValue: 7.2,
  baseline: {
    value: 7.0,
    sampleSize: 1000,
    sampleConfidence: 'HIGH' as const,
    rankTier: 'GOLD' as const,
    usedAllTierFallback: false,
  },
  delta: 0.2,
  comparableMatchCount: 12,
  direction: 'NEAR_BASELINE' as const,
  interpretationAllowed: true,
};

const mixedOverallComparison = {
  metric: 'CS_PER_MIN' as const,
  playerValue: null,
  baseline: {
    value: null,
    sampleSize: 800,
    sampleConfidence: 'MEDIUM' as const,
    rankTier: 'ALL' as const,
    usedAllTierFallback: true,
  },
  delta: null,
  comparableMatchCount: 8,
  direction: 'NOT_COMPARABLE' as const,
  interpretationAllowed: false,
};

const sampleScope = {
  kind: 'COLLECTED_SAMPLE' as const,
  queueId: 420,
  matchWindow: 20,
  windowSize: 20,
  matchesAnalyzed: 18,
  comparableMatchCount: 16,
  wins: 10,
  playerSampleBand: 'CREDIBLE' as const,
  patchRange: { min: '16.14', max: '16.15' },
};

const mix = [
  {
    championKey: 'Ahri',
    championName: 'Ahri',
    position: 'MIDDLE' as const,
    matchCount: 8,
  },
];

const championSlices = [
  {
    championKey: 'Ahri',
    championName: 'Ahri',
    position: 'MIDDLE' as const,
    matchCount: 8,
    sampleBand: 'EXPLORATORY' as const,
    comparisons: [
      {
        ...comparableComparison,
        metric: 'KDA' as const,
        playerValue: 3.4,
        delta: 0.2,
      },
    ],
  },
];

const skipped = {
  remake: 1,
  incomplete: 0,
  unknownPosition: 1,
  noBaseline: 0,
};

const publicInsight = {
  summary: SUMMARY_TEXT,
  economy: CLAIM_TEXT,
  combat: CLAIM_TEXT,
  strengths: [CLAIM_TEXT],
  tradeoffs: [CLAIM_TEXT],
  championTendencies: [
    {
      championKey: 'Ahri',
      position: 'MIDDLE' as const,
      text: TENDENCY_TEXT,
    },
  ],
  generatedAt: GENERATED_AT,
};

const storedInsight = {
  summary: { text: SUMMARY_TEXT, evidence: ['OVERALL_CS_PER_MIN'] },
  economy: { text: CLAIM_TEXT, evidence: ['OVERALL_GOLD_PER_MIN'] },
  combat: { text: CLAIM_TEXT, evidence: ['OVERALL_DAMAGE_PER_MIN'] },
  strengths: [{ text: CLAIM_TEXT, evidence: ['OVERALL_CS_PER_MIN'] }],
  tradeoffs: [{ text: CLAIM_TEXT, evidence: ['OVERALL_DEATHS_PER_GAME'] }],
  championTendencies: [
    {
      championKey: 'Ahri',
      position: 'MIDDLE' as const,
      text: TENDENCY_TEXT,
      evidence: ['SLICE_Ahri_MIDDLE_KDA'],
    },
  ],
};

const disabledEnvelope = {
  disclaimer: CHAMPION_STATS_DISCLAIMER,
  aiDisclaimer: PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  rankSemantics: RANK_TIER_SEMANTICS,
  sampleScope,
  mix,
  overall: { comparisons: [comparableComparison] },
  championSlices,
  skipped,
  ai: {
    status: 'DISABLED' as const,
    emptyReason: 'AI_DISABLED' as const,
    insight: null,
  },
};

const availableEnvelope = {
  ...disabledEnvelope,
  overall: { comparisons: [mixedOverallComparison] },
  ai: {
    status: 'AVAILABLE' as const,
    insight: publicInsight,
  },
};

describe('PlayerPlaystyleResponseSchema', () => {
  it('parses a DISABLED envelope with comparisons and a null insight', () => {
    const parsed = PlayerPlaystyleResponseSchema.parse(disabledEnvelope);
    expect(parsed.ai.status).toBe('DISABLED');
    expect(parsed.ai.emptyReason).toBe('AI_DISABLED');
    expect(parsed.ai.insight).toBeNull();
    expect(parsed.overall.comparisons).toHaveLength(1);
    expect(parsed.disclaimer).toBe(CHAMPION_STATS_DISCLAIMER);
    expect(parsed.aiDisclaimer).toBe(PLAYER_PLAYSTYLE_AI_DISCLAIMER);
    expect(parsed.rankSemantics).toBe(RANK_TIER_SEMANTICS);
    expect(parsed.sampleScope.queueId).toBe(420);
    expect(parsed.sampleScope.matchWindow).toBe(20);
  });

  it('parses an AVAILABLE envelope with a public insight and omittable emptyReason', () => {
    const parsed = PlayerPlaystyleResponseSchema.parse(availableEnvelope);
    expect(parsed.ai.status).toBe('AVAILABLE');
    expect(parsed.ai.emptyReason).toBeUndefined();
    expect(parsed.ai.insight?.summary).toBe(SUMMARY_TEXT);
    expect(parsed.overall.comparisons[0]?.playerValue).toBeNull();
  });
});

describe('PlayerMetricComparisonSchema', () => {
  it('accepts null playerValue but rejects a missing playerValue key', () => {
    const parsed = PlayerMetricComparisonSchema.parse({
      ...comparableComparison,
      playerValue: null,
    });
    expect(parsed.playerValue).toBeNull();

    const { playerValue: _omitted, ...withoutKey } = comparableComparison;
    expect(PlayerMetricComparisonSchema.safeParse(withoutKey).success).toBe(false);
  });

  it('rejects unknown metric ids', () => {
    expect(
      PlayerMetricComparisonSchema.safeParse({
        ...comparableComparison,
        metric: 'OVERALL_KDA',
      }).success,
    ).toBe(false);
    expect(
      PlayerMetricComparisonSchema.safeParse({
        ...comparableComparison,
        metric: 'KILL_PARTICIPATION',
      }).success,
    ).toBe(false);
  });

  it('accepts KDA as a slice metric id', () => {
    expect(
      PlayerMetricComparisonSchema.parse({ ...comparableComparison, metric: 'KDA' }).metric,
    ).toBe('KDA');
  });

  it('parses mixed-role overall rows with null playerValue and null baseline.value', () => {
    const parsed = PlayerMetricComparisonSchema.parse(mixedOverallComparison);
    expect(parsed.playerValue).toBeNull();
    expect(parsed.baseline?.value).toBeNull();
    expect(parsed.baseline?.sampleSize).toBe(800);
    expect(parsed.baseline?.sampleConfidence).toBe('MEDIUM');
    expect(parsed.baseline?.rankTier).toBe('ALL');
    expect(parsed.baseline?.usedAllTierFallback).toBe(true);
    expect(parsed.delta).toBeNull();
  });
});

describe('PlayerPlaystylePublicInsightSchema', () => {
  it('parses a public insight without evidence fields', () => {
    const parsed = PlayerPlaystylePublicInsightSchema.parse(publicInsight);
    expect(parsed.summary).toBe(SUMMARY_TEXT);
    expect(parsed.generatedAt).toBe(GENERATED_AT);
    expect(parsed).not.toHaveProperty('evidence');
    expect(parsed.championTendencies[0]).not.toHaveProperty('evidence');
    expect(JSON.stringify(parsed)).not.toMatch(/"evidence"/);
  });

  it('strips evidence if a stored-shaped payload is passed', () => {
    const parsed = PlayerPlaystylePublicInsightSchema.parse({
      ...publicInsight,
      evidence: ['OVERALL_CS_PER_MIN'],
      championTendencies: [
        {
          championKey: 'Ahri',
          position: 'MIDDLE',
          text: TENDENCY_TEXT,
          evidence: ['SLICE_Ahri_MIDDLE_KDA'],
        },
      ],
    });
    expect(parsed).not.toHaveProperty('evidence');
    expect(parsed.championTendencies[0]).not.toHaveProperty('evidence');
    expect(JSON.stringify(parsed)).not.toMatch(/"evidence"/);
  });
});

describe('PlayerPlaystyleStoredInsightSchema', () => {
  it('parses a stored insight that keeps evidence', () => {
    const parsed = PlayerPlaystyleStoredInsightSchema.parse(storedInsight);
    expect(parsed.summary.evidence).toEqual(['OVERALL_CS_PER_MIN']);
    expect(parsed.championTendencies[0]?.evidence).toEqual(['SLICE_Ahri_MIDDLE_KDA']);
  });

  it('rejects empty evidence, overlong summary, and more than three strengths', () => {
    expect(
      PlayerPlaystyleGroundedClaimSchema.safeParse({ text: CLAIM_TEXT, evidence: [] }).success,
    ).toBe(false);
    expect(
      PlayerPlaystyleStoredInsightSchema.safeParse({
        ...storedInsight,
        summary: { text: SUMMARY_TEXT },
      }).success,
    ).toBe(false);
    expect(
      PlayerPlaystyleStoredInsightSchema.safeParse({
        ...storedInsight,
        summary: { text: 'x'.repeat(601), evidence: ['OVERALL_CS_PER_MIN'] },
      }).success,
    ).toBe(false);
    expect(
      PlayerPlaystyleStoredInsightSchema.safeParse({
        ...storedInsight,
        strengths: [
          { text: CLAIM_TEXT, evidence: ['A'] },
          { text: CLAIM_TEXT, evidence: ['B'] },
          { text: CLAIM_TEXT, evidence: ['C'] },
          { text: CLAIM_TEXT, evidence: ['D'] },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('player playstyle shared exports', () => {
  it('re-exports constants, schemas, and job helpers from the package index', () => {
    expect(PLAYER_PLAYSTYLE_AI_DISCLAIMER).toBe(
      'AI playstyle explanations are generated from League Helper statistical comparisons. They do not replace the numbers shown on this page.',
    );
    expect(PLAYER_PLAYSTYLE_PROMPT_VERSION).toBe('player-playstyle-v1');
    expect(PLAYER_AI_PLAYSTYLE_QUEUE_NAME).toBe('player-ai-playstyle');
    expect(PLAYER_AI_PLAYSTYLE_JOB_NAME).toBe('GENERATE_PLAYER_PLAYSTYLE_INSIGHT');
    expect(buildPlayerPlaystyleInsightBullMqJobId).toBeTypeOf('function');
  });
});
