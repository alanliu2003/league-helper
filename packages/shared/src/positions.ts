import { z } from 'zod';

/** Team position / role labels used in match participant summaries. */
export const TeamPositionSchema = z.enum([
  'TOP',
  'JUNGLE',
  'MIDDLE',
  'BOTTOM',
  'UTILITY',
  'NONE',
  'INVALID',
]);

export type TeamPosition = z.infer<typeof TeamPositionSchema>;
