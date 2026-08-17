import { Module } from '@nestjs/common';
import { DataDragonModule } from '../../integrations/data-dragon/data-dragon.module';
import { PersistenceModule } from '../../persistence/persistence.module';
import { MatchDetailService } from './match-detail.service';
import { MatchesController } from './matches.controller';

@Module({
  imports: [PersistenceModule, DataDragonModule],
  controllers: [MatchesController],
  providers: [MatchDetailService],
})
export class MatchesModule {}
