/**
 * Measure Phase 3 tiny validation rank/aggregate correctness on league_helper_m12v2.
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpRankResolutionStateCount,
  classifyExactRankCoverageHealth,
  computeRankQualityMetrics,
  emptyRankResolutionStateCounts,
} from '@league-helper/shared';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../.env') });

function dbNameFromUrl(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return null;
  }
}

async function main() {
  const db = dbNameFromUrl(process.env.DATABASE_URL ?? '');
  if (db !== 'league_helper_m12v2') {
    console.error(JSON.stringify({ ok: false, reason: 'WRONG_DB', db }));
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    const matches = await prisma.match.findMany({
      where: { queueId: 420, ingestionStatus: 'COMPLETED' },
      select: {
        id: true,
        externalMatchId: true,
        normalizedPatch: true,
        queueId: true,
        mapId: true,
        gameMode: true,
        participants: {
          select: {
            id: true,
            championId: true,
            teamPosition: true,
            individualPosition: true,
            lane: true,
            role: true,
            externalAccountId: true,
            playerAccountId: true,
            rankTierAtIngestion: true,
            rankResolutionStatus: true,
            rankObservationId: true,
          },
        },
      },
      orderBy: { gameCreation: 'desc' },
      take: 10,
    });

    const counts = emptyRankResolutionStateCounts();
    const puuids = new Set();
    let eligible = 0;
    for (const match of matches) {
      for (const p of match.participants) {
        eligible += 1;
        bumpRankResolutionStateCount(counts, p.rankResolutionStatus);
        if (p.externalAccountId) {
          puuids.add(p.externalAccountId);
        }
      }
    }

    const metrics = computeRankQualityMetrics(counts);
    const health = classifyExactRankCoverageHealth(metrics.exactRankCoverage);

    const observations = await prisma.participantRankObservation.groupBy({
      by: ['resolutionStatus', 'providerResultCode'],
      _count: { _all: true },
    });

    const aggregates = await prisma.championAggregate.findMany({
      where: {
        queueId: 420,
        aggregationVersion: '1',
        sourceNormalizationVersion: '1',
      },
      select: {
        championId: true,
        teamPosition: true,
        rankTier: true,
        sampleSize: true,
        patch: true,
      },
    });

    // Per champion×position: source ALL vs aggregate ALL
    // Use the same position normalization the worker uses via teamPosition primary.
    const { normalizeParticipantPosition } = await import('@league-helper/shared');
    const cells = new Map();
    for (const match of matches) {
      for (const p of match.participants) {
        const position = normalizeParticipantPosition({
          queueId: match.queueId,
          mapId: match.mapId,
          gameMode: match.gameMode,
          teamPosition: p.teamPosition,
          individualPosition: p.individualPosition,
          lane: p.lane,
          role: p.role,
        });
        const key = `${match.normalizedPatch}|${p.championId}|${position}`;
        const cell = cells.get(key) ?? {
          patch: match.normalizedPatch,
          championId: p.championId,
          position,
          sourceEligible: 0,
          byStatus: {},
          byExactTier: {},
          resolvedUnranked: 0,
        };
        cell.sourceEligible += 1;
        cell.byStatus[p.rankResolutionStatus] = (cell.byStatus[p.rankResolutionStatus] ?? 0) + 1;
        if (p.rankResolutionStatus === 'RESOLVED_RANKED' && p.rankTierAtIngestion) {
          cell.byExactTier[p.rankTierAtIngestion] =
            (cell.byExactTier[p.rankTierAtIngestion] ?? 0) + 1;
        }
        if (p.rankResolutionStatus === 'RESOLVED_UNRANKED') {
          cell.resolvedUnranked += 1;
        }
        cells.set(key, cell);
      }
    }

    const cellChecks = [];
    for (const cell of cells.values()) {
      const allAgg = aggregates.find(
        (a) =>
          a.patch === cell.patch &&
          a.championId === cell.championId &&
          a.teamPosition === cell.position &&
          a.rankTier === 'ALL',
      );
      const unknownAgg = aggregates.find(
        (a) =>
          a.patch === cell.patch &&
          a.championId === cell.championId &&
          a.teamPosition === cell.position &&
          a.rankTier === 'UNKNOWN',
      );
      const exactChecks = Object.entries(cell.byExactTier).map(([tier, count]) => {
        const agg = aggregates.find(
          (a) =>
            a.patch === cell.patch &&
            a.championId === cell.championId &&
            a.teamPosition === cell.position &&
            a.rankTier === tier,
        );
        return {
          tier,
          source: count,
          aggregate: agg?.sampleSize ?? 0,
          ok: (agg?.sampleSize ?? 0) === count,
        };
      });
      cellChecks.push({
        patch: cell.patch,
        championId: cell.championId,
        position: cell.position,
        sourceEligible: cell.sourceEligible,
        aggregateAll: allAgg?.sampleSize ?? 0,
        allOk: (allAgg?.sampleSize ?? 0) === cell.sourceEligible,
        unknownSource: cell.resolvedUnranked,
        unknownAggregate: unknownAgg?.sampleSize ?? 0,
        unknownOk: (unknownAgg?.sampleSize ?? 0) === cell.resolvedUnranked,
        exactChecks,
        byStatus: cell.byStatus,
      });
    }

    const report = {
      ok: true,
      database: db,
      matchCount: matches.length,
      eligibleParticipants: eligible,
      distinctPuuids: puuids.size,
      stateCounts: counts,
      permanentUnavailableSampleCount: metrics.permanentUnavailableSampleCount,
      rankResolutionCoverage: metrics.rankResolutionCoverage,
      exactRankCoverage: metrics.exactRankCoverage,
      health: health.health,
      warning: health.warningCode,
      observationGroups: observations.map((o) => ({
        status: o.resolutionStatus,
        code: o.providerResultCode,
        count: o._count._all,
      })),
      aggregateRowCount: aggregates.length,
      cellChecks,
      allCellsAllOk: cellChecks.every((c) => c.allOk),
      allCellsUnknownOk: cellChecks.every((c) => c.unknownOk),
      allCellsExactOk: cellChecks.every((c) => c.exactChecks.every((e) => e.ok)),
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason: String(error).slice(0, 200) }));
  process.exit(2);
});
