import {
  PlatformRouteSchema,
  ProviderIdSchema,
  RegionalRouteSchema,
  ValidationFailureError,
  parseRiotId,
} from '@league-helper/shared';
import type { PlayerAccount, Prisma, PrismaClient } from '@prisma/client';

/** Lowercase + trim for Riot ID lookup keys (mirrors API normalizeRiotLookupValue). */
function normalizeRiotLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

export type UpsertPlayerAccountIdentityInput = {
  playerId?: string;
  provider: string;
  externalAccountId: string;
  platformRoute: string;
  regionalRoute: string;
  gameName: string;
  tagLine: string;
  summonerId?: string | null;
  accountId?: string | null;
  profileIconId?: number | null;
  summonerLevel?: number | null;
  lastResolvedAt?: Date | null;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Upsert PlayerAccount from already-normalized identity fields.
 * Mirrors apps/api PlayerAccountRepository.upsertPlayerAccount semantics.
 * No network I/O.
 */
export async function upsertPlayerAccountIdentity(
  prisma: DbClient,
  input: UpsertPlayerAccountIdentityInput,
): Promise<PlayerAccount> {
  const provider = ProviderIdSchema.parse(input.provider);
  const platformRoute = PlatformRouteSchema.parse(input.platformRoute);
  const regionalRoute = RegionalRouteSchema.parse(input.regionalRoute);
  const riotId = parseRiotId({ gameName: input.gameName, tagLine: input.tagLine });
  const normalizedGameName = normalizeRiotLookupValue(riotId.gameName);
  const normalizedTagLine = normalizeRiotLookupValue(riotId.tagLine);
  const now = input.lastResolvedAt ?? new Date();

  if (!input.externalAccountId.trim()) {
    throw new ValidationFailureError('externalAccountId is required');
  }

  const run = async (tx: Prisma.TransactionClient): Promise<PlayerAccount> => {
    const existing = await tx.playerAccount.findUnique({
      where: {
        provider_externalAccountId: {
          provider,
          externalAccountId: input.externalAccountId,
        },
      },
    });

    let account: PlayerAccount;

    if (existing) {
      account = await tx.playerAccount.update({
        where: { id: existing.id },
        data: {
          platformRoute,
          regionalRoute,
          currentGameName: riotId.gameName,
          currentTagLine: riotId.tagLine,
          normalizedGameName,
          normalizedTagLine,
          summonerId: input.summonerId ?? existing.summonerId,
          accountId: input.accountId ?? existing.accountId,
          profileIconId: input.profileIconId ?? existing.profileIconId,
          summonerLevel: input.summonerLevel ?? existing.summonerLevel,
          lastResolvedAt: now,
        },
      });
    } else {
      const playerId =
        input.playerId ??
        (
          await tx.player.create({
            data: {},
          })
        ).id;

      account = await tx.playerAccount.create({
        data: {
          playerId,
          provider,
          externalAccountId: input.externalAccountId,
          platformRoute,
          regionalRoute,
          currentGameName: riotId.gameName,
          currentTagLine: riotId.tagLine,
          normalizedGameName,
          normalizedTagLine,
          summonerId: input.summonerId ?? null,
          accountId: input.accountId ?? null,
          profileIconId: input.profileIconId ?? null,
          summonerLevel: input.summonerLevel ?? null,
          lastResolvedAt: now,
        },
      });
    }

    await recordAliasHistory(tx, account.id, riotId.gameName, riotId.tagLine, now);
    return account;
  };

  if ('$transaction' in prisma && typeof prisma.$transaction === 'function') {
    return prisma.$transaction(async (tx) => run(tx));
  }

  return run(prisma as Prisma.TransactionClient);
}

async function recordAliasHistory(
  tx: Prisma.TransactionClient,
  playerAccountId: string,
  gameName: string,
  tagLine: string,
  seenAt: Date,
): Promise<void> {
  const riotId = parseRiotId({ gameName, tagLine });
  const normalizedGameName = normalizeRiotLookupValue(riotId.gameName);
  const normalizedTagLine = normalizeRiotLookupValue(riotId.tagLine);

  const current = await tx.playerAccountAlias.findFirst({
    where: { playerAccountId, isCurrent: true },
  });

  const sameAsCurrent =
    current &&
    current.normalizedGameName === normalizedGameName &&
    current.normalizedTagLine === normalizedTagLine;

  if (sameAsCurrent && current) {
    await tx.playerAccountAlias.update({
      where: { id: current.id },
      data: { lastSeenAt: seenAt },
    });
    return;
  }

  if (current) {
    await tx.playerAccountAlias.update({
      where: { id: current.id },
      data: { isCurrent: false },
    });
  }

  const existingAlias = await tx.playerAccountAlias.findFirst({
    where: {
      playerAccountId,
      normalizedGameName,
      normalizedTagLine,
    },
  });

  if (existingAlias) {
    await tx.playerAccountAlias.update({
      where: { id: existingAlias.id },
      data: {
        isCurrent: true,
        lastSeenAt: seenAt,
        gameName: riotId.gameName,
        tagLine: riotId.tagLine,
      },
    });
    return;
  }

  await tx.playerAccountAlias.create({
    data: {
      playerAccountId,
      gameName: riotId.gameName,
      tagLine: riotId.tagLine,
      normalizedGameName,
      normalizedTagLine,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      isCurrent: true,
    },
  });
}
