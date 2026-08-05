import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { PublicMasterySummary } from '@league-helper/shared';
import PlayerMasteryList from '~/components/player/PlayerMasteryList.vue';

function mastery(overrides: Partial<PublicMasterySummary> = {}): PublicMasterySummary {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    championId: 23,
    championLevel: 7,
    championPoints: 250_000,
    lastPlayTime: '2024-06-01T12:00:00.000Z',
    chestGranted: true,
    tokensEarned: 0,
    capturedAt: '2024-06-02T12:00:00.000Z',
    championName: 'Tryndamere',
    championKey: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.15.1/img/champion/Tryndamere.png',
    ...overrides,
  };
}

describe('PlayerMasteryList', () => {
  it('shows champion icon, name, level, points, and last played from backend metadata', () => {
    const wrapper = mount(PlayerMasteryList, {
      props: { mastery: [mastery()] },
    });

    expect(wrapper.text()).toContain('Tryndamere');
    expect(wrapper.text()).toContain('Level 7');
    expect(wrapper.text()).toMatch(/250[,.\s]?000\s+points/);
    expect(wrapper.text()).toContain('Last played');
    expect(wrapper.text()).not.toContain('Champion #23');

    const img = wrapper.get('img');
    expect(img.attributes('src')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/14.15.1/img/champion/Tryndamere.png',
    );
    expect(img.attributes('alt')).toBe('Tryndamere icon');
    expect(img.attributes('src')).not.toContain('/img/champion/23.png');
  });

  it('shows initials fallback when champion image fails to load', async () => {
    const wrapper = mount(PlayerMasteryList, {
      props: { mastery: [mastery()] },
    });
    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('T');
    expect(wrapper.text()).toContain('Tryndamere');
  });

  it('falls back to Champion #<id> when name is missing', () => {
    const wrapper = mount(PlayerMasteryList, {
      props: {
        mastery: [
          mastery({
            championName: null,
            championKey: null,
            championIconUrl: null,
            championId: 64,
          }),
        ],
      },
    });

    expect(wrapper.text()).toContain('Champion #64');
    expect(wrapper.find('img').exists()).toBe(false);
  });
});
