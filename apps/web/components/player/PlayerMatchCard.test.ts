import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { PublicMatchSummary } from '@league-helper/shared';
import PlayerMatchCard from '~/components/player/PlayerMatchCard.vue';

function match(overrides: Partial<PublicMatchSummary> = {}): PublicMatchSummary {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    externalMatchId: 'NA1_100',
    queueId: 420,
    gameCreation: new Date(Date.now() - 3_600_000).toISOString(),
    gameDurationSeconds: 1823,
    gameVersion: '14.11.1.123',
    normalizedPatch: '14.11',
    remake: false,
    earlySurrender: false,
    result: 'victory',
    championId: 23,
    championKey: 'Tryndamere',
    championName: 'Tryndamere',
    championIconUrl: 'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
    teamPosition: 'TOP',
    role: 'TOP',
    win: true,
    kills: 5,
    deaths: 2,
    assists: 7,
    kda: 6,
    totalCs: 200,
    csPerMinute: 6.6,
    killParticipation: 0.55,
    itemIds: [3031, 3071],
    itemIconUrls: [
      'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/item/3031.png',
      'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/item/3071.png',
    ],
    summonerSpell1Id: 4,
    summonerSpell2Id: 12,
    goldAt10: 3000,
    goldAt15: 5000,
    csAt10: 70,
    csAt15: 110,
    xpAt10: null,
    xpAt15: null,
    goldDifferenceAt10: 200,
    goldDifferenceAt15: null,
    csDifferenceAt10: null,
    csDifferenceAt15: null,
    timelineMetricsAvailable: true,
    ingestionStatus: 'COMPLETED',
    ...overrides,
  };
}

const nuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
};

function mountCard(matchProp: ReturnType<typeof match>) {
  return mount(PlayerMatchCard, {
    props: { match: matchProp },
    global: { stubs: { NuxtLink: nuxtLinkStub } },
  });
}

describe('PlayerMatchCard', () => {
  it('renders victory card with champion, role, KDA, CS, KP, items, queue, patch', () => {
    const wrapper = mountCard(match());
    expect(wrapper.text()).toContain('Victory');
    expect(wrapper.text()).toContain('Tryndamere');
    expect(wrapper.text()).toContain('Top');
    expect(wrapper.text()).toContain('5/2/7');
    expect(wrapper.text()).toContain('200 CS');
    expect(wrapper.text()).toContain('55% KP');
    expect(wrapper.text()).toContain('Ranked Solo/Duo');
    expect(wrapper.text()).toContain('Patch 14.11');
    expect(wrapper.findAll('img').length).toBeGreaterThanOrEqual(3);
    expect(wrapper.html().toLowerCase()).not.toContain('puuid');
  });

  it('links champion name to detail path when championKey is present', () => {
    const wrapper = mountCard(match());
    const links = wrapper.findAll('a').filter((a) => a.attributes('href') === '/champions/Tryndamere');
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('does not link when championKey is null', () => {
    const wrapper = mountCard(match({ championKey: null }));
    expect(wrapper.findAll('a').length).toBe(0);
  });

  it('uses Data Dragon champion icon src and falls back on image error', async () => {
    const wrapper = mountCard(match());
    const championImg = wrapper.get('img[alt="Tryndamere icon"]');
    expect(championImg.attributes('src')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
    );
    await championImg.trigger('error');
    expect(wrapper.find('img[alt="Tryndamere icon"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Tryndamere');
    expect(wrapper.text()).toContain('T');
  });

  it('labels unknown queue IDs safely', () => {
    const wrapper = mountCard(match({ queueId: 1234 }));
    expect(wrapper.text()).toContain('Queue 1234');
  });

  it('renders normalized position labels and never shows raw SOLO/DUO_SUPPORT', () => {
    expect(mountCard(match({ role: 'MIDDLE', teamPosition: 'MIDDLE' })).text()).toContain('Mid');
    expect(mountCard(match({ role: 'SUPPORT', teamPosition: 'SUPPORT' })).text()).toContain(
      'Support',
    );
    expect(mountCard(match({ role: 'UNKNOWN', teamPosition: 'UNKNOWN' })).text()).toContain(
      'Unknown role',
    );
    const html = mountCard(match({ role: 'TOP', teamPosition: 'TOP' })).html();
    expect(html).not.toContain('SOLO');
    expect(html).not.toContain('DUO_SUPPORT');
  });

  it('renders remake result distinctly', () => {
    const wrapper = mountCard(
      match({
        remake: true,
        result: 'remake',
        win: true,
        timelineMetricsAvailable: false,
      }),
    );
    expect(wrapper.text()).toContain('Remake');
    expect(wrapper.text()).not.toContain('Victory');
  });
});
