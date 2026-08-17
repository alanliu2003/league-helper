import { describe, expect, it } from 'vitest';
import { RANKED_SOLO_QUEUE_ID } from '@league-helper/shared';
import {
  playerPlaystyleMatchSelect,
  playerPlaystyleParticipantSelect,
} from '../../persistence/match.repository';
import {
  PLAYSTYLE_WINDOW_LIMIT,
  classifyPlaystyleWindowRow,
  playstyleWindowListArgs,
  summarizePlaystyleWindow,
  type PlaystyleWindowRow,
} from './player-playstyle-matches';

function baseParticipant(
  overrides: Partial<PlaystyleWindowRow['participants'][number]> = {},
): PlaystyleWindowRow['participants'][number] {
  return {
    participantId: 1,
    championId: 103,
    championName: 'Ahri',
    teamPosition: 'MIDDLE',
    individualPosition: 'MIDDLE',
    lane: 'MIDDLE',
    role: 'SOLO',
    rankTierAtIngestion: 'GOLD',
    rankResolutionStatus: 'RESOLVED_RANKED',
    win: true,
    kills: 5,
    deaths: 3,
    assists: 7,
    totalCs: 180,
    goldEarned: 11000,
    visionScore: 18,
    timePlayedSeconds: 1800,
    totalDamageDealtToChampions: 18000,
    goldDifferenceAt10: 120,
    goldDifferenceAt15: 240,
    csDifferenceAt10: 8,
    csDifferenceAt15: 12,
    ...overrides,
  };
}

function windowRow(overrides: Partial<PlaystyleWindowRow> = {}): PlaystyleWindowRow {
  return {
    id: 'match-1',
    queueId: RANKED_SOLO_QUEUE_ID,
    gameCreation: new Date('2026-08-01T00:00:00.000Z'),
    gameDurationSeconds: 1800,
    remake: false,
    ingestionStatus: 'COMPLETED',
    normalizedPatch: '16.15',
    platformRoute: 'na1',
    regionalRoute: 'americas',
    mapId: 11,
    gameMode: 'CLASSIC',
    participants: [baseParticipant()],
    ...overrides,
  };
}

describe('playstyle window fetch contract', () => {
  it('locks Ranked Solo 420, includes remakes, and never asks for match 21+', () => {
    const args = playstyleWindowListArgs('account-1');
    expect(args.queueId).toBe(420);
    expect(args.includeRemakes).toBe(true);
    expect(args.limit).toBe(20);
    expect(args.limit).toBe(PLAYSTYLE_WINDOW_LIMIT);
    expect(args.playerAccountId).toBe('account-1');
    expect(args.limit).toBeLessThanOrEqual(20);
  });

  it('selects playstyle metric fields without identity or raw payloads', () => {
    expect(playerPlaystyleParticipantSelect.goldEarned).toBe(true);
    expect(playerPlaystyleParticipantSelect.rankTierAtIngestion).toBe(true);
    expect(playerPlaystyleParticipantSelect.rankResolutionStatus).toBe(true);
    expect(playerPlaystyleParticipantSelect.timePlayedSeconds).toBe(true);
    expect(playerPlaystyleParticipantSelect.totalDamageDealtToChampions).toBe(true);
    expect(playerPlaystyleParticipantSelect.visionScore).toBe(true);
    expect(playerPlaystyleParticipantSelect.participantId).toBe(true);
    expect(playerPlaystyleParticipantSelect).not.toHaveProperty('externalAccountId');
    expect(playerPlaystyleParticipantSelect).not.toHaveProperty('rawPayload');

    expect(playerPlaystyleMatchSelect.gameCreation).toBe(true);
    expect(playerPlaystyleMatchSelect.remake).toBe(true);
    expect(playerPlaystyleMatchSelect.ingestionStatus).toBe(true);
    expect(playerPlaystyleMatchSelect.normalizedPatch).toBe(true);
    expect(playerPlaystyleMatchSelect.platformRoute).toBe(true);
    expect(playerPlaystyleMatchSelect).not.toHaveProperty('rawPayload');
    expect(playerPlaystyleMatchSelect).not.toHaveProperty('externalAccountId');
  });
});

