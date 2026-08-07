import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchIngestionStatus, TimelineFetchStatus } from '@prisma/client';
import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
} from '@league-helper/shared';
import { FAKE_PUUID } from '@league-helper/server-riot';
import { normalizeMatch } from './match-normalizer.js';
import {
  ensurePlayerLinkageForCompletedMatch,
  persistNormalizedMatch,
  persistTimelineAndMetrics,
} from './match-persistence.js';
import {
  buildPuuid,
  buildRankedMatchDto,
} from './test-utils/ranked-match-fixture.js';

type SnapshotRow = {
  id: string;
  playerAccountId: string;
  tier: string;
  queueType: string;
  capturedAt: Date;
};

type Store = {
  matches: Map<string, Record<string, unknown>>;
  participants: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  timelines: Map<string, Record<string, unknown>>;
  snapshots: SnapshotRow[];
  accounts: Array<{ id: string; provider: string; externalAccountId: string }>;
};

function matchKey(provider: string, externalMatchId: string): string {
  return `${provider}:${externalMatchId}`;
}

function createPrismaMock(store: Store) {
  const rankSnapshotFindMany = vi.fn(
    async ({
      where,
    }: {
      where: {
        playerAccountId: { in: string[] };
        queueType: string;
        capturedAt: { lte: Date };
      };
      orderBy?: unknown;
      select?: unknown;
    }) => {
      return store.snapshots
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

  const findMatchById = (id: string) => {
    for (const match of store.matches.values()) {
      if (match.id === id) {
        return match;
      }
    }
    return null;
  };

  const updateMatchById = (id: string, data: Record<string, unknown>) => {
    for (const [key, match] of store.matches.entries()) {
      if (match.id === id) {
        const next = { ...match, ...data };
        store.matches.set(key, next);
        return next;
      }
    }
    return data;
  };

  const prisma = {
    match: {
      findUnique: vi.fn(
        async ({
          where,
          include,
        }: {
          where: {
            id?: string;
            provider_externalMatchId?: { provider: string; externalMatchId: string };
          };
          include?: { participants?: { select?: unknown } };
        }) => {
          const match = where.id
            ? findMatchById(where.id)
            : where.provider_externalMatchId
              ? (store.matches.get(
                  matchKey(
                    where.provider_externalMatchId.provider,
                    where.provider_externalMatchId.externalMatchId,
                  ),
                ) ?? null)
              : null;
          if (!match) {
            return null;
          }
          if (include?.participants) {
            return {
              ...match,
              participants: store.participants.filter(
                (participant) => participant.matchId === match.id,
              ),
            };
          }
          return match;
        },
      ),
    },
    matchParticipant: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const participant = store.participants.find((row) => row.id === where.id);
          if (participant) {
            Object.assign(participant, data);
          }
          return participant;
        },
      ),
    },
    playerAccount: {
      findMany: vi.fn(async () => store.accounts),
    },
    rankSnapshot: {
      findMany: rankSnapshotFindMany,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        match: {
          findUnique: vi.fn(
            async ({
              where,
              select,
            }: {
              where: { id: string };
              select?: { ingestedAt?: boolean };
            }) => {
              const match = findMatchById(where.id);
              if (!match) {
                return null;
              }
              if (select?.ingestedAt) {
                return { ingestedAt: match.ingestedAt ?? null };
              }
              return match;
            },
          ),
          upsert: vi.fn(
            async ({
              where,
              create,
              update,
            }: {
              where: { provider_externalMatchId: { provider: string; externalMatchId: string } };
              create: Record<string, unknown>;
              update: Record<string, unknown>;
            }) => {
              const key = matchKey(
                where.provider_externalMatchId.provider,
                where.provider_externalMatchId.externalMatchId,
              );
              const existing = store.matches.get(key);
              if (existing) {
                const next = { ...existing, ...update };
                store.matches.set(key, next);
                return next;
              }
              const created = {
                id: `match-${store.matches.size + 1}`,
                createdAt: create.createdAt ?? new Date('2024-01-01T00:00:00.000Z'),
                ...create,
              };
              store.matches.set(key, created);
              return created;
            },
          ),
          update: vi.fn(
            async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
              return updateMatchById(where.id, data);
            },
          ),
        },
        matchTeam: {
          upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
            store.teams.push(create);
            return create;
          }),
        },
        matchParticipant: {
          upsert: vi.fn(
            async ({
              create,
              update,
              where,
            }: {
              create: Record<string, unknown>;
              update: Record<string, unknown>;
              where: { matchId_participantId: { matchId: string; participantId: number } };
            }) => {
              const existing = store.participants.find(
                (row) =>
                  row.matchId === where.matchId_participantId.matchId &&
                  row.participantId === where.matchId_participantId.participantId,
              );
              if (existing) {
                Object.assign(existing, update);
                return existing;
              }
              const row = { id: `part-${store.participants.length + 1}`, ...create };
              store.participants.push(row);
              return row;
            },
          ),
          update: vi.fn(
            async ({
              where,
              data,
            }: {
              where: { matchId_participantId: { matchId: string; participantId: number } };
              data: Record<string, unknown>;
            }) => {
              const existing = store.participants.find(
                (row) =>
                  row.matchId === where.matchId_participantId.matchId &&
                  row.participantId === where.matchId_participantId.participantId,
              );
              if (existing) {
                Object.assign(existing, data);
              }
              return existing;
            },
          ),
        },
        matchTimeline: {
          upsert: vi.fn(
            async ({
              create,
              update,
              where,
            }: {
              create: Record<string, unknown>;
              update: Record<string, unknown>;
              where: { matchId: string };
            }) => {
              const existing = store.timelines.get(where.matchId);
              if (existing) {
                const next = { ...existing, ...update };
                store.timelines.set(where.matchId, next);
                return next;
              }
              store.timelines.set(where.matchId, create);
              return create;
            },
          ),
        },
        rankSnapshot: {
          findMany: rankSnapshotFindMany,
        },
      };
      return fn(tx);
    }),
  };

  return { prisma, rankSnapshotFindMany };
}

