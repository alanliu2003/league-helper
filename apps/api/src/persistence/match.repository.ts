import { Inject, Injectable } from '@nestjs/common';
import {
  PlatformRouteSchema,
  ProviderIdSchema,
  RegionalRouteSchema,
  TeamPositionSchema,
  parsePatchVersion,
} from '@league-helper/shared';
import type { Match, MatchParticipant, Prisma } from '@prisma/client';
import { MatchIngestionStatus, TimelineFetchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Participant fields needed for public match cards (no PUUID / rawPayload). */
export const playerMatchParticipantSelect = {
  championId: true,
  championName: true,
  teamPosition: true,
  individualPosition: true,
  lane: true,
  role: true,
  win: true,
  kills: true,
  deaths: true,
  assists: true,
  totalCs: true,
  itemIds: true,
  summonerSpell1Id: true,
  summonerSpell2Id: true,
  goldAt10: true,
  goldAt15: true,
  csAt10: true,
  csAt15: true,
  xpAt10: true,
  xpAt15: true,
  goldDifferenceAt10: true,
  goldDifferenceAt15: true,
  csDifferenceAt10: true,
  csDifferenceAt15: true,
  killParticipation: true,
} as const;

export type PlayerMatchParticipantSummary = {
  championId: number;
  championName: string | null;
  teamPosition: string;
  individualPosition: string;
  lane: string | null;
  role: string | null;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalCs: number;
  itemIds: number[];
  summonerSpell1Id: number;
  summonerSpell2Id: number;
  goldAt10: number | null;
  goldAt15: number | null;
  csAt10: number | null;
  csAt15: number | null;
  xpAt10: number | null;
  xpAt15: number | null;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  killParticipation: number | null;
};

export type PlayerMatchListRow = Match & {
  participants: PlayerMatchParticipantSummary[];
};

export type CreateMatchIdempotentInput = {
  provider: string;
  externalMatchId: string;
  platformRoute?: string | null;
  regionalRoute: string;
  gameId?: bigint | null;
  queueId: number;
  mapId?: number | null;
  gameMode?: string | null;
  gameType?: string | null;
  gameCreation: Date;
  gameEndTimestamp?: Date | null;
  gameDurationSeconds: number;
  gameVersion: string;
  remake?: boolean;
  earlySurrender?: boolean;
  ingestionStatus?: MatchIngestionStatus;
  normalizationVersion?: string;
  rawPayload?: Prisma.InputJsonValue | null;
  teams: Array<{
    teamId: number;
    win: boolean;
    earlySurrender?: boolean;
    bans?: number[];
    objectives?: Prisma.InputJsonValue | null;
  }>;
  participants: Array<{
    participantId: number;
    playerAccountId?: string | null;
    externalAccountId?: string | null;
    riotIdGameName?: string | null;
    riotIdTagLine?: string | null;
    championId: number;
    championName?: string | null;
    teamId: number;
    teamPosition: string;
    individualPosition: string;
    lane?: string | null;
    role?: string | null;
    rankTierAtIngestion?: string | null;
    rankDivisionAtIngestion?: string | null;
    win: boolean;
    kills?: number;
    deaths?: number;
    assists?: number;
    totalCs?: number;
    goldEarned?: number;
    visionScore?: number;
    itemIds?: number[];
    perkIds?: number[];
    summonerSpell1Id?: number;
    summonerSpell2Id?: number;
  }>;
  timeline?: {
    fetchStatus?: TimelineFetchStatus;
    rawPayload?: Prisma.InputJsonValue | null;
    timelineSchemaVersion?: string;
  };
};

@Injectable()
export class MatchRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByProviderExternalId(provider: string, externalMatchId: string): Promise<Match | null> {
    return this.prisma.match.findUnique({
      where: {
        provider_externalMatchId: { provider, externalMatchId },
      },
    });
  }

  async findExistingByExternalIds(provider: string, externalMatchIds: string[]): Promise<Match[]> {
    if (externalMatchIds.length === 0) {
      return [];
    }

    const providerId = ProviderIdSchema.parse(provider);
    return this.prisma.match.findMany({
      where: {
        provider: providerId,
        externalMatchId: { in: externalMatchIds },
      },
    });
  }

  async listForPlayerAccount(input: {
    playerAccountId: string;
    limit: number;
    cursorGameCreation?: Date;
    cursorId?: string;
    queueId?: number;
    queueIds?: number[];
    excludeQueueIds?: number[];
    championId?: number;
    result?: 'win' | 'loss';
    includeRemakes?: boolean;
  }): Promise<PlayerMatchListRow[]> {
    const queueFilter =
      input.queueId !== undefined
        ? { queueId: input.queueId }
        : input.queueIds !== undefined
          ? { queueId: { in: input.queueIds } }
          : input.excludeQueueIds !== undefined
            ? { queueId: { notIn: input.excludeQueueIds } }
            : {};

    return this.prisma.match.findMany({
      where: {
        participants: {
          some: {
            playerAccountId: input.playerAccountId,
            ...(input.championId !== undefined ? { championId: input.championId } : {}),
            ...(input.result === 'win' ? { win: true } : {}),
            ...(input.result === 'loss' ? { win: false } : {}),
          },
        },
        ...queueFilter,
        ...(input.includeRemakes ? {} : { remake: false }),
        ...(input.cursorGameCreation && input.cursorId
          ? {
              OR: [
                { gameCreation: { lt: input.cursorGameCreation } },
                { gameCreation: input.cursorGameCreation, id: { lt: input.cursorId } },
              ],
            }
          : {}),
      },
      include: {
        participants: {
          where: { playerAccountId: input.playerAccountId },
          select: playerMatchParticipantSelect,
          take: 1,
        },
      },
      orderBy: [{ gameCreation: 'desc' }, { id: 'desc' }],
      take: input.limit,
    });
  }

  countCompletedForPlayerAccount(playerAccountId: string): Promise<number> {
    return this.prisma.match.count({
      where: {
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        participants: { some: { playerAccountId } },
      },
    });
  }

  /**
   * Link unlinked participants whose PUUID matches a known PlayerAccount.
   * Returns the number of participant rows updated.
   */
  async linkParticipantsByExternalAccountId(
    provider: string,
    externalAccountId: string,
    playerAccountId: string,
  ): Promise<number> {
    const providerId = ProviderIdSchema.parse(provider);
    const result = await this.prisma.matchParticipant.updateMany({
      where: {
        externalAccountId,
        playerAccountId: null,
        match: { provider: providerId },
      },
      data: { playerAccountId },
    });
    return result.count;
  }

  /** Completed matches linked to this account among the given external IDs. */
  async findLinkedCompletedExternalIds(
    playerAccountId: string,
    externalMatchIds: string[],
  ): Promise<string[]> {
    if (externalMatchIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.match.findMany({
      where: {
        externalMatchId: { in: externalMatchIds },
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        participants: { some: { playerAccountId } },
      },
      select: { externalMatchId: true },
    });
    return rows.map((row) => row.externalMatchId);
  }

  /**
   * External match IDs that already have a Match row but are not linked to this
   * player account (even when the participant PUUID matches).
   */
  async findExistingExternalIdsMissingLink(
    provider: string,
    playerAccountId: string,
    externalMatchIds: string[],
  ): Promise<string[]> {
    if (externalMatchIds.length === 0) {
      return [];
    }
    const providerId = ProviderIdSchema.parse(provider);
    const existing = await this.prisma.match.findMany({
      where: {
        provider: providerId,
        externalMatchId: { in: externalMatchIds },
      },
      select: {
        externalMatchId: true,
        participants: {
          where: { playerAccountId },
          select: { id: true },
          take: 1,
        },
      },
    });
    return existing
      .filter((match) => match.participants.length === 0)
      .map((match) => match.externalMatchId);
  }

  /**
   * Creates a match with teams/participants/timeline, or returns the existing match
   * when provider + externalMatchId already exists (idempotent).
   */
  async createMatchIdempotent(
    input: CreateMatchIdempotentInput,
  ): Promise<{ match: Match; created: boolean }> {
    const provider = ProviderIdSchema.parse(input.provider);
    const regionalRoute = RegionalRouteSchema.parse(input.regionalRoute);
    const platformRoute =
      input.platformRoute === null || input.platformRoute === undefined
        ? null
        : PlatformRouteSchema.parse(input.platformRoute);

    const existing = await this.findByProviderExternalId(provider, input.externalMatchId);
    if (existing) {
      return { match: existing, created: false };
    }

    const patch = parsePatchVersion(input.gameVersion);

    const match = await this.prisma.$transaction(async (tx) => {
      const created = await tx.match.create({
        data: {
          provider,
          externalMatchId: input.externalMatchId,
          platformRoute,
          regionalRoute,
          gameId: input.gameId ?? null,
          queueId: input.queueId,
          mapId: input.mapId ?? null,
          gameMode: input.gameMode ?? null,
          gameType: input.gameType ?? null,
          gameCreation: input.gameCreation,
          gameEndTimestamp: input.gameEndTimestamp ?? null,
          gameDurationSeconds: input.gameDurationSeconds,
          gameVersion: input.gameVersion,
          normalizedPatch: patch?.label ?? null,
          remake: input.remake ?? false,
          earlySurrender: input.earlySurrender ?? false,
          ingestionStatus: input.ingestionStatus ?? MatchIngestionStatus.COMPLETED,
          normalizationVersion: input.normalizationVersion ?? '1',
          rawPayload: input.rawPayload ?? undefined,
          ingestedAt: new Date(),
          teams: {
            create: input.teams.map((team) => ({
              teamId: team.teamId,
              win: team.win,
              earlySurrender: team.earlySurrender ?? false,
              bans: team.bans ?? [],
              objectives: team.objectives ?? undefined,
            })),
          },
          participants: {
            create: input.participants.map((participant) => ({
              participantId: participant.participantId,
              playerAccountId: participant.playerAccountId ?? null,
              externalAccountId: participant.externalAccountId ?? null,
              riotIdGameName: participant.riotIdGameName ?? null,
              riotIdTagLine: participant.riotIdTagLine ?? null,
              championId: participant.championId,
              championName: participant.championName ?? null,
              teamId: participant.teamId,
              teamPosition: TeamPositionSchema.parse(participant.teamPosition),
              individualPosition: participant.individualPosition,
              lane: participant.lane ?? null,
              role: participant.role ?? null,
              rankTierAtIngestion: participant.rankTierAtIngestion ?? null,
              rankDivisionAtIngestion: participant.rankDivisionAtIngestion ?? null,
              win: participant.win,
              kills: participant.kills ?? 0,
              deaths: participant.deaths ?? 0,
              assists: participant.assists ?? 0,
              totalCs: participant.totalCs ?? 0,
              goldEarned: participant.goldEarned ?? 0,
              visionScore: participant.visionScore ?? 0,
              itemIds: participant.itemIds ?? [],
              perkIds: participant.perkIds ?? [],
              summonerSpell1Id: participant.summonerSpell1Id ?? 0,
              summonerSpell2Id: participant.summonerSpell2Id ?? 0,
            })),
          },
          timeline: {
            create: {
              fetchStatus: input.timeline?.fetchStatus ?? TimelineFetchStatus.PENDING,
              rawPayload: input.timeline?.rawPayload ?? undefined,
              timelineSchemaVersion: input.timeline?.timelineSchemaVersion ?? '1',
              fetchedAt:
                input.timeline?.fetchStatus === TimelineFetchStatus.FETCHED ? new Date() : null,
            },
          },
        },
      });

      return created;
    });

    return { match, created: true };
  }

  attachPlayerAccountToParticipant(
    matchId: string,
    participantId: number,
    playerAccountId: string,
  ): Promise<MatchParticipant> {
    return this.prisma.matchParticipant.update({
      where: {
        matchId_participantId: { matchId, participantId },
      },
      data: { playerAccountId },
    });
  }
}
