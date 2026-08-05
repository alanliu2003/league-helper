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
  it('shows in-progress copy and all job counts', () => {
    const wrapper = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh() },
    });
    expect(wrapper.text()).toContain('Match ingestion is in progress.');
    expect(wrapper.text()).toContain('3 queued');
    expect(wrapper.text()).toContain('1 active');
    expect(wrapper.text()).toContain('1 delayed');
    expect(wrapper.text()).toContain('0 completed');
    expect(wrapper.text()).toContain('Delayed jobs are waiting on rate limits');
    expect(wrapper.text()).not.toContain('worker is implemented');
  });

  it('shows failure warning only when failures exist', () => {
    const withoutFailures = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh() },
    });
    expect(withoutFailures.text()).not.toContain('Some match jobs failed');

    const withFailures = mount(PlayerMatchProcessingState, {
      props: { refresh: refresh({ failedMatchCount: 2 }) },
    });
    expect(withFailures.text()).toContain('Some match jobs failed');
  });
});
