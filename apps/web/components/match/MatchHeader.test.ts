import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { matchDetailFixture } from './match-detail.fixture';
import MatchHeader from './MatchHeader.vue';

describe('MatchHeader', () => {
  it('shows Blue Team Victory with queue, patch, duration, and platform text', () => {
    const wrapper = mount(MatchHeader, { props: { match: matchDetailFixture().match } });
    expect(wrapper.text()).toContain('Blue Team Victory');
    expect(wrapper.text()).toContain('Ranked Solo/Duo');
    expect(wrapper.text()).toContain('Patch 14.11');
    expect(wrapper.text()).toContain('30:00');
    expect(wrapper.text()).toContain('North America');
    expect(wrapper.text()).not.toContain('Remake');
  });

  it('shows Remake instead of Victory', () => {
    const wrapper = mount(MatchHeader, {
      props: { match: matchDetailFixture({ remake: true, winningSide: null }).match },
    });
    expect(wrapper.text()).toContain('Remake');
    expect(wrapper.text()).not.toContain('Victory');
  });
});
