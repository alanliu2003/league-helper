import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlayerRefreshStatus } from '@league-helper/shared';
import PlayerMatchProcessingState from '~/components/player/PlayerMatchProcessingState.vue';

function refresh(overrides: Partial<PlayerRefreshStatus> = {}): PlayerRefreshStatus {
  return {
    state: 'PROCESSING',
    requestedMatchCount: 5,
    discoveredMatchCount: 5,
    knownMatchCount: 0,
    queuedMatchCount: 3,
    activeMatchCount: 1,
    delayedMatchCount: 1,
    completedMatchCount: 0,
    failedMatchCount: 0,
    lastResolvedAt: null,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastRefreshedAt: null,
    isStale: false,
    warnings: [],
    ...overrides,
  };
}

describe('PlayerMatchProcessingState', () => {
  it('shows in-progress copy and job counts', () => {
    const wrapper = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh() },
    });
    expect(wrapper.text()).toContain('Match ingestion in progress');
    expect(wrapper.text()).toContain('0/5 completed');
    expect(wrapper.text()).toContain('5 in flight');
    expect(wrapper.text()).not.toContain('worker is implemented');
  });

  it('shows compact title when matches already render', () => {
    const wrapper = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh({ completedMatchCount: 2 }), compact: true },
    });
    expect(wrapper.text()).toContain('Still ingesting matches');
  });

  it('shows failure warning only when failures exist', () => {
    const withoutFailures = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh() },
    });
    expect(withoutFailures.text()).not.toContain('Some jobs failed');

    const withFailures = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh({ failedMatchCount: 2 }) },
    });
    expect(withFailures.text()).toContain('Some jobs failed');
  });
});
