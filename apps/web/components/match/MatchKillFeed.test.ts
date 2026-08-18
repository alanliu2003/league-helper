import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { timelineDetailFixture, timelineParticipant } from './match-timeline.fixture';
import MatchKillFeed from './MatchKillFeed.vue';

describe('MatchKillFeed', () => {
  const participants = timelineDetailFixture().participants;

  it('formats a champion kill with sides, roles, and champion names', () => {
    const wrapper = mount(MatchKillFeed, {
      props: {
        kill: timelineDetailFixture().derived.kills[0]!,
        participants,
      },
    });
    expect(wrapper.text()).toBe('02:14 Blue Top · Tryndamere kills Red Top · Aatrox');
  });

  it('formats an environment kill without a champion killer', () => {
    const wrapper = mount(MatchKillFeed, {
      props: {
        kill: {
          timestampMs: 134_000,
          killerKind: 'ENVIRONMENT',
          killerParticipantId: null,
          victimParticipantId: 6,
          assistingParticipantIds: [],
          position: null,
        },
        participants,
      },
    });
    expect(wrapper.text()).toBe('02:14 Environment kills Red Top · Aatrox');
  });

  it('does not invent a killer when the participant list has no match', () => {
    const wrapper = mount(MatchKillFeed, {
      props: {
        kill: {
          timestampMs: 5_000,
          killerKind: 'CHAMPION',
          killerParticipantId: 1,
          victimParticipantId: 6,
          assistingParticipantIds: [],
          position: null,
        },
        participants: [
          timelineParticipant({
            participantId: 6,
            teamId: 200,
            side: 'RED',
            playerId: null,
            championName: 'Aatrox',
          }),
        ],
      },
    });
    expect(wrapper.text()).toContain('Environment kills');
  });
});
