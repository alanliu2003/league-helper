import { describe, expect, it } from 'vitest';
import { RiotMatchDtoSchema, RiotMatchTimelineDtoSchema } from './riot-api.schemas';
import { mockMatchDto, mockTimelineDto } from './fixtures';

describe('Riot response schemas', () => {
  it('accepts a valid match response and omitted optional fields', () => {
    const match = mockMatchDto();
    delete (match.info.participants[0] as { perks?: unknown }).perks;
    expect(RiotMatchDtoSchema.parse(match).metadata.matchId).toBe(match.metadata.matchId);
  });

  it('accepts a valid timeline including unknown event types', () => {
    const timeline = mockTimelineDto();
    const parsed = RiotMatchTimelineDtoSchema.parse(timeline);
    expect(
      parsed.info.frames[0]?.events.some((event) => event.type === 'SOME_FUTURE_UNKNOWN_EVENT'),
    ).toBe(true);
  });

  it('rejects structurally invalid timelines', () => {
    expect(() =>
      RiotMatchTimelineDtoSchema.parse({
        metadata: { matchId: 'NA1_1' },
        info: { frames: [{ timestamp: 0 }] },
      }),
    ).toThrow();
  });

  it('rejects malformed match payloads', () => {
    expect(() => RiotMatchDtoSchema.parse({ not: 'a-match' })).toThrow();
  });
});
