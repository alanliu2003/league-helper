import { Inject, Injectable } from '@nestjs/common';
import {
  ChampionDetailResponseSchema,
  ChampionListResponseSchema,
  ChampionNotFoundError,
  type ChampionDetailResponse,
  type ChampionListResponse,
} from '@league-helper/shared';
import { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';
import { ChampionStaticRepository } from '../../persistence/champion-static.repository';
import { mapChampionDetail, mapChampionSummary } from './champion-stats.mapper';

const NUMERIC_CHAMPION_KEY = /^\d+$/;

export type ListChampionsInput = {
  search?: string;
  tag?: string;
  limit?: number;
  offset?: number;
};

@Injectable()
export class ChampionStaticService {
  constructor(
    @Inject(ChampionStaticRepository) private readonly champions: ChampionStaticRepository,
    @Inject(DataDragonChampionService) private readonly media: DataDragonChampionService,
  ) {}

  async list(input: ListChampionsInput = {}): Promise<ChampionListResponse> {
    const limit = input.limit ?? 200;
    const offset = input.offset ?? 0;
    const { rows, patch } = await this.champions.listChampions({
      search: input.search,
      tag: input.tag,
      limit,
      offset,
    });

    return ChampionListResponseSchema.parse({
      champions: rows.map((row) => mapChampionSummary(row, this.media)),
      ...(patch
        ? {
            staticDataPatch: patch.version,
            ...(patch.dataDragonVersion
              ? { staticDataVersion: patch.dataDragonVersion }
              : {}),
          }
        : {}),
    });
  }

  async getByKey(championKey: string): Promise<ChampionDetailResponse> {
    const row = await this.requireByKey(championKey);
    const detail = mapChampionDetail(row, this.media, { requestedKey: championKey.trim() });

    return ChampionDetailResponseSchema.parse({
      champion: detail,
      staticDataPatch: row.patchVersion,
      ...(row.dataDragonVersion ? { staticDataVersion: row.dataDragonVersion } : {}),
    });
  }

  /**
   * Resolves a champion by key. Rejects numeric-only keys (M8: never treat as championId).
   * Case-insensitive unique match returns the canonical DB key via mapChampionDetail.
   */
  async requireByKey(championKey: string) {
    const key = championKey.trim();
    if (!key || NUMERIC_CHAMPION_KEY.test(key)) {
      throw new ChampionNotFoundError('Champion was not found.', { championKey: key || null });
    }

    const row = await this.champions.findByChampionKey(key);
    if (!row) {
      throw new ChampionNotFoundError('Champion was not found.', { championKey: key });
    }
    return row;
  }
}
