import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChampionAbilitySummary } from '@league-helper/shared';
import ChampionAbilityBar from './ChampionAbilityBar.vue';

function ability(
  slot: ChampionAbilitySummary['slot'],
  overrides: Partial<ChampionAbilitySummary> = {},
): ChampionAbilitySummary {
  const names: Record<ChampionAbilitySummary['slot'], string> = {
    PASSIVE: 'Essence Theft',
    Q: 'Orb of Deception',
    W: 'Fox-Fire',
    E: 'Charm',
    R: 'Spirit Rush',
  };
  return {
    slot,
    name: names[slot],
    description: `${names[slot]} description`,
    iconUrl: `https://cdn.example.test/${slot}.png`,
    ...overrides,
  };
}

const ahriAbilities: ChampionAbilitySummary[] = [
  ability('PASSIVE', { cooldown: undefined, cost: undefined, range: undefined }),
  ability('Q', { cooldown: '7', cost: '55/65/75/85/95', range: '900' }),
  ability('W', { cooldown: '9', cost: '30', range: '700' }),
  ability('E', { cooldown: '12', cost: '60', range: '1000' }),
  ability('R', { cooldown: '130/105/80', cost: '100', range: '500' }),
];

function mountBar(abilities: ChampionAbilitySummary[] = ahriAbilities) {
  return mount(ChampionAbilityBar, {
    props: { abilities },
    attachTo: document.body,
  });
}

describe('ChampionAbilityBar', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('hover: hover'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders P/Q/W/E/R with names and icons', () => {
    const wrapper = mountBar();
    expect(wrapper.find('[data-testid="champion-ability-bar"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="champion-ability-button-PASSIVE"]').text()).toContain('P');
    expect(wrapper.get('[data-testid="champion-ability-button-Q"]').text()).toContain('Q');
    expect(wrapper.get('[data-testid="champion-ability-button-W"]').text()).toContain('W');
    expect(wrapper.get('[data-testid="champion-ability-button-E"]').text()).toContain('E');
    expect(wrapper.get('[data-testid="champion-ability-button-R"]').text()).toContain('R');
    expect(wrapper.get('[data-testid="champion-ability-button-Q"]').attributes('aria-label')).toBe(
      'Q: Orb of Deception',
    );
    expect(
      wrapper.get('[data-testid="champion-ability-button-PASSIVE"] img').attributes('src'),
    ).toBe('https://cdn.example.test/PASSIVE.png');
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(false);
  });

  it('opens the matching ability detail on click', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('click');
    const popover = wrapper.get('[data-testid="champion-ability-popover"]');
    expect(popover.text()).toContain('Orb of Deception');
    expect(popover.text()).toContain('Cooldown');
    expect(popover.text()).toContain('7');
    expect(popover.text()).toContain('Cost');
    expect(popover.text()).toContain('Range');
  });

  it('switches detail when another ability is selected', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('click');
    await wrapper.get('[data-testid="champion-ability-button-R"]').trigger('click');
    const popover = wrapper.get('[data-testid="champion-ability-popover"]');
    expect(popover.text()).toContain('Spirit Rush');
    expect(popover.text()).not.toContain('Orb of Deception');
  });

  it('closes on Escape', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-W"]').trigger('click');
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(false);
  });

  it('does not render empty metadata rows', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-PASSIVE"]').trigger('click');
    const popover = wrapper.get('[data-testid="champion-ability-popover"]');
    expect(popover.text()).toContain('Essence Theft');
    expect(popover.text()).not.toContain('Cooldown');
    expect(popover.text()).not.toContain('Cost');
    expect(popover.text()).not.toContain('Range');
  });

  it('falls back when an icon URL is missing', () => {
    const wrapper = mountBar([
      ability('PASSIVE', { iconUrl: null }),
      ability('Q'),
      ability('W'),
      ability('E'),
      ability('R'),
    ]);
    expect(
      wrapper
        .get('[data-testid="champion-ability-button-PASSIVE"]')
        .find('[data-testid="ability-icon-fallback"]')
        .exists(),
    ).toBe(true);
    expect(wrapper.get('[data-testid="champion-ability-button-Q"]').find('img').exists()).toBe(
      true,
    );
  });

  it('opens a temporary preview on hover when nothing is pinned', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('mouseenter');
    expect(wrapper.get('[data-testid="champion-ability-popover"]').text()).toContain(
      'Orb of Deception',
    );
    expect(wrapper.get('[data-testid="champion-ability-button-Q"]').attributes('aria-expanded')).toBe(
      'true',
    );
    expect(wrapper.get('[data-testid="champion-ability-button-Q"]').attributes('aria-controls')).toBe(
      'champion-ability-detail',
    );
    expect(
      wrapper.get('[data-testid="champion-ability-button-W"]').attributes('aria-controls'),
    ).toBeUndefined();
  });

  it('keeps a pinned ability open when hovering a neighbor', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('click');
    await wrapper.get('[data-testid="champion-ability-button-W"]').trigger('mouseenter');
    expect(wrapper.get('[data-testid="champion-ability-popover"]').text()).toContain(
      'Orb of Deception',
    );
    expect(wrapper.get('[data-testid="champion-ability-popover"]').text()).not.toContain('Fox-Fire');
  });

  it('closes on outside pointerdown', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('click');
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(true);
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(false);
  });

  it('closes from the detail Close control', async () => {
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-E"]').trigger('click');
    await wrapper.get('[data-testid="champion-ability-popover-close"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(false);
  });

  it('ignores hover on coarse pointers and still opens on tap', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const wrapper = mountBar();
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('mouseenter');
    expect(wrapper.find('[data-testid="champion-ability-popover"]').exists()).toBe(false);
    await wrapper.get('[data-testid="champion-ability-button-Q"]').trigger('click');
    expect(wrapper.get('[data-testid="champion-ability-popover"]').text()).toContain(
      'Orb of Deception',
    );
  });
});
