import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
} from '@league-helper/shared';
import { loadRankTiersAtIngestion } from './rank-at-ingestion.js';

type SnapshotRow = {
  id: string;
  playerAccountId: string;
  tier: string;
  queueType: string;
  capturedAt: Date;
};

function createPrismaMock(snapshots: SnapshotRow[]) {
  const findMany = vi.fn(
    async ({
      where,
      orderBy,
    }: {
      where: {
        playerAccountId: { in: string[] };
        queueType: string;
        capturedAt: { lte: Date };
      };
      orderBy: Array<{ capturedAt?: 'desc' | 'asc'; id?: 'desc' | 'asc' }>;
      select?: unknown;
    }) => {
      void orderBy;
      return snapshots
        .filter(
          (row) =>
            where.playerAccountId.in.includes(row.playerAccountId) &&
            row.queueType === where.queueType &&
            row.capturedAt.getTime() <= where.capturedAt.lte.getTime(),
        )
        .sort((a, b) => {
          const byCaptured = b.capturedAt.getTime() - a.capturedAt.getTime();
          if (byCaptured !== 0) {
            return byCaptured;
          }
          return b.id.localeCompare(a.id);
        });
    },
  );

  return {
    rankSnapshot: { findMany },
    findMany,
  };
}

describe('loadRankTiersAtIngestion', () => {
  const cutoff = new Date('2024-06-15T12:00:00.000Z');
  const accountA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const accountB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('assigns latest Solo snapshot at or before cutoff for queue 420', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-old',
        playerAccountId: accountA,
        tier: 'SILVER',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-01T00:00:00.000Z'),
      },
      {
        id: 'snap-latest',
        playerAccountId: accountA,
        tier: 'GOLD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-15T12:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBe('GOLD');
    expect(prisma.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.findMany.mock.calls[0]![0].where.queueType).toBe('RANKED_SOLO_5x5');
  });

  it('assigns latest Flex snapshot at or before cutoff for queue 440', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-flex',
        playerAccountId: accountA,
        tier: 'PLATINUM',
        queueType: 'RANKED_FLEX_SR',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_FLEX_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '2', playerAccountId: accountA }],
    });

    expect(result.get('2')).toBe('PLATINUM');
    expect(prisma.findMany.mock.calls[0]![0].where.queueType).toBe('RANKED_FLEX_SR');
  });

  it('returns null for ARAM/other queues without querying RankSnapshot', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-solo',
        playerAccountId: accountA,
        tier: 'GOLD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: 450,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBeNull();
    expect(prisma.findMany).not.toHaveBeenCalled();
  });

  it('returns null for unlinked participants without querying when no linked ids', async () => {
    const prisma = createPrismaMock([]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: null }],
    });

    expect(result.get('1')).toBeNull();
    expect(prisma.findMany).not.toHaveBeenCalled();
  });

  it('returns null when linked account has no snapshot', async () => {
    const prisma = createPrismaMock([]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBeNull();
    expect(prisma.findMany).toHaveBeenCalledTimes(1);
  });

  it('ignores snapshots captured after cutoff', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-after',
        playerAccountId: accountA,
        tier: 'DIAMOND',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-15T12:00:01.000Z'),
      },
      {
        id: 'snap-before',
        playerAccountId: accountA,
        tier: 'EMERALD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-15T11:59:59.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBe('EMERALD');
  });

  it('selects latest snapshot before cutoff when multiple exist', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-1',
        playerAccountId: accountA,
        tier: 'BRONZE',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-05-01T00:00:00.000Z'),
      },
      {
        id: 'snap-2',
        playerAccountId: accountA,
        tier: 'SILVER',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-10T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBe('SILVER');
  });

  it('breaks equal capturedAt ties deterministically by id desc', async () => {
    const sameTime = new Date('2024-06-14T00:00:00.000Z');
    const prisma = createPrismaMock([
      {
        id: 'snap-aaa',
        playerAccountId: accountA,
        tier: 'GOLD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: sameTime,
      },
      {
        id: 'snap-zzz',
        playerAccountId: accountA,
        tier: 'PLATINUM',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: sameTime,
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBe('PLATINUM');
    expect(prisma.findMany.mock.calls[0]![0].orderBy).toEqual([
      { capturedAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('maps malformed tier to null safely', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prisma = createPrismaMock([
      {
        id: 'snap-bad',
        playerAccountId: accountA,
        tier: 'WOOD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('batches linked accounts in one query (not per participant)', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-a',
        playerAccountId: accountA,
        tier: 'GOLD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
      {
        id: 'snap-b',
        playerAccountId: accountB,
        tier: 'SILVER',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [
        { participantKey: '1', playerAccountId: accountA },
        { participantKey: '2', playerAccountId: accountB },
        { participantKey: '3', playerAccountId: null },
      ],
    });

    expect(prisma.findMany).toHaveBeenCalledTimes(1);
    expect(result.get('1')).toBe('GOLD');
    expect(result.get('2')).toBe('SILVER');
    expect(result.get('3')).toBeNull();
  });

  it('dedupes duplicate account IDs in the RankSnapshot query', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-a',
        playerAccountId: accountA,
        tier: 'GOLD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [
        { participantKey: '1', playerAccountId: accountA },
        { participantKey: '2', playerAccountId: accountA },
      ],
    });

    expect(prisma.findMany).toHaveBeenCalledTimes(1);
    const ids = prisma.findMany.mock.calls[0]![0].where.playerAccountId.in;
    expect(ids).toEqual([accountA]);
    expect(result.get('1')).toBe('GOLD');
    expect(result.get('2')).toBe('GOLD');
  });

  it('never uses Flex snapshots for queue 420', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-flex',
        playerAccountId: accountA,
        tier: 'CHALLENGER',
        queueType: 'RANKED_FLEX_SR',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_SOLO_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBeNull();
    expect(prisma.findMany.mock.calls[0]![0].where.queueType).toBe('RANKED_SOLO_5x5');
  });

  it('never uses Solo snapshots for queue 440', async () => {
    const prisma = createPrismaMock([
      {
        id: 'snap-solo',
        playerAccountId: accountA,
        tier: 'CHALLENGER',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-14T00:00:00.000Z'),
      },
    ]);

    const result = await loadRankTiersAtIngestion({
      prisma: prisma as never,
      queueId: RANKED_FLEX_QUEUE_ID,
      cutoff,
      links: [{ participantKey: '1', playerAccountId: accountA }],
    });

    expect(result.get('1')).toBeNull();
    expect(prisma.findMany.mock.calls[0]![0].where.queueType).toBe('RANKED_FLEX_SR');
  });

  it('does not import or call any Riot provider', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./rank-at-ingestion.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/server-riot|RiotApi|createRiot|getLeagueEntries|provider/i);
    expect(source).not.toMatch(/from ['"]@league-helper\/server-riot['"]/);
  });
});
