import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ChampionAiInsightsResponse, ChampionBuildsResponse } from '@league-helper/shared';
import {
  CHAMPION_AI_DISCLAIMER,
  CHAMPION_STATS_DISCLAIMER,
  RANK_TIER_SEMANTICS,
} from '@league-helper/shared';
import ChampionAiInsightPanel from './ChampionAiInsightPanel.vue';
import ChampionBuildSection from './ChampionBuildSection.vue';
import ChampionBuildsPanel from './ChampionBuildsPanel.vue';

function identity(id: number, name: string) {
  return { id, name, iconUrl: `https://cdn.example.test/${id}.png` };
}

const metrics = {
  sampleSize: 24,
  pickRate: 0.42,
  wins: 14,
  winRate: 14 / 24,
  lowSample: false,
  sampleBand: 'STRONG' as const,
};

function response(overrides: Partial<ChampionBuildsResponse> = {}): ChampionBuildsResponse {
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    rankTierSemantics: RANK_TIER_SEMANTICS,
    sampleScope: { kind: 'COLLECTED_SAMPLE', platform: 'na1', patch: '16.15', queueId: 420 },
    resolvedFilters: {
      platform: 'na1',
      patch: '16.15',
      queueId: 420,
      tier: 'ALL',
      position: 'MIDDLE',
    },
    emptyReason: null,
    eligibility: {
      startingItemsEligibleGames: 40,
      coreBuildsEligibleGames: 30,
      bootsEligibleGames: 40,
      runesEligibleGames: 40,
      summonerSpellsEligibleGames: 40,
      skillOrderEligibleGames: 40,
    },
    startingItems: [
      { ...metrics, items: [identity(1056, "Doran's Ring"), identity(2003, 'Health Potion')] },
    ],
    coreBuilds: [
      {
        ...metrics,
        items: [
          identity(3116, "Rylai's Crystal Scepter"),
          identity(3089, "Rabadon's Deathcap"),
          identity(3135, 'Void Staff'),
        ],
      },
    ],
    boots: [{ ...metrics, item: identity(3020, "Sorcerer's Shoes") }],
    runes: [
      {
        ...metrics,
        keystone: identity(8112, 'Electrocute'),
        primaryPerks: [identity(8112, 'Electrocute')],
        secondaryPerks: [identity(8226, 'Manaflow Band')],
        statShards: [],
        primaryStyleName: 'Domination',
        secondaryStyleName: 'Sorcery',
        stylesComplete: true,
      },
    ],
    summonerSpells: [
      {
        ...metrics,
        spells: [identity(4, 'Flash'), identity(12, 'Teleport')],
      },
    ],
    skillOrder: [
      { ...metrics, maxOrder: ['Q', 'E', 'W'], levelSequence: ['Q', 'W', 'E', 'Q', 'Q', 'R'] },
    ],
    ...overrides,
  };
}

function mountPanel(
  props: {
    response?: ChampionBuildsResponse | null;
    pending?: boolean;
    error?: string | null;
    insight?: ChampionAiInsightsResponse | null;
    insightPending?: boolean;
    insightError?: string | null;
  } = {},
) {
  return mount(ChampionBuildsPanel, {
    props: {
      response: props.response === undefined ? response() : props.response,
      pending: props.pending,
      error: props.error,
      insight: props.insight,
      insightPending: props.insightPending,
      insightError: props.insightError,
    },
    global: {
      components: {
        ChampionsChampionBuildSection: ChampionBuildSection,
        ChampionsChampionAiInsightPanel: ChampionAiInsightPanel,
      },
      stubs: {
        PlayerErrorBanner: { template: '<p class="error">{{ message }}</p>', props: ['message'] },
      },
    },
  });
}

