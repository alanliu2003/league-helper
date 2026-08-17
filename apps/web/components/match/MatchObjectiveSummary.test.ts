import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MatchObjectiveSummary from './MatchObjectiveSummary.vue';

describe('MatchObjectiveSummary', () => {
  it('renders known objectives and omits champion kills and missing types', () => {
    const wrapper = mount(MatchObjectiveSummary, {
      props: {
        objectives: [
          { type: 'dragon', kills: 2, first: true },
          { type: 'baron', kills: 1, first: null },
          { type: 'champion', kills: 12, first: false },
        ],
      },
    });
    expect(wrapper.text()).toContain('Dragon 2');
    expect(wrapper.text()).toContain('Baron 1');
    expect(wrapper.text()).not.toContain('Kills 12');
    expect(wrapper.text()).not.toContain('Atakhan');
    expect(wrapper.text()).toContain('first');
  });
});
