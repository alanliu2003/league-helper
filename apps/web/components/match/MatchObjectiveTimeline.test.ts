import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { timelineDetailFixture } from './match-timeline.fixture';
import MatchObjectiveTimeline from './MatchObjectiveTimeline.vue';

describe('MatchObjectiveTimeline', () => {
  it('renders a public dragon kill with clock and killer', () => {
    const timeline = timelineDetailFixture();
    const wrapper = mount(MatchObjectiveTimeline, {
      props: {
        objective: timeline.derived.objectives[0]!,
        participants: timeline.participants,
      },
    });
    expect(wrapper.text()).toContain('05:00');
    expect(wrapper.text()).toContain('Dragon');
    expect(wrapper.text()).toContain('Blue Top');
    expect(wrapper.text()).not.toContain('Atakhan');
    expect(wrapper.text()).not.toContain('Horde');
  });

  it('renders a tower with owner side instead of synthesizing a winner', () => {
    const timeline = timelineDetailFixture();
    const wrapper = mount(MatchObjectiveTimeline, {
      props: {
        objective: {
          timestampMs: 720_000,
          type: 'tower',
          killerKind: 'CHAMPION',
          killerParticipantId: 1,
          assistingParticipantIds: [],
          ownerTeamId: 200,
          killerTeamId: 100,
          monsterSubType: null,
          towerType: 'OUTER_TURRET',
          laneType: 'TOP_LANE',
          position: null,
        },
        participants: timeline.participants,
      },
    });
    expect(wrapper.text()).toContain('12:00');
    expect(wrapper.text()).toMatch(/tower/i);
    expect(wrapper.text()).toContain('Red');
  });
});
