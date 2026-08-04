import type { ChampionMastery } from './mastery';
import type { PlayerAccount } from './player';
import type { RankedEntry } from './player';
import type { PlatformRoute, RegionalRoute } from './routing';

/**
 * Framework-independent game data provider contract.
 * Implementations live in backend packages; this milestone only defines the interface.
 */
export interface GameDataProvider {
  resolvePlayer(input: {
    gameName: string;
    tagLine: string;
    platform: PlatformRoute;
  }): Promise<PlayerAccount>;

  getRankedEntries(player: PlayerAccount): Promise<RankedEntry[]>;

  getRecentMatchIds(
    player: PlayerAccount,
    options: {
      queue?: number;
      start?: number;
      count?: number;
    },
  ): Promise<string[]>;

  getMatch(matchId: string, regionalRoute: RegionalRoute): Promise<unknown>;

  getTimeline(matchId: string, regionalRoute: RegionalRoute): Promise<unknown>;

  getChampionMastery(player: PlayerAccount): Promise<ChampionMastery[]>;
}
