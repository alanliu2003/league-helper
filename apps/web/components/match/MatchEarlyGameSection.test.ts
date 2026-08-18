import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ORIGIN_PLAYER_ID, matchDetailFixture, matchParticipant } from './match-detail.fixture';
import MatchEarlyGameSection from './MatchEarlyGameSection.vue';

describe('MatchEarlyGameSection', () => {
  it('shows only non-null origin early metrics', () => {
    const detail = matchDetailFixture();
    detail.teams[0]!.participants[0] = matchParticipant({
      playerId: ORIGIN_PLAYER_ID,
      goldDifferenceAt10: 200,
      goldAt10: 3000,
      csDifferenceAt10: null,
    });
    const wrapper = mount(MatchEarlyGameSection, {
      props: {
        teams: detail.teams,
        originPlayerId: ORIGIN_PLAYER_ID,
        timeline: {
          status: 'AVAILABLE',
          metricsAvailable: true,
          productCoverage: 'STORED',
          productAvailable: true,
        },
      },
    });
    expect(wrapper.text()).toContain('Early game');
    expect(wrapper.text()).toContain('Gold diff @10');
    expect(wrapper.text()).toContain('200');
    expect(wrapper.text()).not.toContain('CS diff @10');
  });

  it('hides the section when there is no origin player', () => {
    const wrapper = mount(MatchEarlyGameSection, {
      props: {
        teams: matchDetailFixture().teams,
        originPlayerId: null,
        timeline: {
          status: 'UNAVAILABLE',
          metricsAvailable: false,
          productCoverage: 'NONE',
          productAvailable: false,
        },
      },
    });
    expect(wrapper.find('section').exists()).toBe(false);
  });

  it('shows processing copy when timeline is pending and metrics are missing', () => {
    const wrapper = mount(MatchEarlyGameSection, {
      props: {
        teams: matchDetailFixture().teams,
        originPlayerId: ORIGIN_PLAYER_ID,
        timeline: {
          status: 'PENDING',
          metricsAvailable: false,
          productCoverage: 'NONE',
          productAvailable: false,
        },
      },
    });
    expect(wrapper.text()).toContain('still processing');
    expect(wrapper.text()).not.toContain('Gold @10: 0');
  });
});
