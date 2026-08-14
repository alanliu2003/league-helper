import type {
  ChampionAbilitySummary,
  ChampionAggregateMetrics,
  ChampionBootRow,
  ChampionBuildRowMetrics,
  ChampionCoreBuild,
  ChampionExactStats,
  ChampionMatchupRow,
  ChampionRuneSetup,
  ChampionSkillOrderRow,
  ChampionSpellPair,
  ChampionStartingItemSet,
} from '@league-helper/shared';
import { buildEvidenceCatalog, listEvidenceIds } from './evidence';
import type {
  ChampionInsightAbility,
  ChampionInsightBuildRow,
  ChampionInsightContext,
  ChampionInsightContextInput,
  ChampionInsightMatchupRow,
  ChampionInsightPerformance,
} from './types';

export type {
  ChampionInsightContext,
  ChampionInsightContextInput,
  ChampionInsightEvidenceEntry,
} from './types';
export { listEvidenceIds };

const ABILITY_DESCRIPTION_MAX = 400;
const MAX_CORE_BUILDS = 2;
const MAX_SINGLE_BUILD_ROWS = 1;
const MAX_MATCHUPS_PER_SIDE = 3;

function isExactStats(
  stats: ChampionExactStats | ChampionAggregateMetrics,
): stats is ChampionExactStats {
  return 'metrics' in stats && 'dimensions' in stats;
}

function extractMetrics(
  stats: ChampionInsightContextInput['stats'],
): ChampionAggregateMetrics | null {
  if (stats == null) {
    return null;
  }
  if (isExactStats(stats)) {
    return stats.metrics;
  }
  return stats;
}

function assignNonNull<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
}

function buildPerformance(metrics: ChampionAggregateMetrics | null): ChampionInsightPerformance {
  if (metrics == null) {
    return { interpretationAllowed: false };
  }

  const performance: ChampionInsightPerformance = {
    sampleSize: metrics.sampleSize,
    wins: metrics.wins,
    winRate: metrics.winRate,
    sampleConfidence: metrics.sampleConfidence,
    interpretationAllowed: metrics.sampleConfidence !== 'INSUFFICIENT',
  };

  if (metrics.wilsonInterval) {
    performance.wilsonInterval = metrics.wilsonInterval;
  }
  assignNonNull(performance, 'aggregateKdaRatio', metrics.aggregateKdaRatio);
  assignNonNull(performance, 'averageCsPerMinute', metrics.averageCsPerMinute);
  assignNonNull(performance, 'averageDamagePerMinute', metrics.averageDamagePerMinute);
  assignNonNull(performance, 'averageVisionScorePerMinute', metrics.averageVisionScorePerMinute);
  assignNonNull(performance, 'averageGoldDifferenceAt10', metrics.averageGoldDifferenceAt10);
  assignNonNull(performance, 'averageGoldDifferenceAt15', metrics.averageGoldDifferenceAt15);
  assignNonNull(performance, 'averageCsDifferenceAt10', metrics.averageCsDifferenceAt10);
  assignNonNull(performance, 'averageCsDifferenceAt15', metrics.averageCsDifferenceAt15);

  return performance;
}

function isDisplayableBuild<T extends { sampleBand: string }>(row: T): boolean {
  return row.sampleBand !== 'BELOW_DISPLAY';
}

function isBuildInterpretationAllowed(row: Pick<ChampionBuildRowMetrics, 'sampleBand' | 'lowSample'>): boolean {
  return (row.sampleBand === 'CREDIBLE' || row.sampleBand === 'STRONG') && !row.lowSample;
}

function joinNames(names: string[]): string {
  return names.join(' / ');
}

function toBuildRow(name: string, row: ChampionBuildRowMetrics): ChampionInsightBuildRow {
  return {
    name,
    sampleSize: row.sampleSize,
    pickRate: row.pickRate,
    winRate: row.winRate,
    sampleBand: row.sampleBand,
    interpretationAllowed: isBuildInterpretationAllowed(row),
  };
}

function takeDisplayable<T extends { sampleBand: string }>(rows: T[], limit: number): T[] {
  return rows.filter(isDisplayableBuild).slice(0, limit);
}

function runeName(row: ChampionRuneSetup): string {
  const styles = [row.primaryStyleName, row.secondaryStyleName].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (row.keystone?.name && styles.length > 0) {
    return `${row.keystone.name} (${styles.join(' / ')})`;
  }
  if (row.keystone?.name) {
    return row.keystone.name;
  }
  if (styles.length > 0) {
    return styles.join(' / ');
  }
  return 'Rune page';
}

