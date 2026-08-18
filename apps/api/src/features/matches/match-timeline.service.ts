import { Inject, Injectable } from '@nestjs/common';
import {
  PublicMatchTimelineDetailSchema,
  ResourceNotFoundError,
  type PublicMatchTimelineDetail,
} from '@league-helper/shared';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import type { DataDragonChampion } from '../../integrations/data-dragon/data-dragon.types';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { MatchRepository } from '../../persistence/match.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { assertNoPuuidLeak } from '../players/player-response.mapper';
import { loadMatchStaticLookups } from './match-detail-static';
import { mapPublicMatchTimelineDetail } from './match-timeline.mapper';

@Injectable()
export class MatchTimelineService {
  constructor(
    @Inject(MatchRepository) private readonly matches: MatchRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChampionStaticRepository) private readonly staticRepo: ChampionStaticRepository,
    @Inject(DataDragonChampionService) private readonly dataDragon: DataDragonChampionService,
  ) {}

  async getTimeline(matchId: string): Promise<PublicMatchTimelineDetail> {
    const row = await this.matches.findDetailById(matchId);
    if (!row) {
      throw new ResourceNotFoundError('Match not found.');
    }

    const [events, frames, meta] = await Promise.all([
      this.matches.findTimelineEventsByMatchId(matchId),
      this.matches.findTimelineFramesByMatchId(matchId),
      this.matches.findTimelineMetaByMatchId(matchId),
    ]);

    const lookups = await loadMatchStaticLookups(this.prisma, this.staticRepo, row.normalizedPatch);
    const championIds = new Set<number>();
    for (const participant of row.participants) {
      championIds.add(participant.championId);
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

    const response = mapPublicMatchTimelineDetail({
      row,
      events,
      frames,
      frameIntervalMs: meta?.frameIntervalMs ?? null,
      ctx: {
        champions,
        lookups,
        icons: {
          itemIcon: (id, version) => this.dataDragon.buildItemIconUrl(id, version),
          runeIcon: (path) => this.dataDragon.buildRuneIconUrl(path),
          spellIcon: (imageFull, version) => this.dataDragon.buildSummonerSpellIconUrl(imageFull, version),
        },
      },
    });
    assertNoPuuidLeak(response);
    return PublicMatchTimelineDetailSchema.parse(response);
  }
}
