import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { emptyTimelineDetailFixture, timelineDetailFixture } from './match-timeline.fixture';
import MatchGoldGraph from './MatchGoldGraph.vue';

describe('MatchGoldGraph', () => {
  it('hides the entire graph when coverage.frames is false', () => {
    const wrapper = mount(MatchGoldGraph, {
      props: { timeline: emptyTimelineDetailFixture('AVAILABLE') },
    });
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('[data-testid="match-gold-graph"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('renders an svg gold graph with Blue and Red text labels', () => {
    const wrapper = mount(MatchGoldGraph, {
      props: { timeline: timelineDetailFixture() },
    });
    const svg = wrapper.get('svg');
    expect(svg.attributes('aria-label')).toBe('Team gold over time');
    expect(svg.attributes('viewBox')).toBeTruthy();
    expect(wrapper.findAll('polyline').length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain('Blue');
    expect(wrapper.text()).toContain('Red');
  });
});