function buildNormalized(queueId: number = RANKED_SOLO_QUEUE_ID) {
  return normalizeMatch({
    raw: buildRankedMatchDto({ queueId, matchId: `NA1_RANK_PERSIST_${queueId}` }),
    regionalRoute: 'americas',
    storeRawPayloads: false,
    normalizationVersion: 1,
  });
}

describe('persistNormalizedMatch rankTierAtIngestion', () => {
  const accountId = '11111111-1111-1111-1111-111111111111';
  let store: Store;
  let prisma: ReturnType<typeof createPrismaMock>['prisma'];
  let rankSnapshotFindMany: ReturnType<typeof createPrismaMock>['rankSnapshotFindMany'];

  beforeEach(() => {
    store = {
      matches: new Map(),
      participants: [],
      teams: [],
      timelines: new Map(),
      snapshots: [],
      accounts: [
        {
          id: accountId,
          provider: 'RIOT',
          externalAccountId: FAKE_PUUID,
        },
      ],
    };
    ({ prisma, rankSnapshotFindMany } = createPrismaMock(store));
  });

  it('writes solo rankTierAtIngestion for linked 420 participant', async () => {
    store.snapshots.push({
      id: 'snap-1',
      playerAccountId: accountId,
      tier: 'GOLD',
      queueType: 'RANKED_SOLO_5x5',
      capturedAt: new Date('2024-06-01T00:00:00.000Z'),
    });

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);

    await persistNormalizedMatch(prisma as never, match, links);

    const participant = store.participants.find(
      (row) => row.externalAccountId === FAKE_PUUID,
    );
    expect(participant?.rankTierAtIngestion).toBe('GOLD');
    expect(rankSnapshotFindMany).toHaveBeenCalledTimes(1);
  });

  it('writes flex rankTierAtIngestion for linked 440 participant', async () => {
    store.snapshots.push({
      id: 'snap-flex',
      playerAccountId: accountId,
      tier: 'PLATINUM',
      queueType: 'RANKED_FLEX_SR',
      capturedAt: new Date('2024-06-01T00:00:00.000Z'),
    });

    const match = buildNormalized(RANKED_FLEX_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);

    await persistNormalizedMatch(prisma as never, match, links);

    const participant = store.participants.find(
      (row) => row.externalAccountId === FAKE_PUUID,
    );
    expect(participant?.rankTierAtIngestion).toBe('PLATINUM');
  });

  it('leaves ARAM rankTierAtIngestion null without snapshot query', async () => {
    store.snapshots.push({
      id: 'snap-1',
      playerAccountId: accountId,
      tier: 'GOLD',
      queueType: 'RANKED_SOLO_5x5',
      capturedAt: new Date('2024-06-01T00:00:00.000Z'),
    });

    const match = buildNormalized(450);
    const links = new Map([[FAKE_PUUID, accountId]]);

    await persistNormalizedMatch(prisma as never, match, links);

    const participant = store.participants.find(
      (row) => row.externalAccountId === FAKE_PUUID,
    );
    expect(participant?.rankTierAtIngestion ?? null).toBeNull();
    expect(rankSnapshotFindMany).not.toHaveBeenCalled();
  });

  it('does not overwrite existing non-null tier with null on retry', async () => {
    const externalMatchId = 'NA1_RANK_PERSIST_420';
    const ingestedAt = new Date('2024-06-15T12:00:00.000Z');
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-existing',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
      normalizationVersion: '1',
      ingestedAt,
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-1',
      matchId: 'match-existing',
      participantId: 1,
      playerAccountId: accountId,
      externalAccountId: FAKE_PUUID,
      rankTierAtIngestion: 'GOLD',
    });
    // No snapshots available on retry → resolved tier would be null.
    store.snapshots = [];

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);
    await persistNormalizedMatch(prisma as never, match, links);

    const participant = store.participants.find((row) => row.id === 'part-1');
    expect(participant?.rankTierAtIngestion).toBe('GOLD');
  });

  it('may populate existing null tier with a valid tier on retry', async () => {
    const externalMatchId = 'NA1_RANK_PERSIST_420';
    const ingestedAt = new Date('2024-06-15T12:00:00.000Z');
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-existing',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
      normalizationVersion: '1',
      ingestedAt,
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-1',
      matchId: 'match-existing',
      participantId: 1,
      playerAccountId: accountId,
      externalAccountId: FAKE_PUUID,
      rankTierAtIngestion: null,
    });
    store.snapshots.push({
      id: 'snap-1',
      playerAccountId: accountId,
      tier: 'EMERALD',
      queueType: 'RANKED_SOLO_5x5',
      capturedAt: new Date('2024-06-15T11:00:00.000Z'),
    });

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);
    await persistNormalizedMatch(prisma as never, match, links);

    const participant = store.participants.find((row) => row.id === 'part-1');
    expect(participant?.rankTierAtIngestion).toBe('EMERALD');
  });

  it('reuses existing match cutoff instead of retry-time now', async () => {
    const externalMatchId = 'NA1_RANK_PERSIST_420';
    const ingestedAt = new Date('2024-06-15T12:00:00.000Z');
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-existing',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
      normalizationVersion: '1',
      ingestedAt,
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-1',
      matchId: 'match-existing',
      participantId: 1,
      playerAccountId: null,
      externalAccountId: FAKE_PUUID,
      rankTierAtIngestion: null,
    });
    store.snapshots.push(
      {
        id: 'snap-before',
        playerAccountId: accountId,
        tier: 'GOLD',
        queueType: 'RANKED_SOLO_5x5',
        capturedAt: new Date('2024-06-15T11:00:00.000Z'),
      },
      {
        id: 'snap-after-retry',
        playerAccountId: accountId,
        tier: 'DIAMOND',
        queueType: 'RANKED_SOLO_5x5',
        // After original ingestedAt; would be used if cutoff were retry-time now.
        capturedAt: new Date('2024-06-20T00:00:00.000Z'),
      },
    );

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);
    await persistNormalizedMatch(prisma as never, match, links);

    const participant = store.participants.find((row) => row.id === 'part-1');
    expect(participant?.rankTierAtIngestion).toBe('GOLD');
    expect(rankSnapshotFindMany.mock.calls[0]![0].where.capturedAt.lte).toEqual(ingestedAt);

    const persistedMatch = store.matches.get(`RIOT:${externalMatchId}`);
    expect(persistedMatch?.ingestedAt).toEqual(ingestedAt);
  });

  it('populates null rank for newly linked participants on skippedComplete path', async () => {
    const externalMatchId = 'NA1_RANK_PERSIST_420';
    const ingestedAt = new Date('2024-06-15T12:00:00.000Z');
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-complete',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
      ingestedAt,
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-1',
      matchId: 'match-complete',
      participantId: 1,
      playerAccountId: null,
      externalAccountId: FAKE_PUUID,
      rankTierAtIngestion: null,
    });
    store.snapshots.push({
      id: 'snap-1',
      playerAccountId: accountId,
      tier: 'SILVER',
      queueType: 'RANKED_SOLO_5x5',
      capturedAt: new Date('2024-06-15T11:30:00.000Z'),
    });

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);
    const result = await persistNormalizedMatch(prisma as never, match, links);

    expect(result.skippedComplete).toBe(true);
    expect(result.previousParticipantSnapshots).toEqual([]);
    const participant = store.participants.find((row) => row.id === 'part-1');
    expect(participant?.playerAccountId).toBe(accountId);
    expect(participant?.rankTierAtIngestion).toBe('SILVER');
  });

  it('forceOverwrite rewrites participants on completed same-version match', async () => {
    const externalMatchId = 'NA1_FORCE_OVERWRITE';
    const stalePuuid = 'b'.repeat(78);
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-stale',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
      normalizedPatch: '14.1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      mapId: 11,
      gameMode: 'CLASSIC',
      remake: false,
      ingestedAt: new Date('2024-06-15T12:00:00.000Z'),
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-stale',
      matchId: 'match-stale',
      participantId: 1,
      playerAccountId: null,
      externalAccountId: stalePuuid,
      rankTierAtIngestion: null,
      championId: 1,
      teamPosition: 'TOP',
      individualPosition: 'TOP',
      lane: 'TOP',
      role: 'SOLO',
    });

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    match.externalMatchId = externalMatchId;
    const links = new Map([[FAKE_PUUID, accountId]]);
    const result = await persistNormalizedMatch(prisma as never, match, links, {
      forceOverwrite: true,
    });

    expect(result.skippedComplete).toBe(false);
    const participant = store.participants.find((row) => row.participantId === 1);
    expect(participant?.externalAccountId).toBe(FAKE_PUUID);
    expect(participant?.playerAccountId).toBe(accountId);
  });

  it('captures previous participant snapshots before overwrite for aggregation keys', async () => {
    const externalMatchId = 'NA1_RANK_PERSIST_420';
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-old',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
      normalizationVersion: '1',
      normalizedPatch: '14.1',
      platformRoute: 'na1',
      regionalRoute: 'americas',
      mapId: 11,
      gameMode: 'CLASSIC',
      remake: false,
      ingestedAt: new Date('2024-06-15T12:00:00.000Z'),
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-old',
      matchId: 'match-old',
      participantId: 1,
      playerAccountId: accountId,
      externalAccountId: FAKE_PUUID,
      rankTierAtIngestion: 'GOLD',
      championId: 103,
      teamPosition: 'UTILITY',
      individualPosition: 'UTILITY',
      lane: 'BOTTOM',
      role: 'DUO_SUPPORT',
    });

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const links = new Map([[FAKE_PUUID, accountId]]);
    const result = await persistNormalizedMatch(prisma as never, match, links);

    expect(result.skippedComplete).toBe(false);
    expect(result.previousParticipantSnapshots).toHaveLength(1);
    expect(result.previousParticipantSnapshots[0]).toMatchObject({
      patch: '14.1',
      platformRoute: 'na1',
      championId: 103,
      teamPosition: 'UTILITY',
      rankTierAtIngestion: 'GOLD',
    });
  });

  it('returns empty previous snapshots on create', async () => {
    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    const result = await persistNormalizedMatch(prisma as never, match, new Map());
    expect(result.created).toBe(true);
    expect(result.previousParticipantSnapshots).toEqual([]);
  });

  it('leaves unlinked participants with null rankTierAtIngestion', async () => {
    store.snapshots.push({
      id: 'snap-1',
      playerAccountId: accountId,
      tier: 'GOLD',
      queueType: 'RANKED_SOLO_5x5',
      capturedAt: new Date('2024-06-01T00:00:00.000Z'),
    });

    const match = buildNormalized(RANKED_SOLO_QUEUE_ID);
    await persistNormalizedMatch(prisma as never, match, new Map());

    const unlinked = store.participants.find(
      (row) => row.externalAccountId === buildPuuid(2),
    );
    expect(unlinked?.playerAccountId ?? null).toBeNull();
    expect(unlinked?.rankTierAtIngestion ?? null).toBeNull();
  });

  it('fills null rank when linking accounts on already-completed matches', async () => {
    const externalMatchId = 'NA1_RANK_PERSIST_420';
    const ingestedAt = new Date('2024-06-15T12:00:00.000Z');
    store.matches.set(`RIOT:${externalMatchId}`, {
      id: 'match-complete',
      provider: 'RIOT',
      externalMatchId,
      queueId: RANKED_SOLO_QUEUE_ID,
      ingestionStatus: MatchIngestionStatus.COMPLETED,
      normalizationVersion: '1',
      ingestedAt,
      createdAt: new Date('2024-06-15T11:00:00.000Z'),
    });
    store.participants.push({
      id: 'part-1',
      matchId: 'match-complete',
      participantId: 1,
      playerAccountId: null,
      externalAccountId: FAKE_PUUID,
      rankTierAtIngestion: null,
    });
    store.snapshots.push({
      id: 'snap-1',
      playerAccountId: accountId,
      tier: 'BRONZE',
      queueType: 'RANKED_SOLO_5x5',
      capturedAt: new Date('2024-06-15T11:30:00.000Z'),
    });

    await ensurePlayerLinkageForCompletedMatch({
      prisma: prisma as never,
      provider: 'RIOT',
      externalMatchId,
      requestedByPlayerAccountId: accountId,
    });

    const participant = store.participants.find((row) => row.id === 'part-1');
    expect(participant?.playerAccountId).toBe(accountId);
    expect(participant?.rankTierAtIngestion).toBe('BRONZE');
  });
});

