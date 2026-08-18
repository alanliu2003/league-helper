import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { matchDetailTabFromHash } from '~/utils/match-timeline-format';
import MatchDetailTabs from './MatchDetailTabs.vue';

describe('MatchDetailTabs', () => {
  it('renders Overview and Timeline tabs', () => {
    const wrapper = mount(MatchDetailTabs, { props: { modelValue: 'overview' } });
    expect(wrapper.get('[role="tablist"]').attributes('aria-label')).toBe('Match sections');
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('Overview');
    expect(wrapper.get('[id="match-tab-timeline"]').text()).toBe('Timeline');
  });

  it('emits Timeline on click and arrow keys', async () => {
    const wrapper = mount(MatchDetailTabs, { props: { modelValue: 'overview' } });
    await wrapper.get('[id="match-tab-timeline"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['timeline']);

    await wrapper.get('[id="match-tab-overview"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['timeline']);
  });

  it('marks Timeline selected when modelValue is timeline', () => {
    const wrapper = mount(MatchDetailTabs, { props: { modelValue: 'timeline' } });
    expect(wrapper.get('[id="match-tab-timeline"]').attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[id="match-tab-overview"]').attributes('aria-selected')).toBe('false');
  });

  it('maps #timeline hash to the Timeline tab', () => {
    expect(matchDetailTabFromHash('#timeline')).toBe('timeline');
    expect(matchDetailTabFromHash('timeline')).toBe('timeline');
    expect(matchDetailTabFromHash('')).toBe('overview');
    expect(matchDetailTabFromHash('#overview')).toBe('overview');
  });
});
