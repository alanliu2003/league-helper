import { Inject, Injectable } from '@nestjs/common';
import {
  PlayerPlaystyleInsightStatus as PlayerPlaystyleInsightRowStatus,
  Prisma,
  type PlayerPlaystyleInsight,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const FAILURE_REASON_MAX = 500;

export type PlayerPlaystyleInsightScopeFingerprint = {
  playerAccountId: string;
  queueId: number;
  contextFingerprint: string;
};

export type UpsertPlayerPlaystyleInsightPendingInput = PlayerPlaystyleInsightScopeFingerprint & {
  promptVersion: string;
  provider: string;
  model: string;
  inputContext: Prisma.InputJsonValue;
};

@Injectable()
export class PlayerPlaystyleInsightRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByScopeFingerprint(
    scope: PlayerPlaystyleInsightScopeFingerprint,
  ): Promise<PlayerPlaystyleInsight | null> {
    return this.prisma.playerPlaystyleInsight.findUnique({
      where: {
        playerAccountId_queueId_contextFingerprint: scope,
      },
    });
  }

  upsertPending(input: UpsertPlayerPlaystyleInsightPendingInput): Promise<PlayerPlaystyleInsight> {
    const scope = {
      playerAccountId: input.playerAccountId,
      queueId: input.queueId,
      contextFingerprint: input.contextFingerprint,
    };

    return this.prisma.playerPlaystyleInsight.upsert({
      where: {
        playerAccountId_queueId_contextFingerprint: scope,
      },
      create: {
        ...scope,
        promptVersion: input.promptVersion,
        provider: input.provider,
        model: input.model,
        status: PlayerPlaystyleInsightRowStatus.PENDING,
        inputContext: input.inputContext,
      },
      update: {
        promptVersion: input.promptVersion,
        provider: input.provider,
        model: input.model,
        status: PlayerPlaystyleInsightRowStatus.PENDING,
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
  ): Promise<PlayerPlaystyleInsight> {
    return this.prisma.playerPlaystyleInsight.update({
      where: { id },
      data: {
        status: PlayerPlaystyleInsightRowStatus.READY,
        structuredResult: input.structuredResult,
        generatedAt: input.generatedAt,
        failureReason: null,
      },
    });
  }

  markFailed(id: string, failureReason: string): Promise<PlayerPlaystyleInsight> {
    return this.prisma.playerPlaystyleInsight.update({
      where: { id },
      data: {
        status: PlayerPlaystyleInsightRowStatus.FAILED,
        failureReason: failureReason.slice(0, FAILURE_REASON_MAX),
      },
    });
  }
}
