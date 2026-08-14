import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import {
  CHAMPION_AI_DISCLAIMER,
  CHAMPION_STATS_DISCLAIMER,
  type ChampionAiInsightsResponse,
} from '@league-helper/shared';
import ChampionAiInsightPanel from './ChampionAiInsightPanel.vue';

const SUMMARY =
  'Ahri looks slightly favored in this collected mid-lane sample, trading well when charm lands and orb control follows in the lane.';
const STRENGTH =
  'Charm-into-orb trades look like a consistent way she creates pressure in this sample.';
const WEAKNESS = 'She can struggle when opponents keep the wave frozen and deny easy charm angles.';
const BUILD_INSIGHT =
  'The common core in this sample leans into ability power and repeated poke after the first items.';

function insight(
  overrides: Partial<NonNullable<ChampionAiInsightsResponse['insight']>> = {},
): NonNullable<ChampionAiInsightsResponse['insight']> {
  return {
    summary: SUMMARY,
    strengths: [STRENGTH],
    weaknesses: [WEAKNESS],
    buildInsight: BUILD_INSIGHT,
    matchupInsights: [],
    generatedAt: '2026-08-13T07:00:00.000Z',
    ...overrides,
  };
}

function response(
  status: ChampionAiInsightsResponse['status'],
  insightValue: ChampionAiInsightsResponse['insight'] = null,
): ChampionAiInsightsResponse {
  return {
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
    status,
    insight: insightValue,
  };
}

function mountPanel(
  props: {
    response?: ChampionAiInsightsResponse | null;
    pending?: boolean;
    error?: string | null;
    variant?: 'overview' | 'builds';
  } = {},
) {
  return mount(ChampionAiInsightPanel, {
    props: {
      response: props.response === undefined ? response('AVAILABLE', insight()) : props.response,
      pending: props.pending,
      error: props.error,
      variant: props.variant ?? 'overview',
    },
  });
}

describe('ChampionAiInsightPanel', () => {
  it('shows summary, heading, and disclaimer for an AVAILABLE overview', () => {
    const wrapper = mountPanel();
    const text = wrapper.text();
    expect(wrapper.find('[data-testid="champion-ai-insight"]').exists()).toBe(true);
    expect(text).toContain('AI Insight');
    expect(text).toContain(SUMMARY);
    expect(text).toContain(STRENGTH);
    expect(text).toContain(WEAKNESS);
    expect(text).toContain(CHAMPION_AI_DISCLAIMER);
    expect(text).not.toMatch(/ai coaching/i);
  });

  it('shows unavailable copy', () => {
    const wrapper = mountPanel({ response: response('UNAVAILABLE') });
    expect(wrapper.text()).toContain('AI insight unavailable.');
    expect(wrapper.text()).not.toContain('AI Insight');
  });

  it('shows generating copy while pending', () => {
    const wrapper = mountPanel({ response: null, pending: true });
    expect(wrapper.text()).toContain('Generating AI insight…');
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });

  it('shows generating copy when status is PENDING', () => {
    const wrapper = mountPanel({ response: response('PENDING') });
    expect(wrapper.text()).toContain('Generating AI insight…');
  });

  it('renders empty when DISABLED', () => {
    const wrapper = mountPanel({ response: response('DISABLED') });
    expect(wrapper.find('[data-testid="champion-ai-insight"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('renders empty when response is null and not pending', () => {
    const wrapper = mountPanel({ response: null, pending: false });
    expect(wrapper.find('[data-testid="champion-ai-insight"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('shows low-confidence copy', () => {
    const wrapper = mountPanel({ response: response('LOW_CONFIDENCE') });
    expect(wrapper.text()).toContain('Not enough collected-sample evidence for an AI explanation.');
  });

  it('shows unavailable copy on fetch error without failing the host', () => {
    const wrapper = mountPanel({
      response: null,
      error: 'Unable to load champion insights.',
    });
    expect(wrapper.find('[data-testid="champion-ai-insight"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('AI insight unavailable.');
  });

  it('renders HTML tags in summary as text, not DOM elements', () => {
    const summary = `<script>alert(1)</script>${'x'.repeat(80)}`;
    const wrapper = mountPanel({
      response: response('AVAILABLE', insight({ summary })),
    });
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('<script>alert(1)</script>');
    expect(wrapper.html()).toContain('&lt;script&gt;');
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });

  it('shows buildInsight under AI explanation for the builds variant', () => {
    const wrapper = mountPanel({ variant: 'builds' });
    expect(wrapper.text()).toContain('AI explanation');
    expect(wrapper.text()).toContain(BUILD_INSIGHT);
    expect(wrapper.text()).not.toContain(SUMMARY);
    expect(wrapper.text()).toContain(CHAMPION_AI_DISCLAIMER);
  });

  it('omits the builds variant when buildInsight is null', () => {
    const wrapper = mountPanel({
      variant: 'builds',
      response: response('AVAILABLE', insight({ buildInsight: null })),
    });
    expect(wrapper.find('[data-testid="champion-ai-insight"]').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });
});
