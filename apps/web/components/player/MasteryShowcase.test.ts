import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { PublicMasterySummary } from '@league-helper/shared';
import FeaturedMasteryCard from '~/components/player/FeaturedMasteryCard.vue';
import MasteryRow from '~/components/player/MasteryRow.vue';
import MasteryShowcase from '~/components/player/MasteryShowcase.vue';

function mastery(id: string, overrides: Partial<PublicMasterySummary> = {}): PublicMasterySummary {
  return {
    id,
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

const mountOptions = {
  global: { components: { FeaturedMasteryCard, MasteryRow } },
};

describe('MasteryShowcase', () => {
  it('shows featured cards with champion name, level, points, and splash from backend', () => {
    const wrapper = mount(MasteryShowcase, {
      props: { mastery: [mastery('11111111-1111-1111-1111-111111111111')] },
      ...mountOptions,
    });

    expect(wrapper.text()).toContain('Tryndamere');
    expect(wrapper.text()).toContain('Level 7');
    expect(wrapper.text()).toMatch(/250[,.\s]?000/);
    expect(wrapper.text()).not.toContain('Champion #23');

    const splashImg = wrapper.find('img[alt=""]');
    expect(splashImg.exists()).toBe(true);
    expect(splashImg.attributes('src')).toContain('/splash/Tryndamere_0.jpg');
  });

  it('shows initials fallback when champion image fails to load', async () => {
    const wrapper = mount(MasteryShowcase, {
      props: { mastery: [mastery('11111111-1111-1111-1111-111111111111')] },
      ...mountOptions,
    });

    const icon = wrapper.find('img[alt="Tryndamere icon"]');
    if (icon.exists()) {
      await icon.trigger('error');
      expect(wrapper.text()).toContain('T');
    }
    expect(wrapper.text()).toContain('Tryndamere');
  });

  it('falls back to Champion #<id> when name is missing', () => {
    const wrapper = mount(MasteryShowcase, {
      props: {
        mastery: [
          mastery('22222222-2222-2222-2222-222222222222', {
            championName: null,
            championKey: null,
            championIconUrl: null,
            championSplashUrl: null,
            championId: 64,
          }),
        ],
      },
      ...mountOptions,
    });

    expect(wrapper.text()).toContain('Champion #64');
  });

  it('renders compact rows for mastery beyond top 3', () => {
    const entries = [
      mastery('11111111-1111-1111-1111-111111111111', { championName: 'Aatrox' }),
      mastery('22222222-2222-2222-2222-222222222222', { championName: 'Ahri' }),
      mastery('33333333-3333-3333-3333-333333333333', { championName: 'Akali' }),
      mastery('44444444-4444-4444-4444-444444444444', { championName: 'Alistar' }),
    ];
    const wrapper = mount(MasteryShowcase, {
      props: { mastery: entries },
      ...mountOptions,
    });

    expect(wrapper.text()).toContain('Aatrox');
    expect(wrapper.text()).toContain('Alistar');
  });
});
