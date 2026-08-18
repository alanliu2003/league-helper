import { describe, expect, it } from 'vitest';
import {
  PublicMatchTimelineDetailSchema,
  PublicMatchTimelineParticipantSchema,
  coverageFromEventAndFrameRows,
  deriveTeamGoldSeries,
  mapPublicObjectiveType,
  publicSkillSlotLabel,
} from './match-timeline';

const LEAK_FIELDS = ['puuid', 'externalAccountId', 'externalMatchId', 'rawPayload'] as const;

function emptyGoldSeries() {
  return {
    timestampsMs: [],
    teams: [],
    participants: [],
    difference: null,
  };
}

function minimalTimelineDetail() {
  return {
    matchId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    status: 'AVAILABLE' as const,
    coverage: {
      items: false,
      skills: false,
      kills: false,
      objectives: false,
      frames: false,
    },
    frameIntervalMs: 60_000,
    participants: [
      {
        participantId: 1,
        teamId: 100,
        side: 'BLUE' as const,
        playerId: null,
        riotId: { gameName: 'Alice', tagLine: 'NA1' },
        championId: 23,
        championKey: 'Tryndamere',
        championName: 'Tryndamere',
        championIconUrl:
          'https://ddragon.leagueoflegends.com/cdn/14.11.1/img/champion/Tryndamere.png',
        teamPosition: 'TOP' as const,
      },
    ],
    events: [],
    frames: [],
    derived: {
      kills: [],
      objectives: [],
      gold: emptyGoldSeries(),
    },
  };
}

describe('mapPublicObjectiveType', () => {
  it('maps known elite monsters and buildings', () => {
    expect(mapPublicObjectiveType({ monsterType: 'DRAGON' })).toBe('dragon');
    expect(mapPublicObjectiveType({ monsterType: 'BARON_NASHOR' })).toBe('baron');
    expect(mapPublicObjectiveType({ monsterType: 'RIFTHERALD' })).toBe('riftHerald');
    expect(mapPublicObjectiveType({ buildingType: 'TOWER_BUILDING' })).toBe('tower');
    expect(mapPublicObjectiveType({ buildingType: 'INHIBITOR_BUILDING' })).toBe('inhibitor');
  });

  it('returns null for unknown or newer types', () => {
    expect(mapPublicObjectiveType({ monsterType: 'HORDE' })).toBeNull();
    expect(mapPublicObjectiveType({ monsterType: 'ATAKHAN' })).toBeNull();
    expect(mapPublicObjectiveType({})).toBeNull();
  });
});

describe('deriveTeamGoldSeries', () => {
  it('sums by team and differences blue minus red for complete snapshots', () => {
    const derived = deriveTeamGoldSeries({
      participants: [
        { participantId: 1, teamId: 100 },
        { participantId: 6, teamId: 200 },
      ],
      frames: [
        { timestampMs: 0, participantId: 1, totalGold: 500 },
        { timestampMs: 0, participantId: 6, totalGold: 500 },
        { timestampMs: 60_000, participantId: 1, totalGold: 1200 },
        { timestampMs: 60_000, participantId: 6, totalGold: 900 },
      ],
    });
    expect(derived.timestampsMs).toEqual([0, 60_000]);
    expect(derived.difference).toEqual([0, 300]);
  });

  it('omits incomplete timestamps instead of zero-filling missing participants', () => {
    const derived = deriveTeamGoldSeries({
      participants: [
        { participantId: 1, teamId: 100 },
        { participantId: 6, teamId: 200 },
      ],
      frames: [
        { timestampMs: 0, participantId: 1, totalGold: 500 },
        { timestampMs: 0, participantId: 6, totalGold: 500 },
        // incomplete: participant 6 missing at 60s — must NOT become 1200 vs 0
        { timestampMs: 60_000, participantId: 1, totalGold: 1200 },
        { timestampMs: 120_000, participantId: 1, totalGold: 1800 },
        { timestampMs: 120_000, participantId: 6, totalGold: 1500 },
      ],
    });
    expect(derived.timestampsMs).toEqual([0, 120_000]);
    expect(derived.difference).toEqual([0, 300]);
    expect(derived.timestampsMs).not.toContain(60_000);
  });

  it('omits a missing side from teams and sets difference null', () => {
    const derived = deriveTeamGoldSeries({
      participants: [{ participantId: 1, teamId: 100 }],
      frames: [
        { timestampMs: 0, participantId: 1, totalGold: 500 },
        { timestampMs: 60_000, participantId: 1, totalGold: 1200 },
      ],
    });
    expect(derived.difference).toBeNull();
    expect(derived.teams.map((team) => team.teamId)).toEqual([100]);
    expect(derived.teams.some((team) => team.teamId === 200)).toBe(false);
    expect(derived.timestampsMs).toEqual([0, 60_000]);
    expect(derived.teams[0]?.gold).toEqual([500, 1200]);
  });

  it('does not create a fake gold drop from a missing participant frame', () => {
    const derived = deriveTeamGoldSeries({
      participants: [
        { participantId: 1, teamId: 100 },
        { participantId: 6, teamId: 200 },
      ],
      frames: [
        { timestampMs: 0, participantId: 1, totalGold: 500 },
        { timestampMs: 0, participantId: 6, totalGold: 500 },
        { timestampMs: 60_000, participantId: 1, totalGold: 1200 },
        { timestampMs: 120_000, participantId: 1, totalGold: 1800 },
        { timestampMs: 120_000, participantId: 6, totalGold: 1500 },
      ],
    });
    expect(derived.teams.find((team) => team.teamId === 100)?.gold).toEqual([500, 1800]);
    expect(derived.teams.find((team) => team.teamId === 200)?.gold).toEqual([500, 1500]);
    const blue = derived.teams.find((team) => team.teamId === 100)?.gold ?? [];
    const red = derived.teams.find((team) => team.teamId === 200)?.gold ?? [];
    for (let i = 0; i < Math.min(blue.length, red.length); i += 1) {
      expect([blue[i], red[i]]).not.toEqual([1200, 0]);
    }
  });
});

