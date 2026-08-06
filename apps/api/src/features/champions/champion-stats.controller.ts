import { Controller, Get, Inject, Query, UseInterceptors } from '@nestjs/common';
import {
  ChampionStatsTableQuerySchema,
  type ChampionStatsTableQuery,
} from '@league-helper/shared';
import { CorrelationIdInterceptor } from '../../common/correlation-id.interceptor';
import { parseRequest } from './champion.errors';
import { assertTablePositionPresent } from './champion-stats-filters';
import { ChampionStatsService } from './champion-stats.service';

@Controller('api/champion-stats')
@UseInterceptors(CorrelationIdInterceptor)
export class ChampionStatsController {
  constructor(@Inject(ChampionStatsService) private readonly statsService: ChampionStatsService) {}

  @Get('filters')
  getFilters() {
    return this.statsService.getFilters();
  }

  @Get()
  getTable(@Query() query: ChampionStatsTableQuery) {
    assertTablePositionPresent((query ?? {}) as Record<string, unknown>);
    const parsed = parseRequest(
      ChampionStatsTableQuerySchema,
      query ?? {},
      'champion stats table query',
    );
    return this.statsService.getTable(parsed);
  }
}
