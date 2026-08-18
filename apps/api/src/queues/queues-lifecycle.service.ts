import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  ChampionAiInsightJobPayload,
  MatchIngestionJobPayload,
  MatchTimelineJobPayload,
  PlayerPlaystyleInsightJobPayload,
} from '@league-helper/shared';
import {
  CHAMPION_AI_INSIGHT_QUEUE,
  MATCH_INGESTION_QUEUE,
  MATCH_TIMELINE_QUEUE,
  PLAYER_AI_PLAYSTYLE_QUEUE,
  REDIS_CONNECTION,
} from './queue.tokens';

/** Ensures Redis/BullMQ connections close when Nest app context shuts down. */
@Injectable()
export class QueuesLifecycleService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
    @Inject(MATCH_INGESTION_QUEUE) private readonly queue: Queue<MatchIngestionJobPayload>,
    @Inject(MATCH_TIMELINE_QUEUE)
    private readonly matchTimelineQueue: Queue<MatchTimelineJobPayload>,
    @Inject(CHAMPION_AI_INSIGHT_QUEUE)
    private readonly championAiInsightQueue: Queue<ChampionAiInsightJobPayload>,
    @Inject(PLAYER_AI_PLAYSTYLE_QUEUE)
    private readonly playerAiPlaystyleQueue: Queue<PlayerPlaystyleInsightJobPayload>,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.race([this.shutdown(), delay(2_000)]);
  }

  private async shutdown(): Promise<void> {
    try {
      await this.queue.close();
    } catch {
      // ignore close errors during shutdown
    }
    try {
      await this.matchTimelineQueue.close();
    } catch {
      // ignore close errors during shutdown
    }
    try {
      await this.championAiInsightQueue.close();
    } catch {
      // ignore close errors during shutdown
    }
    try {
      await this.playerAiPlaystyleQueue.close();
    } catch {
      // ignore close errors during shutdown
    }
    try {
      // Force-close: quit() can hang on shared BullMQ connections.
      this.redis.disconnect();
    } catch {
      // ignore
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
