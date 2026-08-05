import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHealthResponse, type HealthResponse } from '@league-helper/shared';
import { isRiotProviderConfigured, type RiotConfig } from '../integrations/riot/riot.config';
import { RIOT_CONFIG } from '../integrations/riot/riot.tokens';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RIOT_CONFIG) private readonly riotConfig: RiotConfig,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error: unknown) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'api',
        database: 'down',
        message: 'Database unavailable',
        cause: error instanceof Error ? error.message : 'unknown error',
      });
    }

    return createHealthResponse('api', {
      database: 'up',
      providerMode: this.riotConfig.providerMode,
      providerConfigured: isRiotProviderConfigured(this.riotConfig),
    });
  }
}
