import { ref, type Ref } from 'vue';
import { z } from 'zod';
import type { PublicMatchTimelineDetail } from '@league-helper/shared';
import { type MatchDetailTabId } from '../components/match/MatchDetailTabs.vue';
import { matchDetailTabFromHash } from '../utils/match-timeline-format';

const UuidSchema = z.string().uuid();

export type MatchTimelinePageApi = {
  getTimeline: (matchId: string) => Promise<PublicMatchTimelineDetail>;
};

export type MatchTimelinePageController = {
  selectedTab: Ref<MatchDetailTabId>;
  timeline: Ref<PublicMatchTimelineDetail | null>;
  timelinePending: Ref<boolean>;
  timelineError: Ref<string | null>;
  selectTab: (tab: MatchDetailTabId) => Promise<void>;
  ensureTimelineLoaded: () => Promise<void>;
  initialize: () => Promise<void>;
};

function parseUuid(value: string | undefined | null): string | null {
  const trimmed = value?.trim() ?? '';
  const parsed = UuidSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

export function createMatchTimelinePageController(
  getMatchId: () => string,
  getHash: () => string,
  api: MatchTimelinePageApi,
  setHash?: (hash: string) => void,
): MatchTimelinePageController {
  const selectedTab = ref<MatchDetailTabId>('overview');
  const timeline = ref<PublicMatchTimelineDetail | null>(null);
  const timelinePending = ref(false);
  const timelineError = ref<string | null>(null);
  let cachedMatchId: string | null = null;
  let inFlight: Promise<void> | null = null;

  async function loadTimeline(): Promise<void> {
    const parsedId = parseUuid(getMatchId());
    if (!parsedId) {
      timeline.value = null;
      timelinePending.value = false;
      timelineError.value = null;
      cachedMatchId = null;
      return;
    }
    if (cachedMatchId === parsedId && (timeline.value || timelineError.value)) {
      return;
    }
    if (inFlight && cachedMatchId === parsedId) {
      return inFlight;
    }

    const requestMatchId = parsedId;
    cachedMatchId = parsedId;
    timelinePending.value = true;
    timelineError.value = null;
    inFlight = (async () => {
      try {
        const response = await api.getTimeline(requestMatchId);
        if (cachedMatchId !== requestMatchId) {
          return;
        }
        timeline.value = response;
        timelinePending.value = false;
      } catch {
        if (cachedMatchId !== requestMatchId) {
          return;
        }
        timeline.value = null;
        timelinePending.value = false;
        timelineError.value = 'Timeline is not available for this match.';
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function ensureTimelineLoaded(): Promise<void> {
    if (selectedTab.value !== 'timeline') {
      return;
    }
    await loadTimeline();
  }

  async function selectTab(tab: MatchDetailTabId): Promise<void> {
    selectedTab.value = tab;
    setHash?.(tab === 'timeline' ? '#timeline' : '');
    if (tab === 'timeline') {
      await loadTimeline();
    }
  }

  async function initialize(): Promise<void> {
    const matchId = parseUuid(getMatchId());
    if (cachedMatchId && cachedMatchId !== matchId) {
      timeline.value = null;
      timelineError.value = null;
      cachedMatchId = null;
    }
    selectedTab.value = matchDetailTabFromHash(getHash());
    if (selectedTab.value === 'timeline') {
      await loadTimeline();
    }
  }

  return {
    selectedTab,
    timeline,
    timelinePending,
    timelineError,
    selectTab,
    ensureTimelineLoaded,
    initialize,
  };
}

export function useMatchTimelinePage(): MatchTimelinePageController {
  const route = useRoute();
  const router = useRouter();
  const api = useMatchApi();
  const controller = createMatchTimelinePageController(
    () => String(route.params.matchId ?? ''),
    () => route.hash,
    api,
    (hash) => {
      const normalized = hash.replace(/^#/, '');
      const nextHash = normalized ? `#${normalized}` : '';
      if ((route.hash || '') === nextHash) {
        return;
      }
      void router.replace({
        path: route.path,
        query: route.query,
        hash: nextHash,
      });
    },
  );

  onMounted(() => {
    void controller.initialize();
  });

  watch(
    () => [String(route.params.matchId ?? ''), route.hash] as const,
    () => {
      void controller.initialize();
    },
  );

  return controller;
}
