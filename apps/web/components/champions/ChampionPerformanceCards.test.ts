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
    aggregateKdaRatio: 3.42,
    averageCsPerMinute: 7.4,
    averageDamagePerMinute: 628.4,
    averageVisionScorePerMinute: 0.82,
    averageGoldDifferenceAt10: 145,
    averageGoldDifferenceAt15: 302,
    averageCsDifferenceAt10: 3.1,
    averageCsDifferenceAt15: 6.4,
    latestEligibleMatchAt: null,
    ...overrides,
  };
}

function mountCards(props: { metrics?: ChampionAggregateMetrics | null } = {}) {
  return mount(ChampionPerformanceCards, {
    props: { metrics: props.metrics === undefined ? metrics() : props.metrics },
  });
}

describe('ChampionPerformanceCards', () => {
  it('renders supported backend-derived performance metrics with expected formatting', () => {
    const wrapper = mountCards();
    const text = wrapper.text();

    expect(wrapper.find('#performance-cards-heading').text()).toBe('Performance');
    expect(text).toContain('KDA');
    expect(text).toContain('3.42');
    expect(text).toContain('CS / min');
    expect(text).toContain('7.4');
    expect(text).toContain('Damage / min');
    expect(text).toContain('628');
    expect(text).toContain('Vision / min');
    expect(text).toContain('0.82');
    expect(text).toContain('Gold @ 10');
    expect(text).toContain('+145');
    expect(text).toContain('Gold @ 15');
    expect(text).toContain('+302');
    expect(text).toContain('CS @ 10');
    expect(text).toContain('+3.1');
    expect(text).toContain('CS @ 15');
    expect(text).toContain('+6.4');
  });

  it('still renders performance metrics for low-sample (INSUFFICIENT) aggregates', () => {
    const wrapper = mountCards({
      metrics: metrics({
        sampleSize: 18,
        wins: 10,
        winRate: 0.542,
        sampleConfidence: 'INSUFFICIENT',
        aggregateKdaRatio: 2.15,
      }),
    });

    expect(wrapper.text()).toContain('2.15');
    expect(wrapper.text()).toContain('7.4');
    expect(wrapper.text()).toContain('628');
  });

  it('shows Unavailable for null early-game metrics and never invents 0', () => {
    const wrapper = mountCards({
      metrics: metrics({
        averageGoldDifferenceAt10: null,
        averageGoldDifferenceAt15: null,
        averageCsDifferenceAt10: null,
        averageCsDifferenceAt15: null,
      }),
    });

    const text = wrapper.text();
    expect(text).toContain('Unavailable');
    expect(text).toMatch(/No timeline sample|Timeline metric unavailable|unavailable/i);
    expect(text).toContain('3.42');
    expect(text).not.toMatch(/Gold @ 10\s*\+?0(\.0+)?(?!\d)/);
    expect(text).not.toMatch(/CS @ 10\s*\+?0(\.0+)?(?!\d)/);
  });

  it('renders legitimate numeric zero distinctly from unavailable', () => {
    const wrapper = mountCards({
      metrics: metrics({
        averageGoldDifferenceAt10: 0,
        averageCsDifferenceAt10: 0,
      }),
    });

    const text = wrapper.text();
    expect(text).toMatch(/Gold @ 10\s*0(?!\.)/);
    expect(text).toMatch(/CS @ 10\s*0(?:\.0)?(?!\d)/);
    expect(text).not.toMatch(/Gold @ 10\s*Unavailable/);
  });

  it('formats signed positive and negative lane differences with explicit signs', () => {
    const wrapper = mountCards({
      metrics: metrics({
        averageGoldDifferenceAt10: 145,
        averageGoldDifferenceAt15: -92,
        averageCsDifferenceAt10: 3.1,
        averageCsDifferenceAt15: -1.5,
      }),
    });

    const text = wrapper.text();
    expect(text).toContain('+145');
    expect(text).toContain('-92');
    expect(text).toContain('+3.1');
    expect(text).toContain('-1.5');
  });

  it('does not render unsupported metrics or duplicate primary win-rate hierarchy', () => {
    const wrapper = mountCards();
    const text = wrapper.text();

    expect(text).not.toMatch(/Pick rate/i);
    expect(text).not.toMatch(/Ban rate/i);
    expect(text).not.toMatch(/\bGPM\b/);
    expect(text).not.toMatch(/\bKP\b/);
    expect(text).not.toMatch(/Kill participation/i);
    expect(text).not.toMatch(/Average K\/D\/A/i);
    expect(text).not.toMatch(/\bKills\b/);
    expect(text).not.toMatch(/\bDeaths\b/);
    expect(text).not.toMatch(/\bAssists\b/);
    expect(text).not.toMatch(/Win rate/i);
    expect(text).not.toMatch(/\bgames\b/i);
    expect(text).not.toMatch(/W–L|W-L/);
  });

  it('groups metrics into structured subsections rather than equal SaaS cards only', () => {
    const wrapper = mountCards();
    const text = wrapper.text();

    expect(text).toMatch(/Combat/i);
    expect(text).toMatch(/Farming/i);
    expect(text).toMatch(/Vision/i);
    expect(text).toMatch(/Lane advantage/i);
    expect(wrapper.findAll('dl').length).toBeGreaterThan(0);
    expect(wrapper.findAll('dt').length).toBeGreaterThanOrEqual(8);
  });

  it('shows an honest empty state when metrics are missing', () => {
    const wrapper = mountCards({ metrics: null });
    expect(wrapper.text()).toMatch(/performance metrics appear|unavailable|select/i);
    expect(wrapper.text()).not.toContain('3.42');
    expect(wrapper.text()).not.toMatch(/0\.0%/);
  });

  it('does not render internal identifiers', () => {
    const wrapper = mountCards();
    expect(wrapper.html().toLowerCase()).not.toContain('puuid');
  });
});
