import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChampionAggregateMetrics } from '@league-helper/shared';
import ChampionSampleOverview from './ChampionSampleOverview.vue';
import ChampionConfidenceIndicator from './ChampionConfidenceIndicator.vue';

function metrics(overrides: Partial<ChampionAggregateMetrics> = {}): ChampionAggregateMetrics {
  return {
    sampleSize: 18,
    wins: 10,
    winRate: 0.542,
    wilsonInterval: {
      lowerBound: 0.31,
      upperBound: 0.76,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'INSUFFICIENT',
    aggregateKdaRatio: 2.1,
    averageCsPerMinute: 6.5,
    averageDamagePerMinute: 500,
    averageVisionScorePerMinute: 0.9,
    averageGoldPerMinute: 400,
    averageGoldDifferenceAt10: null,
    averageGoldDifferenceAt15: null,
    averageCsDifferenceAt10: null,
    averageCsDifferenceAt15: null,
    latestEligibleMatchAt: null,
    ...overrides,
  };
}

function mountOverview(
  props: {
    metrics?: ChampionAggregateMetrics | null;
    emptyReason?: string | null;
    pending?: boolean;
  } = {},
) {
  return mount(ChampionSampleOverview, {
    props: {
      metrics: props.metrics === undefined ? metrics() : props.metrics,
      emptyReason: (props.emptyReason ?? null) as never,
      pending: props.pending,
    },
    global: {
      components: {
        ChampionsChampionConfidenceIndicator: ChampionConfidenceIndicator,
      },
    },
  });
}

describe('ChampionSampleOverview (primary stats)', () => {
  it('shows win rate, games, W–L, and limited sample for insufficient sub-30 metrics', () => {
    const wrapper = mountOverview({
      metrics: metrics({
        sampleSize: 18,
        wins: 10,
        winRate: 0.542,
        sampleConfidence: 'INSUFFICIENT',
      }),
    });

    const text = wrapper.text();
    expect(text).toContain('54.2%');
    expect(text).toMatch(/18\s*games/i);
    expect(text).toMatch(/10\s*[–-]\s*8/);
    expect(text).toMatch(/Limited sample/i);
    expect(text).not.toContain('Not enough collected matches meet the minimum sample size');
    expect(text).not.toMatch(/Pick rate/i);
    expect(text).not.toMatch(/Ban rate/i);
  });

  it('shows stats for sampleSize 30 without limited-sample labeling when confidence is not INSUFFICIENT', () => {
    const wrapper = mountOverview({
      metrics: metrics({
        sampleSize: 30,
        wins: 16,
        winRate: 0.533,
        sampleConfidence: 'LOW',
      }),
    });

    const text = wrapper.text();
    expect(text).toContain('53.3%');
    expect(text).toMatch(/30\s*games/i);
    expect(text).toMatch(/16\s*[–-]\s*14/);
    expect(text).not.toMatch(/Limited sample/i);
    expect(text).not.toContain('INSUFFICIENT');
  });

  it('uses an honest no-data state when exact metrics are missing', () => {
    const wrapper = mountOverview({
      metrics: null,
      emptyReason: 'CHAMPION_HAS_NO_STATS',
    });

    const text = wrapper.text();
    expect(text).not.toMatch(/0\.0%/);
    expect(text).not.toMatch(/^0%/m);
    expect(text).not.toMatch(/0\s*games/i);
    expect(text).not.toMatch(/0\s*[–-]\s*0/);
    expect(wrapper.find('[data-testid="primary-stats-metrics"]').exists()).toBe(false);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('derives W–L from sampleSize and wins with a non-negative guard', () => {
    const wrapper = mountOverview({
      metrics: metrics({
        sampleSize: 18,
        wins: 10,
        sampleConfidence: 'INSUFFICIENT',
      }),
    });
    expect(wrapper.text()).toMatch(/10\s*[–-]\s*8/);

    const inconsistent = mountOverview({
      metrics: metrics({
        sampleSize: 5,
        wins: 8,
        winRate: 1,
        sampleConfidence: 'INSUFFICIENT',
      }),
    });
    expect(inconsistent.text()).toMatch(/8\s*[–-]\s*0/);
  });

  it('shows a local loading state without fabricating metrics', () => {
    const wrapper = mountOverview({
      metrics: null,
      pending: true,
    });

    expect(wrapper.text()).toMatch(/Loading/i);
    expect(wrapper.text()).not.toContain('54.2%');
    expect(wrapper.text()).not.toMatch(/0\.0%/);
  });
});
