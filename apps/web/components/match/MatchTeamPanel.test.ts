import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  ORIGIN_PLAYER_ID,
  matchDetailFixture,
  matchParticipant,
} from './match-detail.fixture';
import MatchTeamPanel from './MatchTeamPanel.vue';

const nuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
};

describe('MatchTeamPanel', () => {
  it('renders five plus five rows and highlights the origin player', () => {
    const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'SUPPORT'] as const;
    const detail = matchDetailFixture({
      teams: [
        {
          teamId: 100,
          side: 'BLUE',
          win: true,
          bans: [{ id: 103, name: 'Ahri', iconUrl: 'https://cdn.test/champion/Ahri.png' }],
          objectives: [{ type: 'dragon', kills: 2, first: true }],
          totals: {
            kills: 5,
            deaths: 5,
            assists: 5,
            goldEarned: 40000,
            damageDealtToChampions: 50000,
            visionScore: 50,
          },
          participants: positions.map((teamPosition, index) =>
            matchParticipant({
              participantId: index + 1,
              teamPosition,
              playerId: index === 0 ? ORIGIN_PLAYER_ID : null,
              riotId: { gameName: `Blue${index + 1}`, tagLine: 'NA1' },
            }),
          ),
        },
        {
          teamId: 200,
          side: 'RED',
          win: false,
          bans: [],
          objectives: [],
          totals: {
            kills: 4,
            deaths: 6,
            assists: 4,
            goldEarned: 38000,
            damageDealtToChampions: 48000,
            visionScore: 40,
          },
          participants: positions.map((teamPosition, index) =>
            matchParticipant({
              participantId: index + 6,
              teamId: 200,
              win: false,
              teamPosition,
              playerId: null,
              riotId: { gameName: `Red${index + 1}`, tagLine: 'NA1' },
            }),
          ),
        },
      ],
    });

    const blue = mount(MatchTeamPanel, {
      props: { team: detail.teams[0]!, originPlayerId: ORIGIN_PLAYER_ID },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });
    const red = mount(MatchTeamPanel, {
      props: { team: detail.teams[1]!, originPlayerId: ORIGIN_PLAYER_ID },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });

    expect(blue.text()).toContain('Blue Team');
    expect(blue.text()).toContain('Victory');
    expect(blue.findAll('article')).toHaveLength(5);
    expect(blue.findAll('[aria-current="true"]')).toHaveLength(1);
    expect(red.text()).toContain('Red Team');
    expect(red.text()).toContain('Defeat');
    expect(red.findAll('article')).toHaveLength(5);
  });

  it('omits Victory on remakes', () => {
    const wrapper = mount(MatchTeamPanel, {
      props: { team: matchDetailFixture({ remake: true }).teams[0]!, remake: true },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });
    expect(wrapper.text()).toContain('Remake');
    expect(wrapper.text()).not.toContain('Victory');
  });
});