describe('classifyPlaystyleWindowRow skip order', () => {
  it('classifies remakes first even when ingestion is incomplete and position is unknown', () => {
    const row = windowRow({
      remake: true,
      ingestionStatus: 'PENDING',
      participants: [baseParticipant({ teamPosition: 'NONE', individualPosition: 'NONE' })],
    });
    expect(classifyPlaystyleWindowRow(row)).toEqual({ kind: 'skipped', reason: 'remake' });
  });

  it('classifies non-completed ingestion as incomplete before unknown position', () => {
    const row = windowRow({
      remake: false,
      ingestionStatus: 'IN_PROGRESS',
      participants: [baseParticipant({ teamPosition: 'NONE', individualPosition: 'NONE' })],
    });
    expect(classifyPlaystyleWindowRow(row)).toEqual({ kind: 'skipped', reason: 'incomplete' });
  });

  it('classifies UNKNOWN normalized position after completed non-remakes', () => {
    const row = windowRow({
      participants: [
        baseParticipant({
          teamPosition: 'NONE',
          individualPosition: 'NONE',
          lane: null,
          role: null,
        }),
      ],
    });
    expect(classifyPlaystyleWindowRow(row)).toEqual({
      kind: 'skipped',
      reason: 'unknownPosition',
    });
  });

  it('classifies missing patch or platform as incomplete', () => {
    expect(classifyPlaystyleWindowRow(windowRow({ normalizedPatch: null }))).toEqual({
      kind: 'skipped',
      reason: 'incomplete',
    });
    expect(classifyPlaystyleWindowRow(windowRow({ platformRoute: null }))).toEqual({
      kind: 'skipped',
      reason: 'incomplete',
    });
  });

  it('classifies structurally invalid combat/economy fields as incomplete', () => {
    expect(
      classifyPlaystyleWindowRow(
        windowRow({ participants: [baseParticipant({ goldEarned: -1 })] }),
      ),
    ).toEqual({ kind: 'skipped', reason: 'incomplete' });
    expect(
      classifyPlaystyleWindowRow(
        windowRow({ participants: [baseParticipant({ kills: Number.NaN })] }),
      ),
    ).toEqual({ kind: 'skipped', reason: 'incomplete' });
    expect(classifyPlaystyleWindowRow(windowRow({ participants: [] }))).toEqual({
      kind: 'skipped',
      reason: 'incomplete',
    });
  });

  it('analyzes completed non-remake matches with a known position and valid stats', () => {
    const row = windowRow();
    expect(classifyPlaystyleWindowRow(row)).toEqual({ kind: 'analyzed', row });
  });
});

describe('summarizePlaystyleWindow accounting identity', () => {
  it('keeps skipped.remake + incomplete + unknownPosition + analyzed = windowSize', () => {
    const rows = [
      windowRow({ id: 'remake', remake: true, ingestionStatus: 'PENDING' }),
      windowRow({ id: 'pending', ingestionStatus: 'PENDING' }),
      windowRow({
        id: 'unknown-pos',
        participants: [
          baseParticipant({ teamPosition: 'NONE', individualPosition: 'INVALID', lane: null }),
        ],
      }),
      windowRow({ id: 'no-patch', normalizedPatch: null }),
      windowRow({
        id: 'bad-gold',
        participants: [baseParticipant({ goldEarned: Number.POSITIVE_INFINITY })],
      }),
      windowRow({ id: 'ok-1' }),
      windowRow({ id: 'ok-2', gameCreation: new Date('2026-08-02T00:00:00.000Z') }),
      windowRow({ id: 'ok-3', gameCreation: new Date('2026-08-03T00:00:00.000Z') }),
    ];

    const summary = summarizePlaystyleWindow(rows);

    expect(summary.windowSize).toBe(rows.length);
    expect(summary.skipped.remake).toBe(1);
    expect(summary.skipped.incomplete).toBe(3);
    expect(summary.skipped.unknownPosition).toBe(1);
    expect(summary.analyzed).toHaveLength(3);
    expect(
      summary.skipped.remake +
        summary.skipped.incomplete +
        summary.skipped.unknownPosition +
        summary.analyzed.length,
    ).toBe(summary.windowSize);
    expect(summary.windowSize).toBeLessThanOrEqual(20);
  });
});
