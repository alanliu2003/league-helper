import { ValidationFailureError } from '@league-helper/shared';

export const MAX_BACKFILL_MATCH_TIMELINE_LIMIT = 500;

export type BackfillMatchTimelineFlags =
  | {
      help: true;
      limit?: number;
      since?: Date;
      dryRun: boolean;
      includeIneligible: boolean;
    }
  | {
      help: false;
      limit: number;
      since?: Date;
      dryRun: boolean;
      includeIneligible: boolean;
    };

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new ValidationFailureError(`${flag} requires a value.`);
  }
  return value;
}

function parsePositiveInt(raw: string, name: string, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new ValidationFailureError(`${name} must be a positive integer.`, { received: raw });
  }
  if (value > max) {
    throw new ValidationFailureError(`${name} must be <= ${max}.`, { received: raw });
  }
  return value;
}

function parseIsoDate(raw: string, flag: string): Date {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T|$)/.test(trimmed)) {
    throw new ValidationFailureError(`${flag} must be a valid ISO date.`, { received: raw });
  }
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationFailureError(`${flag} must be a valid ISO date.`, { received: raw });
  }
  return parsed;
}

/**
 * Parse ops backfill argv. `--limit` is required unless `--help`.
 * `--include-ineligible` defaults off.
 */
export function parseBackfillMatchTimelineArgs(argv: string[]): BackfillMatchTimelineFlags {
  let help = false;
  let limit: number | undefined;
  let since: Date | undefined;
  let dryRun = false;
  let includeIneligible = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    switch (arg) {
      case '--help':
      case '-h':
        help = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--include-ineligible':
        includeIneligible = true;
        break;
      case '--limit':
        limit = parsePositiveInt(
          readFlagValue(argv, i, '--limit'),
          '--limit',
          MAX_BACKFILL_MATCH_TIMELINE_LIMIT,
        );
        i += 1;
        break;
      case '--since':
        since = parseIsoDate(readFlagValue(argv, i, '--since'), '--since');
        i += 1;
        break;
      default:
        throw new ValidationFailureError(`Unknown argument: ${arg}`);
    }
  }

  if (help) {
    return { help: true, limit, since, dryRun, includeIneligible };
  }

  if (limit === undefined) {
    throw new ValidationFailureError('--limit is required.');
  }

  return { help: false, limit, since, dryRun, includeIneligible };
}
