import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ORIGIN_PLAYER_ID } from './match-detail.fixture';
import { emptyTimelineDetailFixture, timelineDetailFixture } from './match-timeline.fixture';
import MatchEventStream from './MatchEventStream.vue';
import MatchGoldGraph from './MatchGoldGraph.vue';
import MatchItemProgression from './MatchItemProgression.vue';
import MatchSkillProgression from './MatchSkillProgression.vue';
import MatchTimelineSection from './MatchTimelineSection.vue';

describe('MatchTimelineSection', () => {
  it('renders gold graph, event stream, build progression, then skill progression', () => {
    const wrapper = mount(MatchTimelineSection, {
      props: {
        timeline: timelineDetailFixture(),
        pending: false,
        errorMessage: null,
        originPlayerId: ORIGIN_PLAYER_ID,
      },
    });
    const gold = wrapper.getComponent(MatchGoldGraph).element;
    const stream = wrapper.getComponent(MatchEventStream).element;
    const items = wrapper.getComponent(MatchItemProgression).element;
    const skills = wrapper.getComponent(MatchSkillProgression).element;
    expect(gold.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stream.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(items.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows processing copy while the fetch is pending or status is PENDING', () => {
    const pending = mount(MatchTimelineSection, {
      props: {
        timeline: null,
        pending: true,
        errorMessage: null,
        originPlayerId: null,
      },
    });
    expect(pending.text()).toContain('Timeline is still processing.');
    expect(pending.findComponent(MatchEventStream).exists()).toBe(false);

    const statusPending = mount(MatchTimelineSection, {
      props: {
        timeline: emptyTimelineDetailFixture('PENDING'),
        pending: false,
        errorMessage: null,
        originPlayerId: null,
      },
    });
    expect(statusPending.text()).toContain('Timeline is still processing.');
  });

  it('shows unavailable copy for UNAVAILABLE status or fetch failure', () => {
    const unavailable = mount(MatchTimelineSection, {
      props: {
        timeline: emptyTimelineDetailFixture('UNAVAILABLE'),
        pending: false,
        errorMessage: null,
        originPlayerId: null,
      },
    });
    expect(unavailable.text()).toContain('Timeline is not available for this match.');

    const failed = mount(MatchTimelineSection, {
      props: {
        timeline: null,
        pending: false,
        errorMessage: 'Request failed',
        originPlayerId: null,
      },
    });
    expect(failed.text()).toContain('Timeline is not available for this match.');
  });
});
