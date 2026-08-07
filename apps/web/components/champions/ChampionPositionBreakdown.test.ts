import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChampionPositionBreakdownEntry } from '@league-helper/shared';
import ChampionPositionBreakdown from './ChampionPositionBreakdown.vue';
import ChampionConfidenceIndicator from './ChampionConfidenceIndicator.vue';

function baseMetrics(
  overrides: Partial<NonNullable<ChampionPositionBreakdownEntry['metrics']>> = {},
): NonNullable<ChampionPositionBreakdownEntry['metrics']> {
  return {
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
    ...overrides,
  };
}

function fiveRoles(
  overrides: Partial<
    Record<ChampionPositionBreakdownEntry['position'], ChampionPositionBreakdownEntry['metrics']>
  > = {},
): ChampionPositionBreakdownEntry[] {
  const order = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'] as const;
  return order.map((position) => ({
    position,
    dimensions: null,
    metrics: overrides[position] === undefined ? null : overrides[position],
  }));
}

function mountBreakdown(
  props: {
    entries?: ChampionPositionBreakdownEntry[];
    selectedPosition?: ChampionPositionBreakdownEntry['position'] | null;
  } = {},
) {
  return mount(ChampionPositionBreakdown, {
    props: {
      entries: props.entries ?? fiveRoles({ MIDDLE: baseMetrics() }),
      selectedPosition: props.selectedPosition ?? 'MIDDLE',
    },
    global: {
      components: { ChampionsChampionConfidenceIndicator: ChampionConfidenceIndicator },
    },
  });
}

describe('ChampionPositionBreakdown', () => {
  it('renders the five canonical positions in stable order', () => {
    const wrapper = mountBreakdown({
      entries: fiveRoles({
        MIDDLE: baseMetrics(),
        SUPPORT: baseMetrics({
          sampleSize: 8,
          wins: 3,
          winRate: 0.375,
          sampleConfidence: 'INSUFFICIENT',
        }),
      }),
    });

    const text = wrapper.text();
    const top = text.indexOf('Top');
    const jungle = text.indexOf('Jungle');
    const mid = text.indexOf('Mid');
    const bot = text.indexOf('Bot');
    const support = text.indexOf('Support');

    expect(top).toBeGreaterThanOrEqual(0);
    expect(jungle).toBeGreaterThan(top);
    expect(mid).toBeGreaterThan(jungle);
    expect(bot).toBeGreaterThan(mid);
    expect(support).toBeGreaterThan(bot);
    expect(text).not.toContain('UNKNOWN');
    expect(text).not.toContain('ADC');
  });

  it('shows games, win rate, and Limited sample for sub-30 roles', () => {
    const wrapper = mountBreakdown({
      entries: fiveRoles({
        SUPPORT: baseMetrics({
          sampleSize: 8,
          wins: 3,
          winRate: 0.375,
          sampleConfidence: 'INSUFFICIENT',
        }),
      }),
    });

    const text = wrapper.text();
    expect(text).toMatch(/8/);
    expect(text).toContain('37.5%');
    expect(text).toMatch(/Limited sample/i);
    expect(text).not.toContain('INSUFFICIENT');
  });

  it('shows normal confidence treatment for roles with sampleSize >= 30', () => {
    const wrapper = mountBreakdown({
      entries: fiveRoles({
        MIDDLE: baseMetrics({
          sampleSize: 50,
          wins: 28,
          winRate: 0.56,
          sampleConfidence: 'LOW',
        }),
      }),
    });

    const text = wrapper.text();
    expect(text).toContain('56.0%');
    expect(text).toContain('LOW');
    expect(text).not.toMatch(/Limited sample/i);
  });

  it('marks missing roles as No data and never fabricates 0%', () => {
    const wrapper = mountBreakdown({
      entries: fiveRoles({ MIDDLE: baseMetrics() }),
    });

    const text = wrapper.text();
    expect(text).toContain('No data');
    expect(text).toContain('56.0%');
    expect(wrapper.html()).not.toMatch(/>0\.0%</);
    // Missing roles must not invent a measured zero sample (avoid matching "50 games").
    expect(text).not.toMatch(/(?<!\d)0\s+games/i);
  });

  it('renders a clean section empty state when every role is missing', () => {
    const wrapper = mountBreakdown({
      entries: fiveRoles(),
    });

    const text = wrapper.text();
    expect(text).toMatch(
      /no position|no data for these filters|breakdown.*unavailable|no role data/i,
    );
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid="position-breakdown-row"]').length).toBe(0);
    expect(text).not.toMatch(/0\.0%/);
  });

  it('keeps accessible structure for desktop table and mobile stacked rows', () => {
    const wrapper = mountBreakdown({
      entries: fiveRoles({
        MIDDLE: baseMetrics(),
        SUPPORT: baseMetrics({
          sampleSize: 8,
          wins: 3,
          winRate: 0.375,
          sampleConfidence: 'INSUFFICIENT',
        }),
      }),
    });

    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.find('table thead').exists()).toBe(true);
    expect(wrapper.findAll('table tbody tr').length).toBe(5);

    const mobile = wrapper.find('[data-testid="position-breakdown-mobile"]');
    expect(mobile.exists()).toBe(true);
    expect(mobile.findAll('[data-testid="position-breakdown-row"]').length).toBe(5);
    expect(mobile.attributes('aria-labelledby') || mobile.attributes('aria-label')).toBeTruthy();
  });

  it('does not render internal identifiers', () => {
    const wrapper = mountBreakdown();
    expect(wrapper.html().toLowerCase()).not.toContain('puuid');
  });
});
