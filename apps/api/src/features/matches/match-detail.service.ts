import { Inject, Injectable } from '@nestjs/common';
import { PublicMatchDetailSchema, ResourceNotFoundError, type PublicMatchDetail } from '@league-helper/shared';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { assertNoPuuidLeak } from '../players/player-response.mapper';
import { mapPublicMatchDetail } from './match-detail.mapper';
import { loadMatchStaticLookups } from './match-detail-static';

@Injectable()
export class MatchDetailService {
  constructor(
    @Inject(MatchRepository) private readonly matches: MatchRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChampionStaticRepository) private readonly staticRepo: ChampionStaticRepository,
    @Inject(DataDragonChampionService) private readonly dataDragon: DataDragonChampionService,
  ) {}

  async getMatch(matchId: string): Promise<PublicMatchDetail> {
    const row = await this.matches.findDetailById(matchId);
    if (!row) {
      throw new ResourceNotFoundError('Match not found.');
    }

    const lookups = await loadMatchStaticLookups(this.prisma, this.staticRepo, row.normalizedPatch);
    const championIds = new Set<number>();
    for (const participant of row.participants) {
      championIds.add(participant.championId);
    }
    for (const team of row.teams) {
      for (const ban of team.bans) {
        championIds.add(ban);
      }
    }

    const champions = new Map<number, DataDragonChampion>();
    await Promise.all(
      [...championIds].map(async (championId) => {
        const champion = await this.dataDragon.getChampionByNumericId(championId);
        if (champion) {
          champions.set(championId, champion);
        }
      }),
    );

    const response = mapPublicMatchDetail(row, {
      champions,
      lookups,
      icons: {
        itemIcon: (id, version) => this.dataDragon.buildItemIconUrl(id, version),
        runeIcon: (path) => this.dataDragon.buildRuneIconUrl(path),
        spellIcon: (imageFull, version) => this.dataDragon.buildSummonerSpellIconUrl(imageFull, version),
      },
    });
    assertNoPuuidLeak(response);
    return PublicMatchDetailSchema.parse(response);
  }
}
