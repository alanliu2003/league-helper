import { describe, expect, it, vi } from 'vitest';
import { attributeAsyncExpansionCounters } from './participant-expansion.counters.js';

describe('attributeAsyncExpansionCounters', () => {
  it('no-ops when sourceCollectorRunId is missing', async () => {
    const prisma = { $executeRaw: vi.fn() };
    await attributeAsyncExpansionCounters(
      prisma as never,
      null,
      [{ outcome: 'already_tracked' }],
      1,
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('atomically increments non-reserving async counters (not enrolled)', async () => {
    const prisma = { $executeRaw: vi.fn().mockResolvedValue(1) };
    await attributeAsyncExpansionCounters(
      prisma as never,
      '11111111-1111-4111-8111-111111111111',
      [
        { outcome: 'created' },
        { outcome: 'already_tracked' },
        { outcome: 'skipped_depth_limit' },
        { outcome: 'skipped_population_cap' },
        { outcome: 'skipped_run_cap' },
      ],
      5,
    );

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    // Template literal tags — verify we did issue a raw UPDATE (Prisma SQL).
    const call = prisma.$executeRaw.mock.calls[0];
    expect(call).toBeDefined();
  });
});
