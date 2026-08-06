import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChampionAggregateMetrics } from '@league-helper/shared';
import ChampionPerformanceCards from './ChampionPerformanceCards.vue';

function metrics(overrides: Partial<ChampionAggregateMetrics> = {}): ChampionAggregateMetrics {
  return {
    sampleSize: 40,
    wins: 22,
    winRate: 0.55,
    wilsonInterval: {
      lowerBound: 0.4,
      upperBound: 0.7,
      confidenceLevel: 0.95,
    },
    sampleConfidence: 'LOW',
    aggregateKdaRatio: 2.5,
    averageCsPerMinute: 7.2,
    averageDamagePerMinute: 600,
    averageVisionScorePerMinute: 1.1,
    averageGoldDifferenceAt10: null,
    averageGoldDifferenceAt15: null,
    averageCsDifferenceAt10: null,
    averageCsDifferenceAt15: null,
    latestEligibleMatchAt: null,
    ...overrides,
  };
}

describe('ChampionPerformanceCards', () => {
  it('shows Unavailable for missing timeline metrics instead of zeros', () => {
    const wrapper = mount(ChampionPerformanceCards, {
      props: { metrics: metrics() },
      global: {
        stubs: {
          ChampionsChampionConfidenceIndicator: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Unavailable');
    expect(wrapper.text()).toContain('Timeline metric unavailable');
    // Present finite metrics still render.
    expect(wrapper.text()).toContain('2.50');
    expect(wrapper.text()).toContain('7.20');
    // Must not invent timeline zeros.
    const gdBlocks = wrapper.text();
    expect(gdBlocks).not.toMatch(/GD@10\s*0(\.0+)?(?!\d)/);
  });

  it('does not render internal identifiers', () => {
    const wrapper = mount(ChampionPerformanceCards, {
      props: { metrics: metrics() },
    });
    expect(wrapper.html().toLowerCase()).not.toContain('puuid');
  });
});
