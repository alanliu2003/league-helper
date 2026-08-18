import { describe, expect, it, vi } from 'vitest';
import { MATCH_DETAIL_ID } from '../components/match/match-detail.fixture';
import {
  emptyTimelineDetailFixture,
  timelineDetailFixture,
} from '../components/match/match-timeline.fixture';
import { createMatchTimelinePageController } from './useMatchTimelinePage';

const OTHER_MATCH_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('createMatchTimelinePageController', () => {
  it('does not fetch timeline until the Timeline tab is selected, then caches', async () => {
    const getTimeline = vi.fn(async () => timelineDetailFixture());
    const page = createMatchTimelinePageController(
      () => MATCH_DETAIL_ID,
      () => '',
      { getTimeline },
    );
    await page.initialize();
    expect(page.selectedTab.value).toBe('overview');
    expect(getTimeline).not.toHaveBeenCalled();

    await page.selectTab('timeline');
    expect(page.selectedTab.value).toBe('timeline');
    expect(getTimeline).toHaveBeenCalledTimes(1);
    expect(getTimeline).toHaveBeenCalledWith(MATCH_DETAIL_ID);

    await page.selectTab('overview');
    await page.selectTab('timeline');
    expect(getTimeline).toHaveBeenCalledTimes(1);
  });

  it('selects Timeline and fetches once when the hash is #timeline', async () => {
    const getTimeline = vi.fn(async () => timelineDetailFixture());
    const page = createMatchTimelinePageController(
      () => MATCH_DETAIL_ID,
      () => '#timeline',
      {
        getTimeline,
      },
    );
    await page.initialize();
    expect(page.selectedTab.value).toBe('timeline');
    expect(getTimeline).toHaveBeenCalledTimes(1);
    await page.ensureTimelineLoaded();
    expect(getTimeline).toHaveBeenCalledTimes(1);
  });

  it('does not fetch for an invalid match id', async () => {
    const getTimeline = vi.fn(async () => timelineDetailFixture());
    const page = createMatchTimelinePageController(
      () => 'not-a-uuid',
      () => '#timeline',
      {
        getTimeline,
      },
    );
    await page.initialize();
    expect(getTimeline).not.toHaveBeenCalled();
    expect(page.timeline.value).toBeNull();
  });

  it('fetches again after the match id changes', async () => {
    let matchId = MATCH_DETAIL_ID;
    const getTimeline = vi.fn(async (id: string) =>
      timelineDetailFixture({ matchId: id, events: [], frames: [] }),
    );
    const page = createMatchTimelinePageController(
      () => matchId,
      () => '#timeline',
      { getTimeline },
    );
    await page.initialize();
    matchId = OTHER_MATCH_ID;
    await page.initialize();
    expect(getTimeline).toHaveBeenCalledTimes(2);
    expect(getTimeline).toHaveBeenLastCalledWith(OTHER_MATCH_ID);
  });

  it('surfaces unavailable copy when the timeline request fails', async () => {
    const getTimeline = vi.fn(async () => {
      throw new Error('boom');
    });
    const page = createMatchTimelinePageController(
      () => MATCH_DETAIL_ID,
      () => '#timeline',
      {
        getTimeline,
      },
    );
    await page.initialize();
    expect(page.timelineError.value).toBeTruthy();
  });

  it('keeps a successful payload for empty coverage instead of synthesizing events', async () => {
    const getTimeline = vi.fn(async () => emptyTimelineDetailFixture('AVAILABLE'));
    const page = createMatchTimelinePageController(
      () => MATCH_DETAIL_ID,
      () => '#timeline',
      {
        getTimeline,
      },
    );
    await page.initialize();
    expect(page.timeline.value?.events).toEqual([]);
    expect(page.timeline.value?.derived.kills).toEqual([]);
    expect(page.timeline.value?.coverage.kills).toBe(false);
  });
});
