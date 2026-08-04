import { Injectable } from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

  findByProviderExternalId(provider: string, externalMatchId: string): Promise<Match | null> {
    return this.prisma.match.findUnique({
      where: {
        provider_externalMatchId: { provider, externalMatchId },
      },
    });
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
