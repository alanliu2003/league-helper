import { describe, expect, it } from 'vitest';
import {
  ARAM_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  getMatchQueueLabel,
  resolveMatchQueueCategoryFilter,
} from './match-queues';

describe('match queue metadata', () => {
  it('labels common queues and falls back for unknown IDs', () => {
    expect(getMatchQueueLabel(RANKED_SOLO_QUEUE_ID)).toBe('Ranked Solo/Duo');
    expect(getMatchQueueLabel(ARAM_QUEUE_ID)).toBe('ARAM');
    expect(getMatchQueueLabel(1234)).toBe('Queue 1234');
  });

  it('resolves display categories to queue ID filters', () => {
    expect(resolveMatchQueueCategoryFilter('all')).toEqual({});
    expect(resolveMatchQueueCategoryFilter('ranked_solo')).toEqual({
      queueIds: [RANKED_SOLO_QUEUE_ID],
    });
    expect(resolveMatchQueueCategoryFilter('aram')).toEqual({ queueIds: [ARAM_QUEUE_ID] });
    expect(resolveMatchQueueCategoryFilter('other').excludeQueueIds).toContain(
      RANKED_SOLO_QUEUE_ID,
    );
    expect(resolveMatchQueueCategoryFilter('other').excludeQueueIds).toContain(ARAM_QUEUE_ID);
  });
});
