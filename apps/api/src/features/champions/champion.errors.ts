import { HttpStatus } from '@nestjs/common';
import type { DomainErrorCode } from '@league-helper/shared';
import { parseRequest } from '../players/player.errors';

export { parseRequest };

/** Champion-specific codes already registered on DomainErrorCode / filter maps. */
export const CHAMPION_DOMAIN_HTTP_STATUS: Partial<Record<DomainErrorCode, number>> = {
  CHAMPION_NOT_FOUND: HttpStatus.NOT_FOUND,
  CHAMPION_STATS_POSITION_REQUIRED: HttpStatus.BAD_REQUEST,
  CHAMPION_STATS_INVALID_FILTER: HttpStatus.BAD_REQUEST,
};
