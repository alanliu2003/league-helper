import { describe, expect, it } from 'vitest';
import type { GameDataProvider } from './provider';
import type { PlayerAccount } from './player';

describe('GameDataProvider interface compatibility', () => {
  it('accepts a structural mock implementation', async () => {
    const player: PlayerAccount = {
      provider: 'RIOT',
      externalAccountId: 'puuid-abc',
      riotId: { gameName: 'Example', tagLine: 'NA1' },
      platform: 'na1',
      regionalRoute: 'americas',
    };

    const provider: GameDataProvider = {
      async resolvePlayer() {
        return player;
      },
      async getRankedEntries() {
        return [];
      },
      async getRecentMatchIds() {
        return ['NA1_1'];
      },
      async getMatch() {
        return { meta: 'raw-match' };
      },
      async getTimeline() {
        return { meta: 'raw-timeline' };
      },
      async getChampionMastery() {
        return [];
      },
    };

    await expect(
      provider.resolvePlayer({ gameName: 'Example', tagLine: 'NA1', platform: 'na1' }),
    ).resolves.toEqual(player);
    await expect(provider.getRecentMatchIds(player, { count: 5 })).resolves.toEqual(['NA1_1']);
    await expect(provider.getMatch('NA1_1', 'americas')).resolves.toEqual({ meta: 'raw-match' });
  });
});