function toMatchupRow(row: ChampionMatchupRow): ChampionInsightMatchupRow {
  const mapped: ChampionInsightMatchupRow = {
    opponentChampionKey: row.opponent.championKey,
    opponentName: row.opponent.name,
    sampleSize: row.sampleSize,
    wins: row.wins,
    losses: row.losses,
    winRate: row.winRate,
    lowSample: row.lowSample,
    sampleConfidence: row.sampleConfidence,
    interpretationAllowed: !row.lowSample,
  };
  assignNonNull(mapped, 'averageGoldDifferenceAt10', row.averageGoldDifferenceAt10);
  assignNonNull(mapped, 'averageGoldDifferenceAt15', row.averageGoldDifferenceAt15);
  assignNonNull(mapped, 'averageCsDifferenceAt10', row.averageCsDifferenceAt10);
  assignNonNull(mapped, 'averageCsDifferenceAt15', row.averageCsDifferenceAt15);
  return mapped;
}

function toAbility(championKey: string, ability: ChampionAbilitySummary): ChampionInsightAbility {
  const mapped: ChampionInsightAbility = {
    championKey,
    slot: ability.slot,
    name: ability.name,
    description: ability.description.slice(0, ABILITY_DESCRIPTION_MAX),
  };
  if (ability.cooldown) {
    mapped.cooldown = ability.cooldown;
  }
  if (ability.cost) {
    mapped.cost = ability.cost;
  }
  if (ability.range) {
    mapped.range = ability.range;
  }
  return mapped;
}

export function buildChampionInsightContext(
  input: ChampionInsightContextInput,
): ChampionInsightContext {
  const metrics = extractMetrics(input.stats);
  const performance = buildPerformance(metrics);

  const coreBuilds = takeDisplayable(input.builds.coreBuilds, MAX_CORE_BUILDS).map((row: ChampionCoreBuild) =>
    toBuildRow(joinNames(row.items.map((item) => item.name)), row),
  );
  const startingItems = takeDisplayable(input.builds.startingItems, MAX_SINGLE_BUILD_ROWS).map(
    (row: ChampionStartingItemSet) => toBuildRow(joinNames(row.items.map((item) => item.name)), row),
  );
  const boots = takeDisplayable(input.builds.boots, MAX_SINGLE_BUILD_ROWS).map((row: ChampionBootRow) =>
    toBuildRow(row.item.name, row),
  );
  const runes = takeDisplayable(input.builds.runes, MAX_SINGLE_BUILD_ROWS).map((row: ChampionRuneSetup) =>
    toBuildRow(runeName(row), row),
  );
  const summonerSpells = takeDisplayable(input.builds.summonerSpells, MAX_SINGLE_BUILD_ROWS).map(
    (row: ChampionSpellPair) => toBuildRow(joinNames(row.spells.map((spell) => spell.name)), row),
  );
  const skillOrder = takeDisplayable(input.builds.skillOrder, MAX_SINGLE_BUILD_ROWS).map(
    (row: ChampionSkillOrderRow) => toBuildRow(joinNames(row.maxOrder), row),
  );

  const builds = {
    coreBuilds,
    startingItems,
    boots,
    runes,
    summonerSpells,
    skillOrder,
  };

  const strongAgainst = input.matchups.strongAgainst.slice(0, MAX_MATCHUPS_PER_SIDE).map(toMatchupRow);
  const weakAgainst = input.matchups.weakAgainst.slice(0, MAX_MATCHUPS_PER_SIDE).map(toMatchupRow);
  const matchups = { strongAgainst, weakAgainst };

  const abilities = input.abilities.map((ability) => toAbility(input.champion.championKey, ability));
  const selectedMatchupKeys = new Set([
    ...strongAgainst.map((row) => row.opponentChampionKey),
    ...weakAgainst.map((row) => row.opponentChampionKey),
  ]);
  const opponentAbilities = (input.opponentAbilities ?? [])
    .filter((group) => selectedMatchupKeys.has(group.championKey))
    .map((group) => ({
      championKey: group.championKey,
      abilities: group.abilities.map((ability) => toAbility(group.championKey, ability)),
    }));

  const performanceConclusionsAllowed = performance.interpretationAllowed;
  const buildInsightAllowed = [
    ...coreBuilds,
    ...startingItems,
    ...boots,
    ...runes,
    ...summonerSpells,
    ...skillOrder,
  ].some((row) => row.interpretationAllowed);
  const matchupExplanationsAllowed = [...strongAgainst, ...weakAgainst].some(
    (row) => row.interpretationAllowed,
  );
  const generationEligible =
    performanceConclusionsAllowed || buildInsightAllowed || matchupExplanationsAllowed;

  const evidenceCatalog = buildEvidenceCatalog({
    performance,
    hasPerformanceMetrics: metrics != null,
    builds,
    matchups,
    abilities,
    opponentAbilities,
  });

  return {
    champion: {
      championId: input.champion.championId,
      championKey: input.champion.championKey,
      name: input.champion.name,
      position: input.champion.position,
    },
    scope: {
      patch: input.scope.patch,
      platform: input.scope.platform,
      queueId: input.scope.queueId,
      tier: input.scope.tier,
      kind: input.scope.kind ?? 'COLLECTED_SAMPLE',
    },
    performance,
    builds,
    matchups,
    abilities,
    opponentAbilities,
    generationEligible,
    performanceConclusionsAllowed,
    buildInsightAllowed,
    matchupExplanationsAllowed,
    evidenceCatalog,
  };
}
