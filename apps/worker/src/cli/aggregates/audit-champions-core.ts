import type { PrismaClient } from '@prisma/client';
import {
  ALL_PLATFORM_ROUTE_SENTINEL,
  ALL_POSITION_SENTINEL,
  ALL_QUEUE_ID_SENTINEL,
  ALL_RANK_TIER_SENTINEL,
  ALL_REGIONAL_ROUTE_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
  deriveChampionAggregateMetrics,
  type ChampionAggregateAccumulator,
} from '@league-helper/match-analytics';
import { NormalizedPositionSchema } from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { EXIT_COMMAND_FAILURE, EXIT_INTEGRITY_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

export type AuditChampionsInput = {
  prisma: PrismaClient;
  config: ChampionAggregationWorkerConfig;
  /** When set, only audit this aggregationVersion (still reports cross-version key isolation). */
  aggregationVersion?: string;
};

export type IntegrityFinding = {
  code: string;
  aggregateId: string;
  detail: string;
};

export type AuditChampionsReport = {
  ok: boolean;
  passed: boolean;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  rowsScanned: number;
  findings: IntegrityFinding[];
  findingCounts: Record<string, number>;
  invalidLatestEligibleMatchAtCount: number;
  error?: string;
};

export type AuditChampionsResult = {
  exitCode: number;
  report: AuditChampionsReport;
};

const ALLOWED_POSITIONS = new Set<string>([
  ...NormalizedPositionSchema.options,
  ALL_POSITION_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
]);

const RAW_PROVIDER_ROLES = new Set([
  'UTILITY',
  'NONE',
  'INVALID',
  'DUO',
  'DUO_CARRY',
  'DUO_SUPPORT',
  'SOLO',
  'MID',
  'BOT',
]);

function toAccumulator(row: {
  sampleSize: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCs: number;
  totalGameSeconds: number;
  totalDamageToChampions: number;
  totalVisionScore: number;
  totalGoldDifferenceAt10: number | null;
  goldDifferenceAt10Samples: number;
  totalGoldDifferenceAt15: number | null;
  goldDifferenceAt15Samples: number;
  totalCsDifferenceAt10: number | null;
  csDifferenceAt10Samples: number;
  totalCsDifferenceAt15: number | null;
  csDifferenceAt15Samples: number;
  latestEligibleMatchAt: Date | null;
}): ChampionAggregateAccumulator {
  return {
    sampleSize: row.sampleSize,
    wins: row.wins,
    totalKills: row.totalKills,
    totalDeaths: row.totalDeaths,
    totalAssists: row.totalAssists,
    totalCs: row.totalCs,
    totalGameSeconds: row.totalGameSeconds,
    totalDamageToChampions: row.totalDamageToChampions,
    totalVisionScore: row.totalVisionScore,
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

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

export type AggregateIntegrityRow = {
  id: string;
  patch: string;
  platformRoute: string;
  regionalRoute: string;
  queueId: number;
  rankTier: string;
  teamPosition: string;
  championId: number;
  sampleSize: number;
  wins: number;
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
  totalCs: number;
  totalGameSeconds: number;
  totalDamageToChampions: number;
  totalVisionScore: number;
  totalGoldDifferenceAt10: number | null;
  goldDifferenceAt10Samples: number;
  totalGoldDifferenceAt15: number | null;
  goldDifferenceAt15Samples: number;
  totalCsDifferenceAt10: number | null;
  csDifferenceAt10Samples: number;
  totalCsDifferenceAt15: number | null;
  csDifferenceAt15Samples: number;
  latestEligibleMatchAt: Date | null;
  calculatedAt: Date;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
};

/** Pure row checks — exported for unit tests (DB may reject some invalid inserts). */
export function collectFindingsForAggregateRow(
  row: AggregateIntegrityRow,
  options: { confidenceLevel: number; seenKeys: Set<string> },
): { findings: IntegrityFinding[]; invalidLatestEligibleMatchAt: boolean } {
  const findings: IntegrityFinding[] = [];
  const push = (code: string, detail: string) => {
    findings.push({ code, aggregateId: row.id, detail });
  };

  if (row.wins > row.sampleSize) {
    push('WINS_EXCEED_SAMPLE', `wins=${row.wins} sampleSize=${row.sampleSize}`);
  }

  const nonNegFields: Array<[string, number]> = [
    ['sampleSize', row.sampleSize],
    ['wins', row.wins],
    ['totalKills', row.totalKills],
    ['totalDeaths', row.totalDeaths],
    ['totalAssists', row.totalAssists],
    ['totalCs', row.totalCs],
    ['totalGameSeconds', row.totalGameSeconds],
    ['totalDamageToChampions', row.totalDamageToChampions],
    ['totalVisionScore', row.totalVisionScore],
    ['goldDifferenceAt10Samples', row.goldDifferenceAt10Samples],
    ['goldDifferenceAt15Samples', row.goldDifferenceAt15Samples],
    ['csDifferenceAt10Samples', row.csDifferenceAt10Samples],
    ['csDifferenceAt15Samples', row.csDifferenceAt15Samples],
  ];
  for (const [name, value] of nonNegFields) {
    if (!Number.isInteger(value) || value < 0) {
      push('NEGATIVE_OR_INVALID_COUNTER', `${name}=${value}`);
    }
  }

  const timelinePairs: Array<[string, number, number | null]> = [
    ['gold10', row.goldDifferenceAt10Samples, row.totalGoldDifferenceAt10],
    ['gold15', row.goldDifferenceAt15Samples, row.totalGoldDifferenceAt15],
    ['cs10', row.csDifferenceAt10Samples, row.totalCsDifferenceAt10],
    ['cs15', row.csDifferenceAt15Samples, row.totalCsDifferenceAt15],
  ];
  for (const [name, samples, total] of timelinePairs) {
    if (samples === 0 && total !== null) {
      push('TIMELINE_TOTAL_SHOULD_BE_NULL', `${name} samples=0 total=${total}`);
    }
    if (samples > 0 && total === null) {
      push('TIMELINE_TOTAL_MISSING', `${name} samples=${samples} total=null`);
    }
    // zero total with positive samples is valid — no finding
  }

  if (RAW_PROVIDER_ROLES.has(row.teamPosition) || !ALLOWED_POSITIONS.has(row.teamPosition)) {
    push('RAW_OR_FORBIDDEN_POSITION', `teamPosition=${row.teamPosition}`);
  }

  if (row.platformRoute === ALL_PLATFORM_ROUTE_SENTINEL) {
    push('FORBIDDEN_ALL_PLATFORM', 'platformRoute is ALL sentinel');
  }
  if (row.regionalRoute === ALL_REGIONAL_ROUTE_SENTINEL) {
    push('FORBIDDEN_ALL_REGION', 'regionalRoute is ALL sentinel');
  }
  if (row.queueId === ALL_QUEUE_ID_SENTINEL) {
    push('FORBIDDEN_ALL_QUEUE', 'queueId is ALL sentinel');
  }
  if (row.rankTier === ALL_RANK_TIER_SENTINEL && row.teamPosition === ALL_POSITION_SENTINEL) {
    push('FORBIDDEN_ALL_TIER_AND_POSITION', 'ALL tier + ALL position');
  }

  const logicalKey = JSON.stringify([
    row.patch,
    row.platformRoute,
    row.regionalRoute,
    row.queueId,
    row.rankTier,
    row.teamPosition,
    row.championId,
    row.sourceNormalizationVersion,
    row.aggregationVersion,
  ]);
  if (options.seenKeys.has(logicalKey)) {
    push('DUPLICATE_LOGICAL_KEY', logicalKey);
  }
  options.seenKeys.add(logicalKey);

  if (!(row.calculatedAt instanceof Date) || !Number.isFinite(row.calculatedAt.getTime())) {
    push('INVALID_CALCULATED_AT', 'calculatedAt invalid');
  }

  let invalidLatestEligibleMatchAt = false;
  if (
    row.latestEligibleMatchAt !== null &&
    (!(row.latestEligibleMatchAt instanceof Date) ||
      !Number.isFinite(row.latestEligibleMatchAt.getTime()))
  ) {
    invalidLatestEligibleMatchAt = true;
    push('INVALID_LATEST_ELIGIBLE_MATCH_AT', 'latestEligibleMatchAt invalid');
  }
  // Do NOT enforce latestEligibleMatchAt <= calculatedAt

  try {
    const derived = deriveChampionAggregateMetrics(toAccumulator(row), {
      confidenceLevel: options.confidenceLevel,
    });
    const numericValues = [
      derived.winRate,
      derived.aggregateKdaRatio,
      derived.averageCsPerMinute,
      derived.averageDamagePerMinute,
      derived.averageVisionScorePerMinute,
      derived.averageGoldDifferenceAt10,
      derived.averageGoldDifferenceAt15,
      derived.averageCsDifferenceAt10,
      derived.averageCsDifferenceAt15,
      derived.wilsonInterval?.lowerBound ?? null,
      derived.wilsonInterval?.upperBound ?? null,
    ];
    for (const value of numericValues) {
      if (value !== null && !isFiniteNumber(value)) {
        push('DERIVED_NON_FINITE', `value=${String(value)}`);
      }
    }
  } catch {
    push('DERIVED_METRICS_THREW', 'deriveChampionAggregateMetrics failed');
  }

  return { findings, invalidLatestEligibleMatchAt };
}

/**
 * Integrity audit for ChampionAggregate rows.
 * Exit 2 when findings are present; exit 1 only on command execution failure.
 */
export async function runAuditChampions(
  input: AuditChampionsInput,
): Promise<AuditChampionsResult> {
  const sourceNormalizationVersion = input.config.sourceNormalizationVersion;
  const aggregationVersion = input.aggregationVersion ?? input.config.aggregationVersion;

  try {
    const rows = await input.prisma.championAggregate.findMany({
      where: {
        sourceNormalizationVersion,
        aggregationVersion,
      },
    });

    const findings: IntegrityFinding[] = [];
    let invalidLatestEligibleMatchAtCount = 0;
    const keySet = new Set<string>();

    for (const row of rows) {
      const result = collectFindingsForAggregateRow(row, {
        confidenceLevel: input.config.confidenceLevel,
        seenKeys: keySet,
      });
      findings.push(...result.findings);
      if (result.invalidLatestEligibleMatchAt) {
        invalidLatestEligibleMatchAtCount += 1;
      }
    }

    const findingCounts: Record<string, number> = {};
    for (const finding of findings) {
      findingCounts[finding.code] = (findingCounts[finding.code] ?? 0) + 1;
    }

    const passed = findings.length === 0;
    const report: AuditChampionsReport = {
      ok: true,
      passed,
      sourceNormalizationVersion,
      aggregationVersion,
      rowsScanned: rows.length,
      findings: findings.slice(0, 200),
      findingCounts,
      invalidLatestEligibleMatchAtCount,
    };

    return {
      exitCode: passed ? EXIT_SUCCESS : EXIT_INTEGRITY_FAILURE,
      report,
    };
  } catch (error: unknown) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        passed: false,
        sourceNormalizationVersion,
        aggregationVersion,
        rowsScanned: 0,
        findings: [],
        findingCounts: {},
        invalidLatestEligibleMatchAtCount: 0,
        error: error instanceof Error ? error.message.slice(0, 200) : 'AUDIT_CHAMPIONS_FAILED',
      },
    };
  }
}
