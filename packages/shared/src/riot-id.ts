import { z } from 'zod';
import { InvalidRiotIdError } from './errors';

/**
 * Riot ID constraints (gameName + tagLine).
 * Length limits follow Riot account naming guidance used by Riot ID creation.
 */
export const RIOT_GAME_NAME_MAX_LENGTH = 16;
export const RIOT_TAG_LINE_MAX_LENGTH = 5;

const RiotIdFieldsSchema = z.object({
  gameName: z.string(),
  tagLine: z.string(),
});

export const RiotIdSchema = RiotIdFieldsSchema.superRefine((value, ctx) => {
  const gameName = value.gameName.trim();
  const tagLine = value.tagLine.trim();

  if (gameName.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'gameName must not be empty',
      path: ['gameName'],
    });
  } else if (gameName.length > RIOT_GAME_NAME_MAX_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `gameName must be at most ${RIOT_GAME_NAME_MAX_LENGTH} characters`,
      path: ['gameName'],
    });
  }

  if (tagLine.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tagLine must not be empty',
      path: ['tagLine'],
    });
  } else if (tagLine.length > RIOT_TAG_LINE_MAX_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `tagLine must be at most ${RIOT_TAG_LINE_MAX_LENGTH} characters`,
      path: ['tagLine'],
    });
  }
}).transform((value) => ({
  // Preserve original display casing after trimming only surrounding whitespace.
  gameName: value.gameName.trim(),
  tagLine: value.tagLine.trim(),
}));

export type RiotId = z.infer<typeof RiotIdSchema>;

export function parseRiotId(input: unknown): RiotId {
  const result = RiotIdSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidRiotIdError('Riot ID is invalid.', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function formatRiotId(riotId: RiotId): string {
  return `${riotId.gameName}#${riotId.tagLine}`;
}
