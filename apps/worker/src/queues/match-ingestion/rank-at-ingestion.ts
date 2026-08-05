import type { Prisma, PrismaClient } from '@prisma/client';
import {
  RANKED_FLEX_QUEUE_ID,
  RANKED_SOLO_QUEUE_ID,
  RankTierSchema,
} from '@league-helper/shared';
import { logger } from '../../logger.js';

/** Prisma client or interactive transaction client with RankSnapshot access. */
export type RankSnapshotClient = Pick<PrismaClient, 'rankSnapshot'> | Prisma.TransactionClient;

const QUEUE_ID_TO_QUEUE_TYPE: ReadonlyMap<number, 'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'> = new Map([
  [RANKED_SOLO_QUEUE_ID, 'RANKED_SOLO_5x5'],
  [RANKED_FLEX_QUEUE_ID, 'RANKED_FLEX_SR'],
]);

/**
 * Batch-load known rank tiers at a stable ingestion cutoff from local RankSnapshot rows.
 * Queues other than Solo (420) / Flex (440) return null for every participant and skip the query.
 * Never creates accounts or calls Riot.
 */
export async function loadRankTiersAtIngestion(input: {
  prisma: RankSnapshotClient;
  queueId: number;
  cutoff: Date;
  links: Array<{ participantKey: string; playerAccountId: string | null }>;
}): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  for (const link of input.links) {
    result.set(link.participantKey, null);
  }

  const queueType = QUEUE_ID_TO_QUEUE_TYPE.get(input.queueId);
  if (!queueType) {
    return result;
  }

  const accountIds = [
    ...new Set(
      input.links
        .map((link) => link.playerAccountId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (accountIds.length === 0) {
    return result;
  }

  const snapshots = await input.prisma.rankSnapshot.findMany({
    where: {
      playerAccountId: { in: accountIds },
      queueType,
      capturedAt: { lte: input.cutoff },
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      playerAccountId: true,
      tier: true,
      capturedAt: true,
    },
  });

  const tierByAccount = new Map<string, string | null>();
  let malformedTierCount = 0;

  for (const snapshot of snapshots) {
    if (tierByAccount.has(snapshot.playerAccountId)) {
      continue;
    }
    const parsed = RankTierSchema.safeParse(snapshot.tier);
    if (!parsed.success) {
      malformedTierCount += 1;
      tierByAccount.set(snapshot.playerAccountId, null);
      continue;
    }
    tierByAccount.set(snapshot.playerAccountId, parsed.data);
  }

  if (malformedTierCount > 0) {
    logger.warn('Ignoring malformed RankSnapshot tier at ingestion', {
      malformedTierCount,
      queueId: input.queueId,
    });
  }

  for (const link of input.links) {
    if (!link.playerAccountId) {
      result.set(link.participantKey, null);
      continue;
    }
    result.set(link.participantKey, tierByAccount.get(link.playerAccountId) ?? null);
  }

  return result;
}
