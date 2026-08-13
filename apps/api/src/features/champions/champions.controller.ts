import { Controller, Get, Inject, Param, Query, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import {
  ChampionBuildsQuerySchema,
  ChampionStatsQuerySchema,
  type ChampionStatsQuery,
} from '@league-helper/shared';
import { CorrelationIdInterceptor } from '../../common/correlation-id.interceptor';
import { parseRequest } from './champion.errors';
import { ChampionBuildsService } from './champion-builds.service';
import { ChampionStaticService } from './champion-static.service';
import { ChampionStatsService } from './champion-stats.service';

const ChampionListQuerySchema = z.object({
  search: z.string().min(1).max(64).optional(),
  tag: z.string().min(1).max(32).optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(200),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

@Controller('api/champions')
@UseInterceptors(CorrelationIdInterceptor)
export class ChampionsController {
  constructor(
    @Inject(ChampionStaticService) private readonly staticService: ChampionStaticService,
    @Inject(ChampionStatsService) private readonly statsService: ChampionStatsService,
    @Inject(ChampionBuildsService) private readonly buildsService: ChampionBuildsService,
  ) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const parsed = parseRequest(ChampionListQuerySchema, query, 'champions list query');
    return this.staticService.list(parsed);
  }

  @Get(':championKey/builds')
  getBuilds(@Param('championKey') championKey: string, @Query() query: Record<string, unknown>) {
    const parsed = parseRequest(ChampionBuildsQuerySchema, query ?? {}, 'champion builds query');
    return this.buildsService.getBuilds(championKey, parsed);
  }

  @Get(':championKey/stats')
  getStats(@Param('championKey') championKey: string, @Query() query: ChampionStatsQuery) {
    const parsed = parseRequest(ChampionStatsQuerySchema, query ?? {}, 'champion stats query');
    return this.statsService.getChampionStats(championKey, parsed);
  }

  @Get(':championKey')
  getDetail(@Param('championKey') championKey: string) {
    return this.staticService.getByKey(championKey);
  }
}
