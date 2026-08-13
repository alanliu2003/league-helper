import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChampionDetailTabs from './ChampionDetailTabs.vue';

describe('ChampionDetailTabs', () => {
  it('renders Overview, Builds & Runes, and Matchups tabs', () => {
    const wrapper = mount(ChampionDetailTabs, { props: { modelValue: 'overview' } });
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('Overview');
    expect(wrapper.get('[id="champion-tab-builds"]').text()).toBe('Builds & Runes');
    expect(wrapper.get('[id="champion-tab-matchups"]').text()).toBe('Matchups');
  });

  it('emits Builds & Runes on click and arrow keys', async () => {
    const wrapper = mount(ChampionDetailTabs, { props: { modelValue: 'overview' } });
    await wrapper.get('[id="champion-tab-builds"]').trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['builds']);

    await wrapper.get('[id="champion-tab-overview"]').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['builds']);
  });
});
