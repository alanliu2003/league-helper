import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { PlayerSearchRequestSchema } from '@league-helper/shared';
import PlayerSearchForm from '~/components/player/PlayerSearchForm.vue';

describe('PlayerSearchForm validation', () => {
  it('rejects missing game name', () => {
    const result = PlayerSearchRequestSchema.safeParse({
      gameName: '',
      tagLine: 'NA1',
      platform: 'na1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing tag line', () => {
    const result = PlayerSearchRequestSchema.safeParse({
      gameName: 'Example',
      tagLine: '',
      platform: 'na1',
    });
    expect(result.success).toBe(false);
  });

  it('submits canonical platform routes', () => {
    const result = PlayerSearchRequestSchema.parse({
      gameName: 'Example',
      tagLine: 'NA1',
      platform: 'NA1',
      matchCount: 20,
    });
    expect(result.platform).toBe('na1');
  });
});

describe('PlayerSearchForm', () => {
  it('renders the search form fields', () => {
    const wrapper = mount(PlayerSearchForm);

    expect(wrapper.find('#gameName').exists()).toBe(true);
    expect(wrapper.find('#tagLine').exists()).toBe(true);
    expect(wrapper.find('#platform').exists()).toBe(true);
    expect(wrapper.find('#matchCount').exists()).toBe(true);
    expect(wrapper.get('button[type="submit"]').text()).toContain('Search player');
  });

  it('shows validation errors when gameName and tagLine are missing', async () => {
    const wrapper = mount(PlayerSearchForm);

    await wrapper.get('form').trigger('submit.prevent');

    expect(wrapper.text()).toContain('Game name is required');
    expect(wrapper.text()).toContain('Tag line is required');
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('emits submit with validated payload when fields are filled', async () => {
    const wrapper = mount(PlayerSearchForm);

    await wrapper.get('#gameName').setValue('Faker');
    await wrapper.get('#tagLine').setValue('KR1');
    await wrapper.get('form').trigger('submit.prevent');

    const emitted = wrapper.emitted('submit');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toMatchObject({
      gameName: 'Faker',
      tagLine: 'KR1',
      platform: 'na1',
      matchCount: 20,
    });
  });

  it('submits canonical platform routes from the selector', async () => {
    const wrapper = mount(PlayerSearchForm);

    await wrapper.get('#gameName').setValue('Player');
    await wrapper.get('#tagLine').setValue('EUW');
    await wrapper.get('#platform').setValue('euw1');
    await wrapper.get('form').trigger('submit.prevent');

    const payload = wrapper.emitted('submit')?.[0]?.[0] as { platform: string };
    expect(payload.platform).toBe('euw1');
  });

  it('disables inputs while pending', () => {
    const wrapper = mount(PlayerSearchForm, {
      props: { pending: true },
    });

    expect(wrapper.get('#gameName').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[type="submit"]').text()).toContain('Searching…');
  });
});
