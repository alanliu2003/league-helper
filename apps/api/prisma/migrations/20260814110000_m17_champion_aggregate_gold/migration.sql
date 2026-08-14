-- M17 champion aggregate gold totals for GPM. Aggregation version 2.

ALTER TABLE "ChampionAggregate" ADD COLUMN "totalGoldEarned" INTEGER NOT NULL DEFAULT 0;