describe('ChampionBuildsPanel', () => {
  it('renders starting items, core, boots, runes, spells, and skill order', () => {
    const wrapper = mountPanel();
    const text = wrapper.text();
    expect(wrapper.find('[data-testid="champion-builds-panel"]').exists()).toBe(true);
    expect(text).toContain('Starting items');
    expect(text).toContain('Core build');
    expect(text).toContain('Boots');
    expect(text).toContain('Runes');
    expect(text).toContain('Summoner spells');
    expect(text).toContain('Skill order');
    expect(text).toContain('Most common basic ability leveling priority.');
    expect(text).toContain('Q > E > W');
    expect(text).toContain('Common leveling sequence Q W E Q Q R');
    expect(text).not.toContain('first-level');
    expect(wrapper.find('img[alt="Doran\'s Ring"]').exists()).toBe(true);
    expect(wrapper.find('img[alt="Flash"]').exists()).toBe(true);
    expect(wrapper.find('img[alt="Rylai\'s Crystal Scepter"]').exists()).toBe(true);
    expect(wrapper.find('img[alt="Rabadon\'s Deathcap"]').exists()).toBe(true);
    expect(wrapper.find('img[alt="Void Staff"]').exists()).toBe(true);
    expect(text).toContain('First three completed major items');
    expect(text).toContain("Sorcerer's Shoes");
    expect(text).toContain('42.0% pick');
    expect(wrapper.find('.overflow-x-auto').exists()).toBe(true);
  });

  it('shows loading and error states', () => {
    expect(mountPanel({ response: null, pending: true }).text()).toContain(
      'Loading collected build data',
    );
    expect(
      mountPanel({ response: null, error: 'Unable to load champion builds.' }).text(),
    ).toContain('Unable to load champion builds.');
  });

  it('keeps low-sample rows honest and omits 100% win rate', () => {
    const wrapper = mountPanel({
      response: response({
        startingItems: [
          {
            sampleSize: 3,
            pickRate: 0.1,
            wins: 3,
            winRate: null,
            lowSample: true,
            sampleBand: 'BELOW_DISPLAY',
            items: [identity(1056, "Doran's Ring")],
          },
        ],
        coreBuilds: [
          {
            sampleSize: 3,
            pickRate: 0.1,
            wins: 3,
            winRate: null,
            lowSample: true,
            sampleBand: 'BELOW_DISPLAY',
            items: [identity(3116, "Rylai's Crystal Scepter")],
          },
        ],
        boots: [],
        runes: [],
        summonerSpells: [],
        skillOrder: [],
      }),
    });
    expect(wrapper.text()).toContain('Limited sample');
    expect(wrapper.text()).not.toContain('100%');
  });

  it('renders the empty collected-sample state', () => {
    const wrapper = mountPanel({
      response: response({
        emptyReason: 'CHAMPION_HAS_NO_BUILDS',
        startingItems: [],
        coreBuilds: [],
        boots: [],
        runes: [],
        summonerSpells: [],
        skillOrder: [],
      }),
    });
    expect(wrapper.get('[data-testid="builds-empty"]').text()).toMatch(/Not enough current-patch/i);
  });

  it('uses maxOrder as the headline and never lets early sequence override it', () => {
    const wrapper = mountPanel({
      response: response({
        skillOrder: [
          {
            ...metrics,
            maxOrder: ['W', 'E', 'Q'],
            levelSequence: ['E', 'W', 'Q', 'W', 'W', 'R', 'W', 'E', 'W'],
          },
        ],
      }),
    });
    const text = wrapper.text();
    expect(text).toContain('W > E > Q');
    expect(text).not.toContain('E > W > Q');
    expect(text).toContain('Common leveling sequence E W Q W W R W E W');
    expect(text).toContain('Most common basic ability leveling priority.');
  });

  it('keeps limited-sample copy on skill-order rows', () => {
    const wrapper = mountPanel({
      response: response({
        skillOrder: [
          {
            sampleSize: 3,
            pickRate: 0.1,
            wins: 3,
            winRate: null,
            lowSample: true,
            sampleBand: 'BELOW_DISPLAY',
            maxOrder: ['Q', 'W', 'E'],
            levelSequence: [],
          },
        ],
      }),
    });
    expect(wrapper.text()).toContain('Q > W > E');
    expect(wrapper.text()).toContain('Limited sample');
    expect(wrapper.text()).not.toContain('Common leveling sequence');
  });

  it('does not render incomplete Q or Q > W skill-priority rows', () => {
    const wrapper = mountPanel({
      response: response({
        skillOrder: [
          {
            ...metrics,
            maxOrder: ['Q'],
            levelSequence: ['Q', 'W', 'E'],
          },
          {
            ...metrics,
            maxOrder: ['Q', 'W'],
            levelSequence: [],
          },
        ],
      }),
    });
    const text = wrapper.text();
    expect(text).not.toContain('Q > W');
    expect(text).not.toContain('Q > W > E');
    expect(text).toContain('No skill-order data in this sample.');
  });

  it('does not render one-item or two-item core builds', () => {
    const wrapper = mountPanel({
      response: response({
        coreBuilds: [
          { ...metrics, items: [identity(3116, "Rylai's Crystal Scepter")] },
          {
            ...metrics,
            items: [
              identity(3116, "Rylai's Crystal Scepter"),
              identity(3089, "Rabadon's Deathcap"),
            ],
          },
        ],
      }),
    });
    const text = wrapper.text();
    expect(text).not.toContain("Rylai's Crystal Scepter");
    expect(text).toContain('Not enough games reached a complete 3-item core build');
  });

  it('renders an AI explanation after the low-sample banner when insight is available', () => {
    const buildInsight =
      'The common core in this sample leans into ability power and repeated poke after the first items.';
    const wrapper = mountPanel({
      insight: {
        disclaimer: CHAMPION_STATS_DISCLAIMER,
        aiDisclaimer: CHAMPION_AI_DISCLAIMER,
        sampleScope: { kind: 'COLLECTED_SAMPLE', platform: 'na1', patch: '16.15', queueId: 420 },
        resolvedFilters: {
          platform: 'na1',
          patch: '16.15',
          queueId: 420,
          tier: 'ALL',
          position: 'MIDDLE',
        },
        status: 'AVAILABLE',
        insight: {
          summary:
            'Ahri looks slightly favored in this collected mid-lane sample, trading well when charm lands and orb control follows in the lane.',
          strengths: [],
          weaknesses: [],
          buildInsight,
          matchupInsights: [],
          generatedAt: '2026-08-13T07:00:00.000Z',
        },
      },
    });
    const text = wrapper.text();
    expect(text).toContain('AI explanation');
    expect(text).toContain(buildInsight);
    expect(text).toContain('Starting items');
    expect(text).not.toMatch(/ai coaching/i);
  });
});
