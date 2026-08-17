import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  PLAYER_PLAYSTYLE_AI_DISCLAIMER,
  type PlayerPlaystyleResponse,
} from '@league-helper/shared';
import PlayerPlaystyleAiPanel from './PlayerPlaystyleAiPanel.vue';

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

function insight(
  overrides: Partial<NonNullable<PlayerPlaystyleResponse['ai']['insight']>> = {},
): NonNullable<PlayerPlaystyleResponse['ai']['insight']> {
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
    ...overrides,
  };
}

function ai(
  status: PlayerPlaystyleResponse['ai']['status'],
  insightValue: PlayerPlaystyleResponse['ai']['insight'] = null,
  emptyReason?: PlayerPlaystyleResponse['ai']['emptyReason'],
): PlayerPlaystyleResponse['ai'] {
  return {
    status,
    ...(emptyReason ? { emptyReason } : {}),
    insight: insightValue,
  };
}

function mountPanel(
  props: {
    ai?: PlayerPlaystyleResponse['ai'] | null;
    aiDisclaimer?: string;
    pending?: boolean;
    error?: string | null;
  } = {},
) {
  return mount(PlayerPlaystyleAiPanel, {
    props: {
      ai: props.ai === undefined ? ai('AVAILABLE', insight()) : props.ai,
      aiDisclaimer: props.aiDisclaimer ?? PLAYER_PLAYSTYLE_AI_DISCLAIMER,
      pending: props.pending,
      error: props.error,
    },
  });
}

describe('PlayerPlaystyleAiPanel', () => {
  it('shows summary, optional sections, and disclaimer for an AVAILABLE insight', () => {
    const wrapper = mountPanel();
    const text = wrapper.text();
    expect(wrapper.find('[data-testid="player-playstyle-ai"]').exists()).toBe(true);
    expect(text).toContain('Playstyle summary');
    expect(text).toContain(SUMMARY);
    expect(text).toContain('Economy');
    expect(text).toContain(ECONOMY);
    expect(text).toContain('Combat');
    expect(text).toContain(COMBAT);
    expect(text).toContain('Strengths');
    expect(text).toContain(STRENGTH);
    expect(text).toContain('Tradeoffs');
    expect(text).toContain(TRADEOFF);
    expect(text).toContain('Champion tendencies');
    expect(text).toContain(TENDENCY);
    expect(text).toContain(PLAYER_PLAYSTYLE_AI_DISCLAIMER);
    expect(text).not.toMatch(/coaching recommendation/i);
    expect(wrapper.html()).not.toContain('OVERALL_CS_PER_MIN');
    expect(wrapper.html()).not.toContain('SLICE_');
    expect(wrapper.html()).not.toContain('E1');
  });

  it('omits Economy and Combat headings when those fields are null', () => {
    const wrapper = mountPanel({
      ai: ai('AVAILABLE', insight({ economy: null, combat: null })),
    });
    expect(wrapper.text()).toContain('Playstyle summary');
    expect(wrapper.text()).not.toContain('Economy');
    expect(wrapper.text()).not.toContain('Combat');
  });

  it('shows generating copy while pending', () => {
    const wrapper = mountPanel({ ai: null, pending: true });
    expect(wrapper.text()).toContain('Generating AI playstyle analysis…');
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('shows generating copy when status is PENDING', () => {
    const wrapper = mountPanel({ ai: ai('PENDING') });
    expect(wrapper.text()).toContain('Generating AI playstyle analysis…');
  });

  it('renders empty when DISABLED', () => {
    const wrapper = mountPanel({ ai: ai('DISABLED', null, 'AI_DISABLED') });
    expect(wrapper.find('[data-testid="player-playstyle-ai"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('renders empty when ai is null and not pending', () => {
    const wrapper = mountPanel({ ai: null, pending: false });
    expect(wrapper.find('[data-testid="player-playstyle-ai"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('shows honest empty copy for LOW_CONFIDENCE', () => {
    const wrapper = mountPanel({ ai: ai('LOW_CONFIDENCE', null, 'INSUFFICIENT_SAMPLE') });
    expect(wrapper.text()).toMatch(/not enough/i);
    expect(wrapper.find('[data-testid="player-playstyle-ai"]').exists()).toBe(true);
  });

  it('shows honest empty copy for UNAVAILABLE and fetch error', () => {
    const unavailable = mountPanel({ ai: ai('UNAVAILABLE', null, 'GENERATION_FAILED') });
    expect(unavailable.text()).toMatch(/unavailable/i);

    const errored = mountPanel({
      ai: null,
      error: 'Unable to load playstyle analysis.',
    });
    expect(errored.find('[data-testid="player-playstyle-ai"]').exists()).toBe(true);
    expect(errored.text()).toMatch(/unavailable/i);
  });

  it('renders HTML tags in model text as text, not DOM elements', () => {
    const summary = `<script>alert(1)</script>${'x'.repeat(80)}`;
    const wrapper = mountPanel({
      ai: ai('AVAILABLE', insight({ summary })),
    });
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('<script>alert(1)</script>');
    expect(wrapper.html()).toContain('&lt;script&gt;');
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
    expect(wrapper.html()).not.toContain('v-html');
  });
});
