import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ORIGIN_PLAYER_ID, matchParticipant } from './match-detail.fixture';
import MatchParticipantRow from './MatchParticipantRow.vue';

const nuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
};

function mountRow(participant = matchParticipant(), highlighted = false) {
  return mount(MatchParticipantRow, {
    props: { participant, highlighted },
    global: { stubs: { NuxtLink: nuxtLinkStub } },
  });
}

describe('MatchParticipantRow', () => {
  it('links tracked riot ids and highlights the origin player', () => {
    const wrapper = mountRow(
      matchParticipant({ playerId: ORIGIN_PLAYER_ID, riotId: { gameName: 'Alice', tagLine: 'NA1' } }),
      true,
    );
    expect(wrapper.get('article').attributes('aria-current')).toBe('true');
    expect(wrapper.text()).toContain('You');
    expect(wrapper.get('a[href="/players/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]').text()).toContain(
      'Alice#NA1',
    );
  });

  it('renders untracked names as text, not a player link', () => {
    const wrapper = mountRow(matchParticipant({ playerId: null }));
    expect(wrapper.text()).toContain('Alice#NA1');
    expect(wrapper.find('a[href^="/players/"]').exists()).toBe(false);
  });

  it('keeps empty item slots labeled and hides null early metrics', () => {
    const wrapper = mountRow(
      matchParticipant({
        items: [
          { slot: 0, itemId: 3031, name: 'Infinity Edge', iconUrl: 'https://cdn.test/item/3031.png' },
          { slot: 1, itemId: 0, name: null, iconUrl: null },
          { slot: 2, itemId: 0, name: null, iconUrl: null },
          { slot: 3, itemId: 0, name: null, iconUrl: null },
          { slot: 4, itemId: 0, name: null, iconUrl: null },
          { slot: 5, itemId: 0, name: null, iconUrl: null },
          { slot: 6, itemId: 0, name: null, iconUrl: null },
        ],
        goldDifferenceAt10: null,
      }),
    );
    expect(wrapper.findAll('[aria-label="Empty item slot"]').length).toBe(6);
    expect(wrapper.get('img[alt="Infinity Edge"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Gold diff @10');
  });
});
