import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ORIGIN_PLAYER_ID, matchDetailFixture } from './match-detail.fixture';
import MatchDamageSection from './MatchDamageSection.vue';

describe('MatchDamageSection', () => {
  it('orders bars by descending damage without MVP copy', () => {
    const detail = matchDetailFixture();
    const wrapper = mount(MatchDamageSection, {
      props: {
        teams: detail.teams,
        ingestionStatus: 'COMPLETED',
        originPlayerId: ORIGIN_PLAYER_ID,
      },
    });
    const labels = wrapper.findAll('li span.truncate').map((node) => node.text());
    expect(labels[0]).toContain('Alice');
    expect(wrapper.text()).not.toContain('MVP');
    expect(wrapper.html()).toContain('width: 100%');
  });

  it('hides the section when incomplete and all damage is zero', () => {
    const detail = matchDetailFixture();
    detail.teams[0]!.participants[0]!.totalDamageDealtToChampions = 0;
    detail.teams[1]!.participants[0]!.totalDamageDealtToChampions = 0;
    const wrapper = mount(MatchDamageSection, {
      props: {
        teams: detail.teams,
        ingestionStatus: 'IN_PROGRESS',
      },
    });
    expect(wrapper.find('section').exists()).toBe(false);
  });
});
