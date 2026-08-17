import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  CHAMPION_STATS_DISCLAIMER,
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  RANK_TIER_SEMANTICS,
  type PlayerMetricComparison,
  type PlayerPlaystyleResponse,
} from '@league-helper/shared';
import PlayerPlaystylePanel from './PlayerPlaystylePanel.vue';

const SUMMARY =
  'This player’s recent Ranked Solo sample leans toward a farming-forward mid-lane pattern relative to matched baselines.';
const ECONOMY =
  'Farming sits near the matched champion baselines across this recent Ranked Solo window.';
const COMBAT =
  'Combat volume is a bit higher than matched baselines, with deaths staying close to typical.';
const STRENGTH =
  'Consistent farm relative to the matched mid-lane baseline in this collected sample.';
const TRADEOFF =
  'All-in frequency looks higher than the matched baseline, which can swing some games.';
const TENDENCY =
  'Ahri mid games in this sample show a farming-first pattern before looking for picks.';

function comparison(
  overrides: Partial<PlayerMetricComparison> & Pick<PlayerMetricComparison, 'metric'>,
): PlayerMetricComparison {
  return {
    playerValue: 7.2,
    baseline: {
      value: 7.0,
      sampleSize: 1000,
      sampleConfidence: 'HIGH',
      rankTier: 'GOLD',
      usedAllTierFallback: false,
    },
    delta: 0.2,
    comparableMatchCount: 12,
    direction: 'NEAR_BASELINE',
    interpretationAllowed: true,
    ...overrides,
  };
}

function playstyle(overrides: Partial<PlayerPlaystyleResponse> = {}): PlayerPlaystyleResponse {
  return {
    disclaimer: CHAMPION_STATS_DISCLAIMER,
    aiDisclaimer: PLAYER_PLAYSTYLE_AI_DISCLAIMER,
    rankSemantics: RANK_TIER_SEMANTICS,
    sampleScope: {
      kind: 'COLLECTED_SAMPLE',
      queueId: 420,
      matchWindow: 20,
      windowSize: 20,
      matchesAnalyzed: 18,
      comparableMatchCount: 16,
      wins: 10,
      playerSampleBand: 'CREDIBLE',
      patchRange: { min: '16.14', max: '16.15' },
    },
    mix: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
      },
    ],
    overall: {
      comparisons: [
        comparison({ metric: 'CS_PER_MIN', playerValue: 7.2, direction: 'NEAR_BASELINE' }),
        comparison({
          metric: 'GOLD_PER_MIN',
          playerValue: null,
          baseline: {
            value: null,
            sampleSize: 800,
            sampleConfidence: 'MEDIUM',
            rankTier: 'ALL',
            usedAllTierFallback: true,
          },
          delta: 37.91,
          comparableMatchCount: 8,
          direction: 'ABOVE_BASELINE',
        }),
        comparison({ metric: 'KILLS_PER_GAME', playerValue: 6.1, direction: 'ABOVE_BASELINE' }),
        comparison({ metric: 'DEATHS_PER_GAME', playerValue: 4.8, direction: 'NEAR_BASELINE' }),
        comparison({ metric: 'ASSISTS_PER_GAME', playerValue: 7.4, direction: 'BELOW_BASELINE' }),
        comparison({ metric: 'DAMAGE_PER_MIN', playerValue: 512.3, direction: 'NEAR_BASELINE' }),
        comparison({ metric: 'VISION_PER_MIN', playerValue: 1.1, direction: 'BELOW_BASELINE' }),
        comparison({
          metric: 'GOLD_DIFF_AT_10',
          playerValue: 80,
          direction: 'NOT_COMPARABLE',
          interpretationAllowed: false,
        }),
      ],
    },
    championSlices: [
      {
        championKey: 'Ahri',
        championName: 'Ahri',
        position: 'MIDDLE',
        matchCount: 8,
        sampleBand: 'EXPLORATORY',
        comparisons: [
          comparison({
            metric: 'CS_PER_MIN',
            playerValue: 8.1,
            baseline: {
              value: 7.4,
              sampleSize: 420,
              sampleConfidence: 'HIGH',
              rankTier: 'GOLD',
              usedAllTierFallback: false,
            },
            delta: 0.7,
            comparableMatchCount: 8,
            direction: 'ABOVE_BASELINE',
          }),
          comparison({
            metric: 'KDA',
            playerValue: 3.4,
            baseline: {
              value: 3.1,
              sampleSize: 420,
              sampleConfidence: 'HIGH',
              rankTier: 'GOLD',
              usedAllTierFallback: false,
            },
            delta: 0.3,
            comparableMatchCount: 8,
            direction: 'NEAR_BASELINE',
          }),
        ],
      },
    ],
    skipped: { remake: 1, incomplete: 0, unknownPosition: 1, noBaseline: 0 },
    ai: {
      status: 'DISABLED',
      emptyReason: 'AI_DISABLED',
      insight: null,
    },
    ...overrides,
  };
}

function availableInsight(): NonNullable<PlayerPlaystyleResponse['ai']['insight']> {
  return {
    summary: SUMMARY,
    economy: ECONOMY,
    combat: COMBAT,
    strengths: [STRENGTH],
    tradeoffs: [TRADEOFF],
    championTendencies: [
      {
        championKey: 'Ahri',
        position: 'MIDDLE',
        text: TENDENCY,
      },
    ],
    generatedAt: '2026-08-14T07:00:00.000Z',
  };
}

