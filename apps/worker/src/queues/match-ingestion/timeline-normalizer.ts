import { ProviderResponseInvalidError } from '@league-helper/shared';
import {
  RiotMatchTimelineDtoSchema,
  type RiotMatchTimelineDto,
  type RiotTimelineEventDto,
  type RiotTimelineFrameDto,
} from '@league-helper/server-riot';
import type { Prisma } from '@prisma/client';

export type NormalizedTimeline = {
  timelineSchemaVersion: string;
  rawPayload: Prisma.InputJsonValue | null;
  frames: RiotTimelineFrameDto[];
  events: RiotTimelineEventDto[];
  frameIntervalMs: number;
};

/**
 * Validate and lightly normalize a Match-v5 timeline DTO.
 * Unknown event types are retained via schema passthrough.
 */
export function normalizeTimeline(input: {
  raw: unknown;
  storeRawPayloads: boolean;
  timelineSchemaVersion?: string;
}): NormalizedTimeline {
  const parsed = RiotMatchTimelineDtoSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new ProviderResponseInvalidError('Riot timeline payload failed schema validation.');
  }

  const timeline: RiotMatchTimelineDto = parsed.data;
  const frames = timeline.info.frames ?? [];
  const events = frames.flatMap((frame) => frame.events ?? []);

  return {
    timelineSchemaVersion: input.timelineSchemaVersion ?? '1',
    rawPayload: input.storeRawPayloads ? (timeline as unknown as Prisma.InputJsonValue) : null,
    frames,
    events,
    frameIntervalMs: timeline.info.frameInterval,
  };
}
