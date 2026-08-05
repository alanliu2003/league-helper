import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import {
  PlayerMasteryQuerySchema,
  PlayerMatchesQuerySchema,
  PlayerRefreshRequestSchema,
  PlayerRanksQuerySchema,
  PlayerSearchRequestSchema,
  type PlayerMasteryQuery,
  type PlayerMatchesQuery,
  type PlayerRanksQuery,
} from '@league-helper/shared';
import { CorrelationIdInterceptor } from '../../common/correlation-id.interceptor';
import type { RequestWithCorrelationId } from '../../common/correlation-id.middleware';
import { parseRequest } from './player.errors';
import { PlayerProfileService } from './player-profile.service';
import { PlayerRefreshService } from './player-refresh.service';
import { PlayerSearchService } from './player-search.service';

@Controller('api/players')
@UseInterceptors(CorrelationIdInterceptor)
export class PlayersController {
  constructor(
    @Inject(PlayerSearchService) private readonly searchService: PlayerSearchService,
    @Inject(PlayerProfileService) private readonly profileService: PlayerProfileService,
    @Inject(PlayerRefreshService) private readonly refreshService: PlayerRefreshService,
  ) {}

  @Post('search')
  search(@Body() body: unknown, @Req() req: RequestWithCorrelationId) {
    const request = parseRequest(PlayerSearchRequestSchema, body, 'search');
    return this.searchService.search(request, req.correlationId ?? 'unknown');
  }

  @Get(':playerId')
  getProfile(@Param('playerId', ParseUUIDPipe) playerId: string) {
    return this.profileService.getProfile(playerId);
  }

  @Get(':playerId/ranks')
  getRanks(@Param('playerId', ParseUUIDPipe) playerId: string, @Query() query: PlayerRanksQuery) {
    return this.profileService.getRanks(
      playerId,
      parseRequest(PlayerRanksQuerySchema, query, 'ranks query'),
    );
  }

  @Get(':playerId/mastery')
  getMastery(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Query() query: PlayerMasteryQuery,
  ) {
    return this.profileService.getMastery(
      playerId,
      parseRequest(PlayerMasteryQuerySchema, query, 'mastery query'),
    );
  }

  @Get(':playerId/matches')
  getMatches(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Query() query: PlayerMatchesQuery,
  ) {
    return this.profileService.getMatches(
      playerId,
      parseRequest(PlayerMatchesQuerySchema, query, 'matches query'),
    );
  }

  @Post(':playerId/refresh')
  refresh(
    @Param('playerId', ParseUUIDPipe) playerId: string,
    @Body() body: unknown,
    @Req() req: RequestWithCorrelationId,
  ) {
    const request = parseRequest(PlayerRefreshRequestSchema, body ?? {}, 'refresh');
    return this.refreshService.refresh(playerId, request, req.correlationId ?? 'unknown');
  }

  @Get(':playerId/refresh-status')
  getRefreshStatus(@Param('playerId', ParseUUIDPipe) playerId: string) {
    return this.profileService.getRefreshStatus(playerId);
  }
}
