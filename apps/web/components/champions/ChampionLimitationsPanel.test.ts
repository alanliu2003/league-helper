import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { CHAMPION_STATS_DISCLAIMER, RANK_TIER_SEMANTICS } from '@league-helper/shared';
import ChampionLimitationsPanel from './ChampionLimitationsPanel.vue';

describe('ChampionLimitationsPanel', () => {
  it('includes collected-sample wording, scope, and rank semantics when tier ≠ ALL', () => {
    const wrapper = mount(ChampionLimitationsPanel, {
      props: {
        platform: 'na1',
        queue: 420,
        patch: '14.11',
        tier: 'GOLD',
      },
    });

    expect(wrapper.text()).toContain(CHAMPION_STATS_DISCLAIMER);
    expect(wrapper.text()).toContain(RANK_TIER_SEMANTICS);
    expect(wrapper.text()).toContain('search-driven');
    expect(wrapper.text()).toContain('14.11');
    expect(wrapper.text()).toContain('GOLD');
    expect(wrapper.text().toLowerCase()).toContain('not official riot statistics');
    expect(wrapper.text().toLowerCase()).not.toContain('tier list');
  });

  it('omits rank semantics when tier is ALL', () => {
    const wrapper = mount(ChampionLimitationsPanel, {
      props: {
        platform: 'na1',
        queue: 420,
        patch: '14.11',
        tier: 'ALL',
      },
    });
    expect(wrapper.text()).not.toContain(RANK_TIER_SEMANTICS);
  });
});
