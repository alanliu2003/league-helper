import { z } from 'zod';

/**
 * Riot match-v5 queue IDs used for recent-match discovery/display.
 * Labels follow Riot's public queue metadata where applicable.
 */
export const RANKED_SOLO_QUEUE_ID = 420;
export const RANKED_FLEX_QUEUE_ID = 440;
export const NORMAL_DRAFT_QUEUE_ID = 400;
export const NORMAL_BLIND_QUEUE_ID = 430;
export const QUICKPLAY_QUEUE_ID = 490;
export const ARAM_QUEUE_ID = 450;
export const ARENA_QUEUE_ID = 1700;
export const SWIFTPLAY_QUEUE_ID = 480;
export const CUSTOM_QUEUE_ID = 0;

export const MATCH_QUEUE_LABELS: Readonly<Record<number, string>> = {
  [RANKED_SOLO_QUEUE_ID]: 'Ranked Solo/Duo',
  [RANKED_FLEX_QUEUE_ID]: 'Ranked Flex',
  [NORMAL_DRAFT_QUEUE_ID]: 'Normal Draft',
  [NORMAL_BLIND_QUEUE_ID]: 'Normal Blind',
  [QUICKPLAY_QUEUE_ID]: 'Quickplay',
  [SWIFTPLAY_QUEUE_ID]: 'Swiftplay',
  [ARAM_QUEUE_ID]: 'ARAM',
  [ARENA_QUEUE_ID]: 'Arena',
  [CUSTOM_QUEUE_ID]: 'Custom',
};

export const PlayerMatchQueueCategorySchema = z.enum([
  'all',
  'ranked_solo',
  'ranked_flex',
  'normal',
  'aram',
  'other',
]);

export type PlayerMatchQueueCategory = z.infer<typeof PlayerMatchQueueCategorySchema>;

const NORMAL_QUEUE_IDS = [
  NORMAL_DRAFT_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
] as const;

const KNOWN_DISPLAY_QUEUE_IDS = new Set<number>([
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  ...NORMAL_QUEUE_IDS,
  ARAM_QUEUE_ID,
  ARENA_QUEUE_ID,
  CUSTOM_QUEUE_ID,
]);

export function getMatchQueueLabel(queueId: number): string {
  return MATCH_QUEUE_LABELS[queueId] ?? `Queue ${queueId}`;
}

/**
 * Summoner's Rift queues where standard five-role positions are meaningful.
 * Same set as NormalizedPosition STANDARD_SR_QUEUE_IDS (420, 440, 400, 430, 490, 480).
 * ARAM / Arena / Custom and unknown queues return false.
 */
const STANDARD_POSITION_QUEUE_IDS = new Set<number>([
  RANKED_SOLO_QUEUE_ID,
  RANKED_FLEX_QUEUE_ID,
  NORMAL_DRAFT_QUEUE_ID,
  NORMAL_BLIND_QUEUE_ID,
  QUICKPLAY_QUEUE_ID,
  SWIFTPLAY_QUEUE_ID,
]);

export function supportsStandardPositions(queueId: number): boolean {
  return STANDARD_POSITION_QUEUE_IDS.has(queueId);
}

/**
 * Resolve a display filter category into repository constraints.
 * - `queueIds`: include only these IDs
 * - `excludeQueueIds`: include any ID not in this set (for "other")
 * - both undefined: no queue filter
 */
export function resolveMatchQueueCategoryFilter(category: PlayerMatchQueueCategory | undefined): {
  queueIds?: number[];
  excludeQueueIds?: number[];
} {
  switch (category) {
    case undefined:
    case 'all':
      return {};
    case 'ranked_solo':
      return { queueIds: [RANKED_SOLO_QUEUE_ID] };
    case 'ranked_flex':
      return { queueIds: [RANKED_FLEX_QUEUE_ID] };
    case 'normal':
      return { queueIds: [...NORMAL_QUEUE_IDS] };
    case 'aram':
      return { queueIds: [ARAM_QUEUE_ID] };
    case 'other':
      return { excludeQueueIds: [...KNOWN_DISPLAY_QUEUE_IDS] };
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
