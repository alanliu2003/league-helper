import { describe, expect, it } from 'vitest';
import { normalizeTimeline } from './timeline-normalizer.js';
import { extractPersistedTimelineEvents } from './timeline-product-events.js';
import { buildRichTimelineDto } from './test-utils/ranked-match-fixture.js';

const PERSISTED_EVENT_KEYS = new Set([
  'eventIndex',
  'type',
  'timestampMs',
  'participantId',
  'itemId',
  'beforeItemId',
  'afterItemId',
  'skillSlot',
  'levelUpType',
  'killerParticipantId',
  'victimParticipantId',
  'assistingParticipantIds',
  'teamId',
  'positionX',
  'positionY',
  'monsterType',
  'monsterSubType',
  'buildingType',
  'towerType',
  'laneType',
]);

describe('extractPersistedTimelineEvents', () => {
  it('keeps allowlisted product events, drops wards/plates, and assigns contiguous indexes', () => {
    const raw = buildRichTimelineDto();
    const frame0 = raw.info.frames[0];
    if (frame0) {
      frame0.events = [
        ...(frame0.events ?? []),
        {
          type: 'CHAMPION_KILL',
          timestamp: 900_000,
          killerId: 0,
          victimId: 3,
          assistingParticipantIds: [],
          position: { x: 11, y: 22 },
        },
        {
          type: 'WARD_PLACED',
          timestamp: 910_000,
          participantId: 1,
        },
        {
          type: 'TURRET_PLATE_DESTROYED',
          timestamp: 920_000,
          killerId: 1,
          teamId: 200,
        },
        {
          type: 'LEVEL_UP',
          timestamp: 930_000,
          participantId: 1,
        },
      ];
    }

    const timeline = normalizeTimeline({ raw, storeRawPayloads: false });
    const persisted = extractPersistedTimelineEvents(timeline.events);
    const types = persisted.map((event) => event.type);

    expect(types).toContain('ITEM_PURCHASED');
    expect(types).toContain('ITEM_SOLD');
    expect(types).toContain('ITEM_UNDO');
    expect(types).toContain('SKILL_LEVEL_UP');
    expect(types).toContain('CHAMPION_KILL');
    expect(types).toContain('ELITE_MONSTER_KILL');
    expect(types).toContain('BUILDING_KILL');
    expect(types).not.toContain('WARD_PLACED');
    expect(types).not.toContain('TURRET_PLATE_DESTROYED');
    expect(types).not.toContain('LEVEL_UP');

    expect(persisted.every((event, index) => event.eventIndex === index)).toBe(true);
    expect(persisted.map((event) => event.eventIndex)).toEqual(
      Array.from({ length: persisted.length }, (_, index) => index),
    );

    const assistedKill = persisted.find(
      (event) => event.type === 'CHAMPION_KILL' && event.killerParticipantId === 6,
    );
    expect(assistedKill).toMatchObject({
      victimParticipantId: 1,
      assistingParticipantIds: [7],
      positionX: 100,
      positionY: 200,
    });

    const environmentKill = persisted.find(
      (event) => event.type === 'CHAMPION_KILL' && event.victimParticipantId === 3,
    );
    expect(environmentKill?.killerParticipantId).toBe(0);
    expect(environmentKill?.killerParticipantId).not.toBeNull();

    const dragon = persisted.find((event) => event.type === 'ELITE_MONSTER_KILL');
    expect(dragon).toMatchObject({
      monsterType: 'DRAGON',
      monsterSubType: 'FIRE_DRAGON',
      killerParticipantId: 2,
      teamId: 100,
    });

    const tower = persisted.find((event) => event.type === 'BUILDING_KILL');
    expect(tower).toMatchObject({
      buildingType: 'TOWER_BUILDING',
      towerType: 'OUTER_TURRET',
      laneType: 'TOP_LANE',
      teamId: 200,
      killerParticipantId: 1,
    });
  });

  it('does not copy unknown fields or metadata participant identifiers', () => {
    const raw = buildRichTimelineDto();
    const frame0 = raw.info.frames[0];
    if (frame0) {
      frame0.events = [
        ...(frame0.events ?? []),
        {
          type: 'CHAMPION_KILL',
          timestamp: 950_000,
          killerId: 4,
          victimId: 8,
          assistingParticipantIds: [5],
          position: { x: 3, y: 4 },
          someUnknownField: 'drop-me',
          participants: raw.metadata.participants,
        } as (typeof frame0.events)[number],
      ];
    }

    const timeline = normalizeTimeline({ raw, storeRawPayloads: false });
    const persisted = extractPersistedTimelineEvents(timeline.events);
    const serialized = JSON.stringify(persisted);

    expect(serialized).not.toContain('fake-puuid');
    expect(serialized).not.toContain('drop-me');
    expect(serialized).not.toContain('someUnknownField');
    expect(serialized).not.toContain('"participants"');

    for (const event of persisted) {
      for (const key of Object.keys(event)) {
        expect(PERSISTED_EVENT_KEYS.has(key)).toBe(true);
      }
      expect(event).not.toHaveProperty('participants');
      expect(event).not.toHaveProperty('someUnknownField');
    }
  });
});
