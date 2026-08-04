import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { RiotModule } from './integrations/riot/riot.module';
import { PersistenceModule } from './persistence/persistence.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, PersistenceModule, RiotModule, HealthModule],
})
export class AppModule {}
