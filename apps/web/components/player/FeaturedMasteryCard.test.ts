import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { PublicMasterySummary } from '@league-helper/shared';
import FeaturedMasteryCard from '~/components/player/FeaturedMasteryCard.vue';

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
    championSplashUrl:
      'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg',
    ...overrides,
  };
}

const nuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
};

describe('FeaturedMasteryCard', () => {
  it('renders splash from backend-provided championSplashUrl', () => {
    const wrapper = mount(FeaturedMasteryCard, {
      props: { entry: mastery(), rank: 1 },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });

    const splashImg = wrapper.find('img[alt=""]');
    expect(splashImg.exists()).toBe(true);
    expect(splashImg.attributes('src')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg',
    );
    expect(wrapper.text()).toContain('Tryndamere');
    expect(wrapper.text()).toContain('#1 mastery');
  });

  it('links to the champion detail path when championKey is present', () => {
    const wrapper = mount(FeaturedMasteryCard, {
      props: { entry: mastery(), rank: 1 },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });
    expect(wrapper.find('a').attributes('href')).toBe('/champions/Tryndamere');
  });

  it('does not link when championKey is missing', () => {
    const wrapper = mount(FeaturedMasteryCard, {
      props: { entry: mastery({ championKey: null }), rank: 1 },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('shows neutral fallback when splash URL is null', () => {
    const wrapper = mount(FeaturedMasteryCard, {
      props: {
        entry: mastery({ championSplashUrl: null }),
        rank: 1,
      },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });

    expect(wrapper.find('img[alt=""]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Tryndamere');
  });

  it('falls back when splash image fails to load', async () => {
    const wrapper = mount(FeaturedMasteryCard, {
      props: { entry: mastery(), rank: 1 },
      global: { stubs: { NuxtLink: nuxtLinkStub } },
    });

    await wrapper.find('img[alt=""]').trigger('error');
    expect(wrapper.find('img[alt=""]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Tryndamere');
  });
});
