import { Controller, Get, Inject } from '@nestjs/common';
import { HealthResponseSchema, type HealthResponse } from '@league-helper/shared';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    const response = await this.healthService.getHealth();
    return HealthResponseSchema.parse(response);
  }
}
