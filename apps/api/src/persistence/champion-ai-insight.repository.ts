import { Inject, Injectable } from '@nestjs/common';
import {
  ChampionAiInsightStatus as ChampionAiInsightRowStatus,
  Prisma,
  type ChampionAiInsight,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const FAILURE_REASON_MAX = 500;

export type ChampionAiInsightScopeFingerprint = {
  championId: number;
  patch: string;
  platformRoute: string;
  queueId: number;
  rankTier: string;
  teamPosition: string;
  contextFingerprint: string;
};

export type UpsertChampionAiInsightPendingInput = ChampionAiInsightScopeFingerprint & {
  championKey: string;
  promptVersion: string;
  provider: string;
  model: string;
  inputContext: Prisma.InputJsonValue;
};

@Injectable()
export class ChampionAiInsightRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByScopeFingerprint(
    scope: ChampionAiInsightScopeFingerprint,
  ): Promise<ChampionAiInsight | null> {
    return this.prisma.championAiInsight.findUnique({
      where: {
        championId_patch_platformRoute_queueId_rankTier_teamPosition_contextFingerprint: scope,
      },
    });
  }

  upsertPending(input: UpsertChampionAiInsightPendingInput): Promise<ChampionAiInsight> {
    const scope = {
      championId: input.championId,
      patch: input.patch,
      platformRoute: input.platformRoute,
      queueId: input.queueId,
      rankTier: input.rankTier,
      teamPosition: input.teamPosition,
      contextFingerprint: input.contextFingerprint,
    };

    return this.prisma.championAiInsight.upsert({
      where: {
        championId_patch_platformRoute_queueId_rankTier_teamPosition_contextFingerprint: scope,
      },
      create: {
        ...scope,
        championKey: input.championKey,
        promptVersion: input.promptVersion,
        provider: input.provider,
        model: input.model,
        status: ChampionAiInsightRowStatus.PENDING,
        inputContext: input.inputContext,
      },
      update: {
        championKey: input.championKey,
        promptVersion: input.promptVersion,
        provider: input.provider,
        model: input.model,
        status: ChampionAiInsightRowStatus.PENDING,
        inputContext: input.inputContext,
        structuredResult: Prisma.DbNull,
        failureReason: null,
        generatedAt: null,
      },
    });
  }

  markReady(
    id: string,
    input: { structuredResult: Prisma.InputJsonValue; generatedAt: Date },
  ): Promise<ChampionAiInsight> {
    return this.prisma.championAiInsight.update({
      where: { id },
      data: {
        status: ChampionAiInsightRowStatus.READY,
        structuredResult: input.structuredResult,
        generatedAt: input.generatedAt,
        failureReason: null,
      },
    });
  }

  markFailed(id: string, failureReason: string): Promise<ChampionAiInsight> {
    return this.prisma.championAiInsight.update({
      where: { id },
      data: {
        status: ChampionAiInsightRowStatus.FAILED,
        failureReason: failureReason.slice(0, FAILURE_REASON_MAX),
      },
    });
  }
}
