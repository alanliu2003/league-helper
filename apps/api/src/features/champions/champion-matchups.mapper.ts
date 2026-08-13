import {
  combineMatchupAccumulators,
  deriveMatchupMetrics,
  emptyMatchupAccumulator,
  type MatchupAggregateAccumulator,
} from '@league-helper/match-analytics';
import {
  ChampionMatchupRowSchema,
  type ChampionMatchupRow,
  type ChampionRankingPosition,
} from '@league-helper/shared';
import type { MatchupAggregate } from '@prisma/client';
import type { ChampionStaticRow } from '../../persistence/champion-static.repository';
import type { DataDragonChampionService } from '../../integrations/data-dragon/data-dragon-champion.service';

export function matchupRowToAccumulator(row: MatchupAggregate): MatchupAggregateAccumulator {
  return {
    sampleSize: row.sampleSize,
    wins: row.wins,
    totalGoldDifferenceAt10: row.totalGoldDifferenceAt10,
    goldDifferenceAt10Samples: row.goldDifferenceAt10Samples,
    totalGoldDifferenceAt15: row.totalGoldDifferenceAt15,
    goldDifferenceAt15Samples: row.goldDifferenceAt15Samples,
    totalCsDifferenceAt10: row.totalCsDifferenceAt10,
    csDifferenceAt10Samples: row.csDifferenceAt10Samples,
    totalCsDifferenceAt15: row.totalCsDifferenceAt15,
    csDifferenceAt15Samples: row.csDifferenceAt15Samples,
    latestEligibleMatchAt: row.latestEligibleMatchAt,
  };
}

export function mergeMatchupRowsByOpponent(rows: MatchupAggregate[]): MatchupAggregate[] {
  const grouped = new Map<number, MatchupAggregateAccumulator>();
  const templates = new Map<number, MatchupAggregate>();
  for (const row of rows) {
    const current = grouped.get(row.opponentChampionId) ?? emptyMatchupAccumulator();
    grouped.set(row.opponentChampionId, combineMatchupAccumulators(current, matchupRowToAccumulator(row)));
    templates.set(row.opponentChampionId, row);
  }
  return [...grouped.entries()].map(([opponentChampionId, accumulator]) => {
    const template = templates.get(opponentChampionId)!;
    return {
      ...template,
      opponentChampionId,
      sampleSize: accumulator.sampleSize,
      wins: accumulator.wins,
      totalGoldDifferenceAt10: accumulator.totalGoldDifferenceAt10,
      goldDifferenceAt10Samples: accumulator.goldDifferenceAt10Samples,
      totalGoldDifferenceAt15: accumulator.totalGoldDifferenceAt15,
      goldDifferenceAt15Samples: accumulator.goldDifferenceAt15Samples,
      totalCsDifferenceAt10: accumulator.totalCsDifferenceAt10,
      csDifferenceAt10Samples: accumulator.csDifferenceAt10Samples,
      totalCsDifferenceAt15: accumulator.totalCsDifferenceAt15,
      csDifferenceAt15Samples: accumulator.csDifferenceAt15Samples,
      latestEligibleMatchAt: accumulator.latestEligibleMatchAt,
    };
  });
}

export function mapMatchupRow(
  row: MatchupAggregate,
  opponent: ChampionStaticRow,
  media: DataDragonChampionService,
  options: { confidenceLevel: number; displayFloor: number },
): ChampionMatchupRow {
  const derived = deriveMatchupMetrics(matchupRowToAccumulator(row), {
    confidenceLevel: options.confidenceLevel,
  });
  const version = opponent.dataDragonVersion?.trim() || null;
  return ChampionMatchupRowSchema.parse({
    opponent: {
      championId: opponent.championId,
      championKey: opponent.championKey,
      name: opponent.name,
      iconUrl: version ? media.buildChampionIconUrl(opponent.championKey, version) : null,
    },
    position: row.teamPosition as ChampionRankingPosition,
    sampleSize: derived.sampleSize,
    wins: derived.wins,
    losses: derived.losses,
    winRate: derived.winRate,
    wilsonInterval: derived.wilsonInterval,
    sampleConfidence: derived.sampleConfidence,
    lowSample: derived.sampleConfidence === 'LOW',
    averageGoldDifferenceAt10: derived.averageGoldDifferenceAt10,
    averageGoldDifferenceAt15: derived.averageGoldDifferenceAt15,
    averageCsDifferenceAt10: derived.averageCsDifferenceAt10,
    averageCsDifferenceAt15: derived.averageCsDifferenceAt15,
  });
}
