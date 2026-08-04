import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHealthResponse, type HealthResponse } from '@league-helper/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

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

    return createHealthResponse('api', { database: 'up' });
  }
}
