import { Module } from '@nestjs/common';
import { RiotModule } from '../integrations/riot/riot.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [RiotModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
