import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChampionAggregateReadRepository } from './champion-aggregate-read.repository';
import { ChampionStaticRepository } from './champion-static.repository';
import { IngestionJobRepository } from './ingestion-job.repository';
import { MasterySnapshotRepository } from './mastery-snapshot.repository';
import { MatchRepository } from './match.repository';
import { PlayerAccountRepository } from './player-account.repository';
import { RankSnapshotRepository } from './rank-snapshot.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    PlayerAccountRepository,
    RankSnapshotRepository,
    MatchRepository,
    MasterySnapshotRepository,
    IngestionJobRepository,
    ChampionStaticRepository,
    ChampionAggregateReadRepository,
  ],
  exports: [
    PlayerAccountRepository,
    RankSnapshotRepository,
    MatchRepository,
    MasterySnapshotRepository,
    IngestionJobRepository,
    ChampionStaticRepository,
    ChampionAggregateReadRepository,
  ],
})
export class PersistenceModule {}
