import { describe, expect, it } from 'vitest';
import {
  MAX_BACKFILL_MATCH_TIMELINE_LIMIT,
  parseBackfillMatchTimelineArgs,
} from './backfill-match-timeline-args.js';

describe('parseBackfillMatchTimelineArgs', () => {
  it('requires --limit', () => {
    expect(() => parseBackfillMatchTimelineArgs([])).toThrow(/--limit is required/);
    expect(() => parseBackfillMatchTimelineArgs(['--dry-run'])).toThrow(/--limit is required/);
  });

  it('rejects --limit above 500', () => {
    expect(MAX_BACKFILL_MATCH_TIMELINE_LIMIT).toBe(500);
    expect(() => parseBackfillMatchTimelineArgs(['--limit', '501'])).toThrow(/<= 500/);
  });

  it('rejects missing or non-positive --limit values', () => {
    expect(() => parseBackfillMatchTimelineArgs(['--limit'])).toThrow(/requires a value/);
    expect(() => parseBackfillMatchTimelineArgs(['--limit', '0'])).toThrow(/positive integer/);
    expect(() => parseBackfillMatchTimelineArgs(['--limit', '1.5'])).toThrow(/positive integer/);
  });

  it('accepts --limit 500 and defaults includeIneligible off', () => {
    const flags = parseBackfillMatchTimelineArgs(['--limit', '500']);
    expect(flags.help).toBe(false);
    if (flags.help) {
      return;
    }
    expect(flags.limit).toBe(500);
    expect(flags.includeIneligible).toBe(false);
    expect(flags.dryRun).toBe(false);
    expect(flags.since).toBeUndefined();
  });

  it('parses --dry-run, --include-ineligible, and ISO --since', () => {
    const flags = parseBackfillMatchTimelineArgs([
      '--limit',
      '10',
      '--dry-run',
      '--include-ineligible',
      '--since',
      '2026-01-15',
    ]);
    expect(flags.help).toBe(false);
    if (flags.help) {
      return;
    }
    expect(flags.dryRun).toBe(true);
    expect(flags.includeIneligible).toBe(true);
    expect(flags.since?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('rejects invalid --since', () => {
    expect(() => parseBackfillMatchTimelineArgs(['--limit', '1', '--since', 'yesterday'])).toThrow(
      /ISO date/,
    );
  });

  it('allows --help without --limit', () => {
    const flags = parseBackfillMatchTimelineArgs(['--help']);
    expect(flags.help).toBe(true);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseBackfillMatchTimelineArgs(['--limit', '1', '--confirm'])).toThrow(
      /Unknown argument/,
    );
  });
});
