import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChampionDetail } from '@league-helper/shared';
import ChampionDetailHero from './ChampionDetailHero.vue';

function champion(overrides: Partial<ChampionDetail> = {}): ChampionDetail {
  return {
    championId: 103,
    championKey: 'Ahri',
    name: 'Ahri',
    title: 'the Nine-Tailed Fox',
    tags: ['Mage', 'Assassin'],
    iconUrl: 'https://example.com/ahri.png',
    splashUrl: 'https://example.com/ahri-splash.jpg',
    ...overrides,
  };
}

describe('ChampionDetailHero', () => {
  it('uses backend-provided splash and icon URLs', () => {
    const wrapper = mount(ChampionDetailHero, {
      props: { champion: champion(), platform: 'na1', position: 'MIDDLE' },
    });

    expect(wrapper.find('img[alt=""]').attributes('src')).toBe(
      'https://example.com/ahri-splash.jpg',
    );
    expect(wrapper.find('img[alt="Ahri icon"]').attributes('src')).toBe(
      'https://example.com/ahri.png',
    );
    expect(wrapper.text()).toContain('Ahri');
    expect(wrapper.text()).toContain('the Nine-Tailed Fox');
    expect(wrapper.text()).toContain('Mid');
    expect(wrapper.html().toLowerCase()).not.toContain('puuid');
  });

  it('falls back locally when splash image fails', async () => {
    const wrapper = mount(ChampionDetailHero, {
      props: { champion: champion() },
    });

    await wrapper.find('img[alt=""]').trigger('error');
    expect(wrapper.find('img[alt=""]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Ahri');
  });

  it('does not construct Data Dragon splash paths in the component', () => {
    const wrapper = mount(ChampionDetailHero, {
      props: {
        champion: champion({
          splashUrl: null,
          iconUrl: null,
        }),
      },
    });
    expect(wrapper.html()).not.toContain('ddragon.leagueoflegends.com');
    expect(wrapper.html()).not.toContain('/img/champion/splash/');
  });
});
