import { describe, expect, it } from 'vitest';
import {
  CHAMPION_AI_DISCLAIMER,
  CHAMPION_AI_INSIGHT_JOB_NAME,
  CHAMPION_AI_INSIGHT_QUEUE_NAME,
  CHAMPION_AI_PROMPT_VERSION,
  CHAMPION_STATS_DISCLAIMER,
  ChampionAiGroundedClaimSchema,
  ChampionAiInsightsQuerySchema,
  ChampionAiInsightsResponseSchema,
  ChampionAiPublicInsightSchema,
  ChampionAiStoredInsightSchema,
  ChampionBuildsQuerySchema,
  buildChampionAiInsightBullMqJobId,
} from './index';

const SUMMARY_TEXT = 'x'.repeat(80);
const CLAIM_TEXT = 'y'.repeat(40);
const MATCHUP_TEXT = 'z'.repeat(40);
const GENERATED_AT = '2026-08-13T07:00:00.000Z';

const sampleScope = {
  kind: 'COLLECTED_SAMPLE' as const,
  platform: 'na1' as const,
  patch: '16.15',
  queueId: 420,
};

const resolvedFilters = {
  platform: 'na1' as const,
  patch: '16.15',
  queueId: 420,
  tier: 'ALL' as const,
  position: 'MIDDLE' as const,
};

const publicInsight = {
  summary: SUMMARY_TEXT,
  strengths: [CLAIM_TEXT],
  weaknesses: [CLAIM_TEXT],
  buildInsight: CLAIM_TEXT,
  matchupInsights: [
    {
      opponentChampionKey: 'Ahri',
      side: 'STRONG' as const,
      text: MATCHUP_TEXT,
    },
  ],
  generatedAt: GENERATED_AT,
};

const storedInsight = {
  summary: { text: SUMMARY_TEXT, evidence: ['CHAMPION_WIN_RATE'] },
  strengths: [{ text: CLAIM_TEXT, evidence: ['CHAMPION_WIN_RATE'] }],
  weaknesses: [{ text: CLAIM_TEXT, evidence: ['CONFIDENCE_WARNING'] }],
  buildInsight: { text: CLAIM_TEXT, evidence: ['BUILD_CORE_PRIMARY'] },
  matchupInsights: [
    {
      opponentChampionKey: 'Ahri',
      side: 'STRONG' as const,
      text: MATCHUP_TEXT,
      evidence: ['MATCHUP_AHRI'],
    },
  ],
};

describe('ChampionAiInsightsQuerySchema', () => {
  it('reuses ChampionBuildsQuerySchema and requires position', () => {
    expect(ChampionAiInsightsQuerySchema).toBe(ChampionBuildsQuerySchema);
    expect(() => ChampionAiInsightsQuerySchema.parse({})).toThrow();
    expect(ChampionAiInsightsQuerySchema.parse({ position: 'MIDDLE' }).position).toBe('MIDDLE');
  });
});

describe('ChampionAiPublicInsightSchema', () => {
  it('parses a public insight without evidence fields', () => {
    const parsed = ChampionAiPublicInsightSchema.parse(publicInsight);
    expect(parsed.summary).toBe(SUMMARY_TEXT);
    expect(parsed.generatedAt).toBe(GENERATED_AT);
    expect(parsed).not.toHaveProperty('evidence');
    expect(parsed.matchupInsights[0]).not.toHaveProperty('evidence');
    expect(JSON.stringify(parsed)).not.toMatch(/"evidence"/);
  });

  it('strips evidence if a stored-shaped payload is passed', () => {
    const parsed = ChampionAiPublicInsightSchema.parse({
      ...publicInsight,
      evidence: ['CHAMPION_WIN_RATE'],
      matchupInsights: [
        {
          opponentChampionKey: 'Ahri',
          side: 'STRONG',
          text: MATCHUP_TEXT,
          evidence: ['MATCHUP_AHRI'],
        },
      ],
    });
    expect(parsed).not.toHaveProperty('evidence');
    expect(parsed.matchupInsights[0]).not.toHaveProperty('evidence');
  });
});

describe('ChampionAiInsightsResponseSchema', () => {
  it('parses an AVAILABLE envelope with insight and omittable emptyReason', () => {
    const parsed = ChampionAiInsightsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      aiDisclaimer: CHAMPION_AI_DISCLAIMER,
      sampleScope,
      resolvedFilters,
      status: 'AVAILABLE',
      insight: publicInsight,
    });
    expect(parsed.status).toBe('AVAILABLE');
    expect(parsed.emptyReason).toBeUndefined();
    expect(parsed.insight?.summary).toBe(SUMMARY_TEXT);
    expect(parsed.disclaimer).toBe(CHAMPION_STATS_DISCLAIMER);
    expect(parsed.aiDisclaimer).toBe(CHAMPION_AI_DISCLAIMER);
  });

  it('parses PENDING with a null insight and optional emptyReason', () => {
    const parsed = ChampionAiInsightsResponseSchema.parse({
      disclaimer: CHAMPION_STATS_DISCLAIMER,
      aiDisclaimer: CHAMPION_AI_DISCLAIMER,
      sampleScope,
      resolvedFilters,
      status: 'PENDING',
      emptyReason: 'QUEUE_UNAVAILABLE',
      insight: null,
    });
    expect(parsed.insight).toBeNull();
    expect(parsed.emptyReason).toBe('QUEUE_UNAVAILABLE');
  });
});

describe('ChampionAiStoredInsightSchema', () => {
  it('parses a stored insight that keeps evidence', () => {
    const parsed = ChampionAiStoredInsightSchema.parse(storedInsight);
    expect(parsed.summary.evidence).toEqual(['CHAMPION_WIN_RATE']);
    expect(parsed.matchupInsights[0]?.evidence).toEqual(['MATCHUP_AHRI']);
  });

  it('rejects missing evidence, overlong summary, and too many strengths', () => {
    expect(
      ChampionAiGroundedClaimSchema.safeParse({ text: CLAIM_TEXT, evidence: [] }).success,
    ).toBe(false);
    expect(
      ChampionAiStoredInsightSchema.safeParse({
        ...storedInsight,
        summary: { text: SUMMARY_TEXT },
      }).success,
    ).toBe(false);
    expect(
      ChampionAiStoredInsightSchema.safeParse({
        ...storedInsight,
        summary: { text: 'x'.repeat(601), evidence: ['CHAMPION_WIN_RATE'] },
      }).success,
    ).toBe(false);
    expect(
      ChampionAiStoredInsightSchema.safeParse({
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

describe('champion AI shared exports', () => {
  it('re-exports constants, schemas, and job helpers from the package index', () => {
    expect(CHAMPION_AI_DISCLAIMER).toBe(
      'AI explanations are generated from League Helper statistical data and champion ability information.',
    );
    expect(CHAMPION_AI_PROMPT_VERSION).toBe('champion-insight-v1.3');
    expect(CHAMPION_AI_INSIGHT_QUEUE_NAME).toBe('champion-ai-insight');
    expect(CHAMPION_AI_INSIGHT_JOB_NAME).toBe('GENERATE_CHAMPION_AI_INSIGHT');
    expect(buildChampionAiInsightBullMqJobId).toBeTypeOf('function');
  });
});
