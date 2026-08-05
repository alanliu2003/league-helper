import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { correlationIdMiddleware } from './common/correlation-id.middleware';
import { PlayersModule } from './features/players/players.module';
import { HealthModule } from './health/health.module';
import { RiotModule } from './integrations/riot/riot.module';
import { PersistenceModule } from './persistence/persistence.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueuesModule } from './queues/queues.module';

@Module({
  imports: [PrismaModule, PersistenceModule, RiotModule, QueuesModule, HealthModule, PlayersModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes('*');
  }
}
