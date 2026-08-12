import { describe, expect, it, vi } from 'vitest';
import {
  ProviderForbiddenError,
  ProviderRateLimitedError,
  ProviderUnauthorizedError,
  ProviderUnavailableError,
  type RankedEntry,
} from '@league-helper/shared';
import { resolveParticipantRankViaLeagueV4 } from './participant-rank-resolver.js';

const baseInput = {
  platformRoute: 'na1',
  externalAccountId: 'puuid-abc',
  queueType: 'RANKED_SOLO_5x5' as const,
};

function rankedEntry(overrides: Partial<RankedEntry> = {}): RankedEntry {
  return {
    provider: 'RIOT',
    externalAccountId: 'puuid-abc',
    platform: 'na1',
    queueType: 'RANKED_SOLO_5x5',
    tier: 'DIAMOND',
    division: 'II',
    leaguePoints: 50,
    wins: 10,
    losses: 10,
    ...overrides,
  };
}

describe('resolveParticipantRankViaLeagueV4', () => {
  it('maps applicable ranked entry to RESOLVED_RANKED', async () => {
    const getRankedEntries = vi.fn().mockResolvedValue([rankedEntry()]);
    const outcome = await resolveParticipantRankViaLeagueV4(
      {
        provider: { getRankedEntries },
        sharedCooldown: null,
        riotShared429CooldownMinMs: 900_000,
      },
      baseInput,
    );
    expect(outcome.resolutionStatus).toBe('RESOLVED_RANKED');
    expect(outcome.observedTier).toBe('DIAMOND');
    expect(outcome.observedDivision).toBe('II');
    expect(outcome.riotCalled).toBe(true);
  });

  it('maps successful empty applicable entry to RESOLVED_UNRANKED', async () => {
    const getRankedEntries = vi
      .fn()
      .mockResolvedValue([rankedEntry({ queueType: 'RANKED_FLEX_SR' })]);
    const outcome = await resolveParticipantRankViaLeagueV4(
      {
        provider: { getRankedEntries },
        sharedCooldown: null,
        riotShared429CooldownMinMs: 900_000,
      },
      baseInput,
    );
    expect(outcome.resolutionStatus).toBe('RESOLVED_UNRANKED');
    expect(outcome.observedTier).toBeNull();
    expect(outcome.riotCalled).toBe(true);
  });

  it('maps 429 to FAILED_RETRYABLE and publishes shared cooldown', async () => {
    const rateLimited = new ProviderRateLimitedError('rate limited', {
      retryAfterSeconds: 12,
    });
    const getRankedEntries = vi.fn().mockRejectedValue(rateLimited);
    const extendCooldown = vi.fn().mockResolvedValue({
      cooldownUntil: Date.now() + 12_000,
      extended: true,
      previousCooldownUntil: null,
    });
    const outcome = await resolveParticipantRankViaLeagueV4(
      {
        provider: { getRankedEntries },
        sharedCooldown: {
          remainingMs: async () => 0,
          extendCooldown,
        },
        riotShared429CooldownMinMs: 900_000,
      },
      baseInput,
    );
    expect(outcome.resolutionStatus).toBe('FAILED_RETRYABLE');
    expect(outcome.providerResultCode).toBe('HTTP_429');
    expect(outcome.retryable).toBe(true);
    expect(extendCooldown).toHaveBeenCalledOnce();
  });

  it('maps 5xx / unavailable to FAILED_RETRYABLE', async () => {
    const getRankedEntries = vi
      .fn()
      .mockRejectedValue(new ProviderUnavailableError('upstream 503'));
    const outcome = await resolveParticipantRankViaLeagueV4(
      {
        provider: { getRankedEntries },
        sharedCooldown: null,
        riotShared429CooldownMinMs: 900_000,
      },
      baseInput,
    );
    expect(outcome.resolutionStatus).toBe('FAILED_RETRYABLE');
    expect(outcome.providerResultCode).toBe('HTTP_5XX_OR_NETWORK');
    expect(outcome.retryable).toBe(true);
  });

  it('maps 401/403 to fail-closed (no retry storm)', async () => {
    for (const error of [
      new ProviderUnauthorizedError('401'),
      new ProviderForbiddenError('403'),
    ]) {
      const getRankedEntries = vi.fn().mockRejectedValue(error);
      const outcome = await resolveParticipantRankViaLeagueV4(
        {
          provider: { getRankedEntries },
          sharedCooldown: null,
          riotShared429CooldownMinMs: 900_000,
        },
        baseInput,
      );
      expect(outcome.failClosed).toBe(true);
      expect(outcome.retryable).toBe(false);
      expect(outcome.resolutionStatus).toBe('FAILED_RETRYABLE');
    }
  });

  it('maps missing PUUID to FAILED_PERMANENT without Riot call', async () => {
    const getRankedEntries = vi.fn();
    const outcome = await resolveParticipantRankViaLeagueV4(
      {
        provider: { getRankedEntries },
        sharedCooldown: null,
        riotShared429CooldownMinMs: 900_000,
      },
      { ...baseInput, externalAccountId: '   ' },
    );
    expect(outcome.resolutionStatus).toBe('FAILED_PERMANENT');
    expect(outcome.providerResultCode).toBe('MISSING_PUUID');
    expect(outcome.riotCalled).toBe(false);
    expect(getRankedEntries).not.toHaveBeenCalled();
  });

  it('active shared cooldown prevents Riot call and stays retryable', async () => {
    const getRankedEntries = vi.fn();
    const outcome = await resolveParticipantRankViaLeagueV4(
      {
        provider: { getRankedEntries },
        sharedCooldown: {
          remainingMs: async () => 60_000,
          extendCooldown: vi.fn(),
        },
        riotShared429CooldownMinMs: 900_000,
      },
      baseInput,
    );
    expect(outcome.riotCalled).toBe(false);
    expect(outcome.resolutionStatus).toBe('FAILED_RETRYABLE');
    expect(outcome.providerResultCode).toBe('SHARED_COOLDOWN_ACTIVE');
    expect(outcome.retryable).toBe(true);
    expect(getRankedEntries).not.toHaveBeenCalled();
  });
});
