import { describe, expect, it, vi } from 'vitest';
import { expandFromCompletedMatch } from './participant-expansion.service.js';
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
    totalTrackedPlayersHardCap: 5000,
    ...overrides,
  };
}

describe('expandFromCompletedMatch', () => {
  it('disabled flag performs zero expansion DB reads', async () => {
    const prisma = {
      trackedPlayer: { findUnique: vi.fn() },
      playerAccount: { findUnique: vi.fn() },
    };

    const result = await expandFromCompletedMatch(
      prisma as never,
      {
        matchId: 'm1',
        queueId: 420,
        platformRoute: 'na1',
        regionalRoute: 'americas',
        requestedByPlayerAccountId: 'acc-1',
        participants: [],
      },
      config({ expandFromParticipants: false }),
    );

    expect(result).toEqual({
      skipped: true,
      reason: 'disabled',
      participantsConsidered: 0,
      outcomes: [],
    });
    expect(prisma.trackedPlayer.findUnique).not.toHaveBeenCalled();
    expect(prisma.playerAccount.findUnique).not.toHaveBeenCalled();
  });

  it('skips unsupported queue without loading source tracked player', async () => {
    const prisma = {
      trackedPlayer: { findUnique: vi.fn() },
      playerAccount: { findUnique: vi.fn() },
    };

    const result = await expandFromCompletedMatch(
      prisma as never,
      {
        matchId: 'm1',
        queueId: 440,
        platformRoute: 'na1',
        regionalRoute: 'americas',
        requestedByPlayerAccountId: 'acc-1',
        participants: [],
      },
      config(),
    );

    expect(result.reason).toBe('unsupported_queue');
    expect(prisma.trackedPlayer.findUnique).not.toHaveBeenCalled();
  });
});
