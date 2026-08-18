import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { emptyTimelineDetailFixture, timelineDetailFixture } from './match-timeline.fixture';
import MatchEventStream from './MatchEventStream.vue';

describe('MatchEventStream', () => {
  it('shows all persisted events in chronological order by default', () => {
    const wrapper = mount(MatchEventStream, {
      props: { timeline: timelineDetailFixture() },
    });
    const text = wrapper.get('[data-testid="match-event-stream"]').text();
    expect(text.indexOf("Doran's Blade")).toBeGreaterThan(-1);
    expect(text.indexOf('Infinity Edge')).toBeGreaterThan(text.indexOf("Doran's Blade"));
    expect(text.indexOf('02:14')).toBeGreaterThan(text.indexOf('Infinity Edge'));
    expect(text).toContain('Dragon');
  });

  it('filters to champion kills', async () => {
    const wrapper = mount(MatchEventStream, { props: { timeline: timelineDetailFixture() } });
    await wrapper.get('[data-filter="kills"]').trigger('click');
    expect(wrapper.text()).toContain('02:14 Blue Top · Tryndamere kills Red Top · Aatrox');
    expect(wrapper.text()).not.toContain('Infinity Edge');
    expect(wrapper.text()).not.toContain('Dragon');
  });

  it('filters to public objectives only', async () => {
    const wrapper = mount(MatchEventStream, { props: { timeline: timelineDetailFixture() } });
    await wrapper.get('[data-filter="objectives"]').trigger('click');
    expect(wrapper.text()).toContain('Dragon');
    expect(wrapper.text()).not.toContain('Infinity Edge');
    expect(wrapper.text()).not.toContain('kills Red Top');
  });

  it('filters to item events', async () => {
    const wrapper = mount(MatchEventStream, { props: { timeline: timelineDetailFixture() } });
    await wrapper.get('[data-filter="items"]').trigger('click');
    expect(wrapper.text()).toContain('Infinity Edge');
    expect(wrapper.text()).toContain("Doran's Blade");
    expect(wrapper.text()).not.toContain('kills Red Top');
    expect(wrapper.text()).not.toContain('Dragon');
  });

  it('filters to skill events', async () => {
    const wrapper = mount(MatchEventStream, { props: { timeline: timelineDetailFixture() } });
    await wrapper.get('[data-filter="skills"]').trigger('click');
    expect(wrapper.text()).toContain('Q');
    expect(wrapper.text()).not.toContain('Infinity Edge');
    expect(wrapper.text()).not.toContain('kills Red Top');
  });

  it('shows the locked empty copy when kills were not stored', async () => {
    const wrapper = mount(MatchEventStream, {
      props: { timeline: emptyTimelineDetailFixture('AVAILABLE') },
    });
    await wrapper.get('[data-filter="kills"]').trigger('click');
    expect(wrapper.text()).toContain('Kill timeline was not stored for this match.');
  });
});
