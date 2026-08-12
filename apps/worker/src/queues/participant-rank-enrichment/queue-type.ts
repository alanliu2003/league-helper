import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  type ParticipantRankEnrichmentJobPayload,
} from '@league-helper/shared';

export type EnrichmentRankedQueueType = ParticipantRankEnrichmentJobPayload['queueType'];

/** Map match queueId → League-v4 queueType for enrichment jobs. */
export function rankedQueueTypeForQueueId(queueId: number): EnrichmentRankedQueueType | null {
  if (queueId === RANKED_SOLO_QUEUE_ID) {
    return 'RANKED_SOLO_5x5';
  }
  if (queueId === RANKED_FLEX_QUEUE_ID) {
    return 'RANKED_FLEX_SR';
  }
  return null;
}

/** Match queueIds that share a League-v4 queueType observation. */
export function queueIdsForRankedQueueType(queueType: EnrichmentRankedQueueType): number[] {
  if (queueType === 'RANKED_SOLO_5x5') {
    return [RANKED_SOLO_QUEUE_ID];
  }
  return [RANKED_FLEX_QUEUE_ID];
}
