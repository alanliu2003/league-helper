import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ORIGIN_PLAYER_ID } from './match-detail.fixture';
import { emptyTimelineDetailFixture, timelineDetailFixture } from './match-timeline.fixture';
import MatchItemProgression from './MatchItemProgression.vue';

describe('MatchItemProgression', () => {
  it('lists the origin participant first and uses API item identity', () => {
    const wrapper = mount(MatchItemProgression, {
      props: {
        timeline: timelineDetailFixture(),
        originPlayerId: ORIGIN_PLAYER_ID,
      },
    });
    const text = wrapper.text();
    expect(text.indexOf('Tryndamere')).toBeLessThan(text.indexOf('Aatrox'));
    expect(text).toContain('Infinity Edge');
    expect(text).toContain("Doran's Blade");
    expect(wrapper.get('img[alt="Infinity Edge"]').attributes('src')).toBe(
      'https://cdn.test/item/3031.png',
    );
  });

  it('hides the section when item coverage is false', () => {
    const wrapper = mount(MatchItemProgression, {
      props: {
        timeline: emptyTimelineDetailFixture('AVAILABLE'),
        originPlayerId: ORIGIN_PLAYER_ID,
      },
    });
    expect(wrapper.find('[data-testid="match-item-progression"]').exists()).toBe(false);
  });
});
