import { mount, RouterLinkStub } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  type ChampionMatchupsResponse,
} from '@league-helper/shared';
import ChampionMatchupsPanel from './ChampionMatchupsPanel.vue';

const MOCK_ICON = 'https://cdn.example.test/champions/Syndra.png';

function response(overrides: Partial<ChampionMatchupsResponse> = {}): ChampionMatchupsResponse {
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    sampleScope: { kind: 'COLLECTED_SAMPLE', platform: 'na1', patch: '16.15', queueId: 420 },
    resolvedFilters: {
      platform: 'na1',
      patch: '16.15',
      queueId: 420,
      tier: 'ALL',
      position: 'MIDDLE',
    },
    emptyReason: null,
    displayFloor: 10,
    rankingPolicy: 'WILSON_LOWER_BOUND',
    totalEligiblePairs: 2,
    totalSourcePairs: 2,
    strongAgainst: [
      {
        opponent: {
          championId: 18,
          championKey: 'Tristana',
          name: 'Tristana',
          iconUrl: 'https://cdn.example.test/champions/Tristana.png',
        },
        position: 'MIDDLE',
        sampleSize: 10,
        wins: 7,
        losses: 3,
        winRate: 0.7,
        wilsonInterval: { lowerBound: 0.4, upperBound: 0.89, confidenceLevel: 0.95 },
        sampleConfidence: 'LOW',
        lowSample: true,
        averageGoldDifferenceAt10: null,
        averageGoldDifferenceAt15: null,
        averageCsDifferenceAt10: null,
        averageCsDifferenceAt15: null,
      },
    ],
    weakAgainst: [
      {
        opponent: { championId: 134, championKey: 'Syndra', name: 'Syndra', iconUrl: MOCK_ICON },
        position: 'MIDDLE',
        sampleSize: 10,
        wins: 4,
        losses: 6,
        winRate: 0.4,
        wilsonInterval: { lowerBound: 0.17, upperBound: 0.69, confidenceLevel: 0.95 },
        sampleConfidence: 'LOW',
        lowSample: true,
        averageGoldDifferenceAt10: null,
        averageGoldDifferenceAt15: null,
        averageCsDifferenceAt10: null,
        averageCsDifferenceAt15: null,
      },
    ],
    ...overrides,
  };
}

describe('ChampionMatchupsPanel', () => {
  it('renders Weak Against and Strong Against with icons and names', () => {
    const wrapper = mount(ChampionMatchupsPanel, {
      props: {
        response: response(),
        pending: false,
        error: null,
        position: 'MIDDLE',
        platform: 'na1',
        queue: 420,
        tier: 'ALL',
        patch: '16.15',
      },
      global: {
        stubs: {
          NuxtLink: RouterLinkStub,
          PlayerErrorBanner: { template: '<p class="error">{{ message }}</p>', props: ['message'] },
        },
      },
    });
    expect(wrapper.get('[data-testid="weak-against"]').text()).toContain('Syndra');
    expect(wrapper.get('[data-testid="strong-against"]').text()).toContain('Tristana');
    expect(wrapper.get('[data-testid="weak-against"] img').attributes('alt')).toBe('Syndra');
    expect(wrapper.text()).toContain('Limited sample');
    expect(wrapper.text()).toContain('40.0%');
    expect(wrapper.text()).toContain('70.0%');
  });

  it('links opponents to champion pages by key, not numeric id', () => {
    const wrapper = mount(ChampionMatchupsPanel, {
      props: {
        response: response(),
        pending: false,
        error: null,
        position: 'MIDDLE',
        platform: 'na1',
        queue: 420,
        tier: 'ALL',
        patch: '16.15',
      },
      global: {
        stubs: {
          NuxtLink: RouterLinkStub,
          PlayerErrorBanner: { template: '<p class="error">{{ message }}</p>', props: ['message'] },
        },
      },
    });
    const links = wrapper.findAllComponents(RouterLinkStub);
    expect(links[0]?.props('to')).toContain('/champions/Syndra');
    expect(links[0]?.props('to')).toContain('position=MIDDLE');
    expect(wrapper.text()).not.toMatch(/\b134\b/);
  });

  it('shows an honest empty state when no pair clears the floor', () => {
    const wrapper = mount(ChampionMatchupsPanel, {
      props: {
        response: response({
          emptyReason: 'NO_ELIGIBLE_MATCHUPS',
          strongAgainst: [],
          weakAgainst: [],
          totalEligiblePairs: 0,
        }),
        pending: false,
        error: null,
        position: 'MIDDLE',
      },
      global: {
        stubs: {
          NuxtLink: RouterLinkStub,
          PlayerErrorBanner: { template: '<p class="error">{{ message }}</p>', props: ['message'] },
        },
      },
    });
    expect(wrapper.get('[data-testid="matchups-empty"]').text()).toMatch(/Not enough matchup data/);
    expect(wrapper.find('[data-testid="strong-against"]').exists()).toBe(false);
  });
});
