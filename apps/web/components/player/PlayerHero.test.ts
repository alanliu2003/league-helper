import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { PublicPlayer } from '@league-helper/shared';
import PlayerHero from '~/components/player/PlayerHero.vue';

function player(overrides: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    accountId: '00000000-0000-4000-8000-000000000002',
    provider: 'RIOT',
    platform: 'na1',
    regionalRoute: 'americas',
    riotId: { gameName: 'ExamplePlayer', tagLine: 'NA1' },
    profileIconId: 1,
    profileIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/profileicon/1.png',
    summonerLevel: 100,
    lastResolvedAt: '2024-06-01T12:00:00.000Z',
    ...overrides,
  };
}

const splashUrl = 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Tryndamere_0.jpg';

describe('PlayerHero', () => {
  it('renders splash background from backend-provided championSplashUrl', () => {
    const wrapper = mount(PlayerHero, {
      props: {
        player: player(),
        splashUrl,
      },
    });

    const splashImg = wrapper.find('img[alt=""]');
    expect(splashImg.exists()).toBe(true);
    expect(splashImg.attributes('src')).toBe(splashUrl);
    expect(splashImg.attributes('width')).toBe('1215');
    expect(splashImg.attributes('height')).toBe('717');
  });

  it('shows neutral fallback when splash URL is null', () => {
    const wrapper = mount(PlayerHero, {
      props: {
        player: player(),
        splashUrl: null,
      },
    });

    expect(wrapper.find('img[alt=""]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Player profile"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('ExamplePlayer');
  });

  it('falls back when splash image fails to load', async () => {
    const wrapper = mount(PlayerHero, {
      props: {
        player: player(),
        splashUrl,
      },
    });

    await wrapper.find('img[alt=""]').trigger('error');
    expect(wrapper.find('img[alt=""]').exists()).toBe(false);
    expect(wrapper.text()).toContain('ExamplePlayer');
  });

  it('falls back when profile icon fails to load', async () => {
    const wrapper = mount(PlayerHero, {
      props: {
        player: player(),
        splashUrl: null,
      },
    });

    await wrapper.get('img[alt="ExamplePlayer profile icon"]').trigger('error');
    expect(wrapper.find('img[alt="ExamplePlayer profile icon"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('1');
  });
});
