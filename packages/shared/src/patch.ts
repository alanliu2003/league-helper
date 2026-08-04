import { z } from 'zod';

export const PatchVersionSchema = z.object({
  raw: z.string().min(1),
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
  /** Normalized major.minor label, e.g. "14.1". */
  label: z.string().min(1),
});

export type PatchVersion = z.infer<typeof PatchVersionSchema>;

/**
 * Safely derive a normalized major/minor patch from Riot game-version strings.
 * Unknown or incomplete formats return null instead of guessing.
 *
 * Examples that succeed: "14.1.1.123", "14.1"
 * Examples that return null: "", "14", "abc", "14.x.1"
 */
export function parsePatchVersion(input: unknown): PatchVersion | null {
  if (typeof input !== 'string') {
    return null;
  }

  const raw = input.trim();
  if (raw.length === 0) {
    return null;
  }

  const segments = raw.split('.');
  if (segments.length < 2) {
    return null;
  }

  const majorText = segments[0];
  const minorText = segments[1];
  if (majorText === undefined || minorText === undefined) {
    return null;
  }

  if (!/^\d+$/.test(majorText) || !/^\d+$/.test(minorText)) {
    return null;
  }

  const major = Number.parseInt(majorText, 10);
  const minor = Number.parseInt(minorText, 10);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }

  return PatchVersionSchema.parse({
    raw,
    major,
    minor,
    label: `${major}.${minor}`,
  });
}
