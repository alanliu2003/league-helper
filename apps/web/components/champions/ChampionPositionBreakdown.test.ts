import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChampionPositionBreakdownEntry } from '@league-helper/shared';
import ChampionPositionBreakdown from './ChampionPositionBreakdown.vue';
import ChampionConfidenceIndicator from './ChampionConfidenceIndicator.vue';

function entries(): ChampionPositionBreakdownEntry[] {
  return [
    { position: 'TOP', dimensions: null, metrics: null },
    { position: 'JUNGLE', dimensions: null, metrics: null },
    {
      position: 'MIDDLE',
      dimensions: null,
      metrics: {
        sampleSize: 50,
        wins: 28,
        winRate: 0.56,
        wilsonInterval: null,
        sampleConfidence: 'LOW',
        aggregateKdaRatio: 3,
        averageCsPerMinute: 8,
        averageDamagePerMinute: 700,
        averageVisionScorePerMinute: 0.8,
        averageGoldDifferenceAt10: 100,
        averageGoldDifferenceAt15: null,
        averageCsDifferenceAt10: 2,
        averageCsDifferenceAt15: null,
        latestEligibleMatchAt: null,
      },
    },
    { position: 'BOTTOM', dimensions: null, metrics: null },
    { position: 'SUPPORT', dimensions: null, metrics: null },
  ];
}

describe('ChampionPositionBreakdown', () => {
  it('renders five roles from one response and marks missing roles as no data', () => {
    const wrapper = mount(ChampionPositionBreakdown, {
      props: { entries: entries(), selectedPosition: 'MIDDLE' },
      global: {
        components: { ChampionsChampionConfidenceIndicator: ChampionConfidenceIndicator },
      },
    });

    expect(wrapper.text()).toContain('Top');
    expect(wrapper.text()).toContain('Jungle');
    expect(wrapper.text()).toContain('Mid');
    expect(wrapper.text()).toContain('Bot');
    expect(wrapper.text()).toContain('Support');
    expect(wrapper.text()).not.toContain('UNKNOWN');
    expect(wrapper.text()).toContain('No data');
    expect(wrapper.text()).toContain('56.0%');
    // Missing roles must not show 0.0%.
    const html = wrapper.html();
    expect(html).not.toMatch(/>0\.0%</);
  });
});
