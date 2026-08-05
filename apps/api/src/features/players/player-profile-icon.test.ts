import { describe, expect, it } from 'vitest';
import type { PlayerAccount } from '@prisma/client';
import { mapPublicPlayer } from './player-response.mapper';

const account = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  provider: 'RIOT',
  externalAccountId: 'external-not-leaked',
  platformRoute: 'na1',
  regionalRoute: 'americas',
  currentGameName: 'Example',
  currentTagLine: 'NA1',
  summonerId: null,
  accountId: null,
  profileIconId: 5912,
  summonerLevel: 717,
  lastResolvedAt: new Date('2026-08-05T03:42:23.000Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
} as PlayerAccount;

describe('mapPublicPlayer profile icon', () => {
  it('includes Data Dragon profileIconUrl when provided', () => {
    const mapped = mapPublicPlayer(account, {
      profileIconUrl: 'https://ddragon.leagueoflegends.com/cdn/16.15.1/img/profileicon/5912.png',
    });
    expect(mapped.profileIconId).toBe(5912);
    expect(mapped.profileIconUrl).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.15.1/img/profileicon/5912.png',
    );
    expect(JSON.stringify(mapped)).not.toContain('externalAccountId');
  });

  it('allows null profileIconUrl when Data Dragon is unavailable', () => {
    const mapped = mapPublicPlayer(account, { profileIconUrl: null });
    expect(mapped.profileIconId).toBe(5912);
    expect(mapped.profileIconUrl).toBeNull();
  });
});
