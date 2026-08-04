import { z } from 'zod';

/** Common ranked / matchmaking queue identifiers returned by Riot League endpoints. */
export const QueueTypeSchema = z.enum([
  'RANKED_SOLO_5x5',
  'RANKED_FLEX_SR',
  'RANKED_FLEX_TT',
  'CHERRY',
  'STRAWBERRY',
  'NORMAL',
  'ARAM',
  'UNKNOWN',
]);

export type QueueType = z.infer<typeof QueueTypeSchema>;
