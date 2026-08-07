import { describe, expect, it, vi } from 'vitest';
import { expandMatchParticipantsSafe } from './expand-match-participants-safe.js';
import type { ParticipantExpansionConfig } from './participant-expansion.config.js';

function config(overrides: Partial<ParticipantExpansionConfig> = {}): ParticipantExpansionConfig {
  return {
    expandFromParticipants: true,
    expansionMaxDepth: 1,
    expansionMaxNewPlayersPerMatch: 3,
    expansionMaxNewPlayersPerSourcePlayer: 5,
    expansionMaxNewPlayersPerRun: 20,
    expansionMaxTrackedPlayers: 500,
    expansionQueueId: 420,
    platformAllowlist: ['na1'],
    ...overrides,
  };
}

describe('expandMatchParticipantsSafe', () => {
  it('disabled flag is a true zero-op (no match/expansion DB reads)', async () => {
    const prisma = {
      match: { findUnique: vi.fn() },
    };
    const expand = vi.fn();

    const result = await expandMatchParticipantsSafe({
      prisma: prisma as never,
      matchId: 'match-1',
      requestedByPlayerAccountId: '11111111-1111-4111-8111-111111111111',
      loadConfig: () => config({ expandFromParticipants: false }),
      expand: expand as never,
    });

    expect(result).toEqual({ skipped: true, reason: 'disabled' });
    expect(prisma.match.findUnique).not.toHaveBeenCalled();
    expect(expand).not.toHaveBeenCalled();
  });

  it('loads persisted match participants and invokes expansion when enabled', async () => {
    const participants = [
      {
        externalAccountId: 'puuid-a',
        riotIdGameName: 'A',
        riotIdTagLine: 'NA1',
        participantId: 1,
      },
    ];
    const prisma = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'match-1',
          queueId: 420,
          platformRoute: 'na1',
          regionalRoute: 'americas',
          participants,
        }),
      },
    };
    const expand = vi.fn().mockResolvedValue({
      skipped: false,
      participantsConsidered: 1,
      outcomes: [],
    });

    await expandMatchParticipantsSafe({
      prisma: prisma as never,
      matchId: 'match-1',
      requestedByPlayerAccountId: '11111111-1111-4111-8111-111111111111',
      sourceCollectorRunId: '22222222-2222-4222-8222-222222222222',
      loadConfig: () => config(),
      expand: expand as never,
    });

    expect(prisma.match.findUnique).toHaveBeenCalledWith({
      where: { id: 'match-1' },
      select: expect.objectContaining({
        queueId: true,
        participants: expect.any(Object),
      }),
    });
    expect(expand).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        matchId: 'match-1',
        queueId: 420,
        platformRoute: 'na1',
        participants,
        sourceCollectorRunId: '22222222-2222-4222-8222-222222222222',
      }),
      expect.objectContaining({ expandFromParticipants: true }),
    );
  });

  it('swallows expansion throws without rethrowing', async () => {
    const prisma = {
      match: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'match-1',
          queueId: 420,
          platformRoute: 'na1',
          regionalRoute: 'americas',
          participants: [],
        }),
      },
    };
    const expand = vi.fn().mockRejectedValue(new Error('boom'));

    const result = await expandMatchParticipantsSafe({
      prisma: prisma as never,
      matchId: 'match-1',
      requestedByPlayerAccountId: '11111111-1111-4111-8111-111111111111',
      loadConfig: () => config(),
      expand: expand as never,
    });

    expect(result).toEqual({ skipped: true, reason: 'error' });
  });
});
