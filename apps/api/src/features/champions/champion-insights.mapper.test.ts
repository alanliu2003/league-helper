import { describe, expect, it } from 'vitest';
import {
  CHAMPION_AI_DISCLAIMER,
  CHAMPION_STATS_DISCLAIMER,
  type ChampionAiStoredInsight,
} from '@league-helper/shared';
import { toInsightsResponse, toPublicInsight } from './champion-insights.mapper';

const SUMMARY_TEXT = 'x'.repeat(80);
const CLAIM_TEXT = 'y'.repeat(40);
const MATCHUP_TEXT = 'z'.repeat(40);
const GENERATED_AT = '2026-08-13T07:00:00.000Z';

const stored: ChampionAiStoredInsight = {
  summary: { text: SUMMARY_TEXT, evidence: ['CHAMPION_WIN_RATE'] },
  strengths: [{ text: CLAIM_TEXT, evidence: ['CHAMPION_WIN_RATE'] }],
  weaknesses: [{ text: CLAIM_TEXT, evidence: ['CONFIDENCE_WARNING'] }],
  buildInsight: { text: CLAIM_TEXT, evidence: ['BUILD_CORE_PRIMARY'] },
  matchupInsights: [
    {
      opponentChampionKey: 'Syndra',
      side: 'STRONG',
      text: MATCHUP_TEXT,
      evidence: ['MATCHUP_STRONG_Syndra'],
    },
  ],
};

describe('toPublicInsight', () => {
  it('strips evidence arrays and maps generatedAt to ISO', () => {
    const publicInsight = toPublicInsight(stored, new Date(GENERATED_AT));
    expect(publicInsight.summary).toBe(SUMMARY_TEXT);
    expect(publicInsight.strengths).toEqual([CLAIM_TEXT]);
    expect(publicInsight.weaknesses).toEqual([CLAIM_TEXT]);
    expect(publicInsight.buildInsight).toBe(CLAIM_TEXT);
    expect(publicInsight.matchupInsights).toEqual([
      { opponentChampionKey: 'Syndra', side: 'STRONG', text: MATCHUP_TEXT },
    ]);
    expect(publicInsight.generatedAt).toBe(GENERATED_AT);
    expect(JSON.stringify(publicInsight)).not.toContain('evidence');
  });

  it('maps null buildInsight to null', () => {
    const publicInsight = toPublicInsight({ ...stored, buildInsight: null }, GENERATED_AT);
    expect(publicInsight.buildInsight).toBeNull();
  });
});

describe('toInsightsResponse', () => {
  it('assembles disclaimer constants and omits emptyReason when absent', () => {
    const response = toInsightsResponse({
      status: 'PENDING',
      insight: null,
      sampleScope: { kind: 'COLLECTED_SAMPLE', platform: 'na1', patch: '16.15', queueId: 420 },
      resolvedFilters: {
        platform: 'na1',
        patch: '16.15',
        queueId: 420,
        tier: 'ALL',
        position: 'MIDDLE',
      },
    });
    expect(response.disclaimer).toBe(CHAMPION_STATS_DISCLAIMER);
    expect(response.aiDisclaimer).toBe(CHAMPION_AI_DISCLAIMER);
    expect(response.emptyReason).toBeUndefined();
    expect(response.insight).toBeNull();
  });
});