describe('persistTimelineAndMetrics ingestedAt stability', () => {
  it('preserves existing ingestedAt when marking match COMPLETED', async () => {
    const existingIngestedAt = new Date('2024-06-15T12:00:00.000Z');
    const store: Store = {
      matches: new Map([
        [
          'RIOT:NA1_TIMELINE_CUTOFF',
          {
            id: 'match-timeline',
            provider: 'RIOT',
            externalMatchId: 'NA1_TIMELINE_CUTOFF',
            ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
            ingestedAt: existingIngestedAt,
            createdAt: new Date('2024-06-15T11:00:00.000Z'),
          },
        ],
      ]),
      participants: [],
      teams: [],
      timelines: new Map(),
      snapshots: [],
      accounts: [],
    };
    const { prisma } = createPrismaMock(store);

    await persistTimelineAndMetrics({
      prisma: prisma as never,
      matchId: 'match-timeline',
      fetchStatus: TimelineFetchStatus.FETCHED,
      rawPayload: null,
      timelineSchemaVersion: '1',
      metrics: [],
      markMatchCompleted: true,
    });

    const match = store.matches.get('RIOT:NA1_TIMELINE_CUTOFF');
    expect(match?.ingestionStatus).toBe(MatchIngestionStatus.COMPLETED);
    expect(match?.ingestedAt).toEqual(existingIngestedAt);
  });

  it('sets ingestedAt only when currently null on COMPLETED transition', async () => {
    const store: Store = {
      matches: new Map([
        [
          'RIOT:NA1_TIMELINE_NULL_INGESTED',
          {
            id: 'match-null-ingested',
            provider: 'RIOT',
            externalMatchId: 'NA1_TIMELINE_NULL_INGESTED',
            ingestionStatus: MatchIngestionStatus.IN_PROGRESS,
            ingestedAt: null,
            createdAt: new Date('2024-06-15T11:00:00.000Z'),
          },
        ],
      ]),
      participants: [],
      teams: [],
      timelines: new Map(),
      snapshots: [],
      accounts: [],
    };
    const { prisma } = createPrismaMock(store);

    await persistTimelineAndMetrics({
      prisma: prisma as never,
      matchId: 'match-null-ingested',
      fetchStatus: TimelineFetchStatus.SKIPPED,
      rawPayload: null,
      timelineSchemaVersion: '1',
      metrics: [],
      markMatchCompleted: true,
    });

    const match = store.matches.get('RIOT:NA1_TIMELINE_NULL_INGESTED');
    expect(match?.ingestionStatus).toBe(MatchIngestionStatus.COMPLETED);
    expect(match?.ingestedAt).toBeInstanceOf(Date);
  });
});
