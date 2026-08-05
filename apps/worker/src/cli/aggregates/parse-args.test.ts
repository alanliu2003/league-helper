import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hasNonDefaultRollupFlags,
  isRebuildConfirmed,
  parseSharedAggregateCliArgs,
  resolveBatchSize,
  toRollupPolicy,
} from './parse-args.js';
import { EXIT_COMMAND_FAILURE, EXIT_INTEGRITY_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

describe('parseSharedAggregateCliArgs', () => {
  it('parses filters, dry-run, json, confirm, and rollup flags', () => {
    const flags = parseSharedAggregateCliArgs([
      '--dry-run',
      '--json',
      '--confirm',
      '--patch',
      '14.1',
      '--queue',
      '420',
      '--platform',
      'NA1',
      '--champion',
      '103',
      '--batch-size',
      '25',
      '--include-all-tiers-and-position',
    ]);
    expect(flags.dryRun).toBe(true);
    expect(flags.json).toBe(true);
    expect(flags.confirm).toBe(true);
    expect(flags.filters).toEqual({
      patch: '14.1',
      queueId: 420,
      platformRoute: 'na1',
      championId: 103,
    });
    expect(flags.batchSize).toBe(25);
    expect(flags.rollup.includeAllTiersAndPosition).toBe(true);
    expect(hasNonDefaultRollupFlags(flags.rollup)).toBe(true);
    expect(toRollupPolicy(flags.rollup).includeAllTierAndPosition).toBe(true);
  });

  it('resolves batch size from env when flag omitted', () => {
    expect(resolveBatchSize(undefined, { CHAMPION_AGGREGATION_BATCH_SIZE: '40' })).toBe(40);
    expect(resolveBatchSize(12, { CHAMPION_AGGREGATION_BATCH_SIZE: '40' })).toBe(12);
  });

  it('accepts confirm via env or flag', () => {
    expect(isRebuildConfirmed({ confirm: false }, {})).toBe(false);
    expect(isRebuildConfirmed({ confirm: true }, {})).toBe(true);
    expect(
      isRebuildConfirmed({ confirm: false }, { AGGREGATES_REBUILD_CHAMPIONS_CONFIRM: 'YES' }),
    ).toBe(true);
  });
});

describe('exit codes', () => {
  it('documents distinct integrity failure code', () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_COMMAND_FAILURE).toBe(1);
    expect(EXIT_INTEGRITY_FAILURE).toBe(2);
  });
});

describe('root / worker script wiring', () => {
  it('root scripts invoke the intended CLI files via worker filter', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // aggregates/ -> cli/ -> src/ -> worker/ -> apps/ -> repo root
    const root = JSON.parse(readFileSync(resolve(here, '../../../../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const worker = JSON.parse(readFileSync(resolve(here, '../../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(root.scripts['aggregates:rebuild-champions']).toContain(
      '@league-helper/worker aggregates:rebuild-champions',
    );
    expect(root.scripts['aggregates:reconcile-champions']).toContain(
      '@league-helper/worker aggregates:reconcile-champions',
    );
    expect(root.scripts['aggregates:status-champions']).toContain(
      '@league-helper/worker aggregates:status-champions',
    );
    expect(root.scripts['aggregates:audit-rank-coverage']).toContain(
      '@league-helper/worker aggregates:audit-rank-coverage',
    );
    expect(root.scripts['aggregates:audit-champions']).toContain(
      '@league-helper/worker aggregates:audit-champions',
    );

    expect(worker.scripts['aggregates:rebuild-champions']).toContain(
      'src/cli/rebuild-champion-aggregates.ts',
    );
    expect(worker.scripts['aggregates:reconcile-champions']).toContain(
      'src/cli/reconcile-champion-aggregates.ts',
    );
    expect(worker.scripts['aggregates:status-champions']).toContain(
      'src/cli/status-champion-aggregates.ts',
    );
    expect(worker.scripts['aggregates:audit-rank-coverage']).toContain(
      'src/cli/audit-rank-coverage.ts',
    );
    expect(worker.scripts['aggregates:audit-champions']).toContain('src/cli/audit-champions.ts');
  });
});
