import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ORIGIN_PLAYER_ID } from './match-detail.fixture';
import {
  emptyTimelineDetailFixture,
  timelineDetailFixture,
  timelineEvent,
} from './match-timeline.fixture';
import MatchSkillProgression from './MatchSkillProgression.vue';

describe('MatchSkillProgression', () => {
  it('lists origin participant first and uses API skill labels', () => {
    const wrapper = mount(MatchSkillProgression, {
      props: {
        timeline: timelineDetailFixture(),
        originPlayerId: ORIGIN_PLAYER_ID,
      },
    });
    expect(wrapper.text()).toContain('Tryndamere');
    expect(wrapper.text()).toContain('Q');
  });

  it('lists EVOLVE with level-up type text and does not invent a fifth ability', () => {
    const timeline = timelineDetailFixture({
      events: [
        timelineEvent({
          eventIndex: 2,
          timestampMs: 20_000,
          type: 'SKILL_LEVEL_UP',
          participantId: 1,
          itemId: null,
          item: null,
          skillSlot: 4,
          skillLabel: 'R',
          levelUpType: 'EVOLVE',
        }),
      ],
    });
    const wrapper = mount(MatchSkillProgression, {
      props: { timeline, originPlayerId: ORIGIN_PLAYER_ID },
    });
    expect(wrapper.text()).toContain('EVOLVE');
    expect(wrapper.text()).toContain('R');
    expect(wrapper.text()).not.toContain('slot 5');
    expect(wrapper.text()).not.toMatch(/\b5th\b/i);
  });

  it('hides the section when skill coverage is false', () => {
    const wrapper = mount(MatchSkillProgression, {
      props: {
        timeline: emptyTimelineDetailFixture('AVAILABLE'),
        originPlayerId: ORIGIN_PLAYER_ID,
      },
    });
    expect(wrapper.find('[data-testid="match-skill-progression"]').exists()).toBe(false);
  });
});
