import { Controller, Get, Inject, Param, ParseUUIDPipe, UseInterceptors } from '@nestjs/common';
import { CorrelationIdInterceptor } from '../../common/correlation-id.interceptor';
import { MatchDetailService } from './match-detail.service';

@Controller('api/matches')
@UseInterceptors(CorrelationIdInterceptor)
export class MatchesController {
  constructor(@Inject(MatchDetailService) private readonly matchDetail: MatchDetailService) {}

  @Get(':matchId')
  getMatch(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.matchDetail.getMatch(matchId);
  }
}