function mountPanel(response: PlayerPlaystyleResponse, pending = false) {
  return mount(PlayerPlaystylePanel, {
    props: { playstyle: response, pending },
  });
}

describe('PlayerPlaystylePanel', () => {
  it('shows an honest empty line and no direction rows when the sample is INSUFFICIENT', () => {
    const wrapper = mountPanel(
      playstyle({
        sampleScope: {
          kind: 'COLLECTED_SAMPLE',
          queueId: 420,
          matchWindow: 20,
          windowSize: 3,
          matchesAnalyzed: 3,
          comparableMatchCount: 2,
          wins: 1,
          playerSampleBand: 'INSUFFICIENT',
          patchRange: null,
        },
        overall: { comparisons: [] },
        championSlices: [],
        mix: [],
      }),
    );

    expect(wrapper.find('[data-testid="player-playstyle"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Your playstyle');
    expect(wrapper.text()).toContain(
      'Not enough recent Ranked Solo games for a playstyle profile.',
    );
    expect(wrapper.text()).not.toContain('Above baseline');
    expect(wrapper.text()).not.toContain('Near baseline');
    expect(wrapper.text()).not.toContain('Below baseline');
    expect(wrapper.text()).not.toContain('Farming');
    expect(wrapper.text()).not.toContain('Combat');
  });

  it('shows overall direction labels without raw CS/min, GPM, DPM, or KDA numbers', () => {
    const wrapper = mountPanel(playstyle());
    const text = wrapper.text();
    const overall = wrapper.get('[data-testid="player-playstyle-overall"]').text();

    expect(text).toContain('Your playstyle');
    expect(overall).toContain('Farming');
    expect(overall).toContain('Combat');
    expect(overall).toContain('Vision');
    expect(overall).toContain('Early lane');
    expect(overall).toContain('CS/min');
    expect(overall).toContain('Gold/min');
    expect(overall).toContain('Damage/min');
    expect(overall).toContain('Near baseline');
    expect(overall).toContain('Above baseline');
    expect(overall).toContain('Below baseline');
    expect(overall).toContain('Not comparable');
    expect(text).toContain('16');
    expect(text).toContain('Ranked Solo');
    expect(text).toContain('last 20');
    expect(text).toContain(CHAMPION_STATS_DISCLAIMER);
    expect(text).toContain(RANK_TIER_SEMANTICS);

    expect(overall).not.toContain('7.2');
    expect(overall).not.toContain('37.91');
    expect(overall).not.toContain('512.3');
    expect(overall).not.toMatch(/\bKDA\b/);
  });

  it('shows You / Baseline / Δ numbers on champion slices including KDA', () => {
    const wrapper = mountPanel(playstyle());
    const text = wrapper.text();

    expect(text).toContain('Ahri');
    expect(text).toContain('You');
    expect(text).toContain('Baseline');
    expect(text).toContain('Δ');
    expect(text).toContain('8.1');
    expect(text).toContain('7.4');
    expect(text).toContain('KDA');
    expect(text).toContain('3.4');
  });

  it('shows comparison cards and omits the AI panel when AI is DISABLED', () => {
    const wrapper = mountPanel(playstyle());
    expect(wrapper.text()).toContain('Farming');
    expect(wrapper.text()).toContain('Near baseline');
    expect(wrapper.find('[data-testid="player-playstyle-ai"]').exists()).toBe(false);
  });

  it('shows generating copy when AI status is PENDING', () => {
    const wrapper = mountPanel(
      playstyle({
        ai: { status: 'PENDING', insight: null },
      }),
    );
    expect(wrapper.text()).toContain('Generating AI playstyle analysis…');
    expect(wrapper.find('[data-testid="player-playstyle-ai"]').exists()).toBe(true);
  });

  it('shows AVAILABLE summary sections and never renders evidence ids', () => {
    const wrapper = mountPanel(
      playstyle({
        ai: { status: 'AVAILABLE', insight: availableInsight() },
      }),
    );
    const html = wrapper.html();
    expect(wrapper.text()).toContain('Playstyle summary');
    expect(wrapper.text()).toContain(SUMMARY);
    expect(wrapper.text()).toContain(ECONOMY);
    expect(wrapper.text()).toContain(PLAYER_PLAYSTYLE_AI_DISCLAIMER);
    expect(html).not.toContain('OVERALL_CS_PER_MIN');
    expect(html).not.toContain('OVERALL_');
    expect(html).not.toContain('SLICE_');
    expect(html).not.toContain('E1');
  });

  it('does not render HTML tags from model text', () => {
    const summary = `<b>injected</b>${'x'.repeat(80)}`;
    const wrapper = mountPanel(
      playstyle({
        ai: {
          status: 'AVAILABLE',
          insight: {
            ...availableInsight(),
            summary,
          },
        },
      }),
    );
    expect(wrapper.find('b').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('<b>injected</b>');
    expect(wrapper.html()).toContain('&lt;b&gt;');
    expect(wrapper.text()).toContain('<b>injected</b>');
  });
});