describe('publicSkillSlotLabel', () => {
  it('maps 1-4 to QWER', () => {
    expect(publicSkillSlotLabel(1)).toBe('Q');
    expect(publicSkillSlotLabel(4)).toBe('R');
    expect(publicSkillSlotLabel(5)).toBeNull();
  });
});

describe('PublicMatchTimelineDetailSchema', () => {
  it('parses a minimal valid object without PUUID fields', () => {
    const parsed = PublicMatchTimelineDetailSchema.parse(minimalTimelineDetail());
    expect(parsed.matchId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(parsed.status).toBe('AVAILABLE');
    expect(parsed.participants[0]).toMatchObject({
      participantId: 1,
      teamId: 100,
      side: 'BLUE',
      playerId: null,
      riotId: { gameName: 'Alice', tagLine: 'NA1' },
    });
    for (const field of LEAK_FIELDS) {
      expect(parsed).not.toHaveProperty(field);
      expect(parsed.participants[0]).not.toHaveProperty(field);
    }
  });

  it('does not declare identity leak fields on the public schema', () => {
    for (const field of LEAK_FIELDS) {
      expect(PublicMatchTimelineDetailSchema.shape).not.toHaveProperty(field);
      expect(PublicMatchTimelineParticipantSchema.shape).not.toHaveProperty(field);
    }
  });

  it('strips top-level puuid instead of copying it onto the parsed result', () => {
    const parsed = PublicMatchTimelineDetailSchema.parse({
      ...minimalTimelineDetail(),
      puuid: 'abcdefghijklmnopqrstuvwxyz1234567890abcd',
    });
    expect(parsed).not.toHaveProperty('puuid');
  });
});

describe('coverageFromEventAndFrameRows', () => {
  it('sets items true only for item purchase/sell/undo/destroy events', () => {
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'ITEM_PURCHASED' }], frames: [] }).items,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'ITEM_SOLD' }], frames: [] }).items,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'ITEM_UNDO' }], frames: [] }).items,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'ITEM_DESTROYED' }], frames: [] }).items,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'CHAMPION_KILL' }], frames: [] }).items,
    ).toBe(false);
  });

  it('sets skills true only for SKILL_LEVEL_UP', () => {
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'SKILL_LEVEL_UP' }], frames: [] }).skills,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'ITEM_PURCHASED' }], frames: [] }).skills,
    ).toBe(false);
  });

  it('sets kills true only for CHAMPION_KILL', () => {
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'CHAMPION_KILL' }], frames: [] }).kills,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({ events: [{ type: 'ELITE_MONSTER_KILL' }], frames: [] }).kills,
    ).toBe(false);
  });

  it('sets objectives true only when an event maps via mapPublicObjectiveType', () => {
    expect(
      coverageFromEventAndFrameRows({
        events: [{ type: 'ELITE_MONSTER_KILL', monsterType: 'DRAGON' }],
        frames: [],
      }).objectives,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({
        events: [{ type: 'BUILDING_KILL', buildingType: 'TOWER_BUILDING' }],
        frames: [],
      }).objectives,
    ).toBe(true);
    expect(
      coverageFromEventAndFrameRows({
        events: [{ type: 'ELITE_MONSTER_KILL', monsterType: 'HORDE' }],
        frames: [],
      }).objectives,
    ).toBe(false);
  });

  it('sets frames true iff the frames array is non-empty', () => {
    expect(coverageFromEventAndFrameRows({ events: [], frames: [] }).frames).toBe(false);
    expect(coverageFromEventAndFrameRows({ events: [], frames: [{ timestampMs: 0 }] }).frames).toBe(
      true,
    );
  });
});
