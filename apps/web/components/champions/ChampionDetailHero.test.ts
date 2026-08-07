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
  it('uses backend-provided splash and icon URLs with name, title, and tags', () => {
    const wrapper = mount(ChampionDetailHero, {
      props: {
        champion: champion(),
        platform: 'na1',
        patch: '16.1',
        position: 'MIDDLE',
      },
    });

    expect(wrapper.find('img[alt=""]').attributes('src')).toBe(
      'https://example.com/ahri-splash.jpg',
    );
    expect(wrapper.find('img[alt="Ahri icon"]').attributes('src')).toBe(
      'https://example.com/ahri.png',
    );
    expect(wrapper.find('h1').text()).toContain('Ahri');
    expect(wrapper.text()).toContain('the Nine-Tailed Fox');
    expect(wrapper.text()).toContain('Mage');
    expect(wrapper.text()).toContain('Assassin');
    expect(wrapper.text()).toContain('Patch 16.1');
    expect(wrapper.text()).toContain('Mid');
    expect(wrapper.html().toLowerCase()).not.toContain('puuid');
  });

  it('shows selected patch and position context without adjacent-champion navigation', () => {
    const wrapper = mount(ChampionDetailHero, {
      props: {
        champion: champion(),
        patch: '16.2',
        position: 'MIDDLE',
      },
    });

    expect(wrapper.text()).toContain('Patch 16.2');
    expect(wrapper.text()).toContain('Mid');
    expect(wrapper.text()).not.toMatch(/Aatrox/i);
    expect(wrapper.findAll('a').length).toBe(0);
    expect(wrapper.find('[data-testid="adjacent-champion-nav"]').exists()).toBe(false);
    expect(wrapper.html().toLowerCase()).not.toContain('previous champion');
    expect(wrapper.html().toLowerCase()).not.toContain('next champion');
  });

  it('preserves h1 semantics for the champion name', () => {
    const wrapper = mount(ChampionDetailHero, {
      props: { champion: champion() },
    });

    const heading = wrapper.find('#champion-detail-heading');
    expect(heading.exists()).toBe(true);
    expect(heading.element.tagName).toBe('H1');
    expect(heading.text()).toBe('Ahri');
  });

  it('falls back when splash fails while keeping identity readable', async () => {
    const wrapper = mount(ChampionDetailHero, {
      props: { champion: champion() },
    });

    await wrapper.find('img[alt=""]').trigger('error');
    expect(wrapper.find('img[alt=""]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="hero-splash-fallback"]').exists()).toBe(true);
    expect(wrapper.find('h1').text()).toContain('Ahri');
    expect(wrapper.text()).toContain('the Nine-Tailed Fox');
    expect(wrapper.find('img[alt="Ahri icon"]').exists()).toBe(true);
  });

  it('falls back when icon fails while keeping name identity', async () => {
    const wrapper = mount(ChampionDetailHero, {
      props: { champion: champion() },
    });

    await wrapper.find('img[alt="Ahri icon"]').trigger('error');
    expect(wrapper.find('img[alt="Ahri icon"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="hero-icon-fallback"]').exists()).toBe(true);
    expect(wrapper.find('h1').text()).toContain('Ahri');
    expect(wrapper.find('img[alt=""]').attributes('src')).toBe(
      'https://example.com/ahri-splash.jpg',
    );
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
    expect(wrapper.find('[data-testid="hero-splash-fallback"]').exists()).toBe(true);
  });
});
