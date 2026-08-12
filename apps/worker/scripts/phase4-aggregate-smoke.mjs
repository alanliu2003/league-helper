/**
 * M12-v2 Phase 4 aggregate correctness smoke (league_helper_m12v2 only).
 * Verifies source-eligible MatchParticipants == ChampionAggregate ALL,
 * exact tiers == RESOLVED_RANKED, UNKNOWN == RESOLVED_UNRANKED only.
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
  normalizeParticipantPosition,
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
      where: {
        queueId: 420,
        ingestionStatus: 'COMPLETED',
        remake: false,
        platformRoute: 'na1',
      },
      select: {
        id: true,
        normalizedPatch: true,
        queueId: true,
        mapId: true,
        gameMode: true,
        participants: {
          select: {
            championId: true,
            teamPosition: true,
            individualPosition: true,
            lane: true,
            role: true,
            rankTierAtIngestion: true,
            rankResolutionStatus: true,
          },
        },
      },
    });

    const counts = emptyRankResolutionStateCounts();
    for (const match of matches) {
      for (const p of match.participants) {
        bumpRankResolutionStateCount(counts, p.rankResolutionStatus);
      }
    }
    const metrics = computeRankQualityMetrics(counts);
    const health = classifyExactRankCoverageHealth(metrics.exactRankCoverage);

    const aggregates = await prisma.championAggregate.findMany({
      where: {
        queueId: 420,
        platformRoute: 'na1',
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
          byExactTier: {},
          resolvedUnranked: 0,
          failedPermanent: 0,
          unresolved: 0,
        };
        cell.sourceEligible += 1;
        if (p.rankResolutionStatus === 'RESOLVED_RANKED' && p.rankTierAtIngestion) {
          cell.byExactTier[p.rankTierAtIngestion] =
            (cell.byExactTier[p.rankTierAtIngestion] ?? 0) + 1;
        }
        if (p.rankResolutionStatus === 'RESOLVED_UNRANKED') {
          cell.resolvedUnranked += 1;
        }
        if (p.rankResolutionStatus === 'FAILED_PERMANENT') {
          cell.failedPermanent += 1;
        }
        if (
          p.rankResolutionStatus === 'PENDING' ||
          p.rankResolutionStatus === 'FAILED_RETRYABLE'
        ) {
          cell.unresolved += 1;
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

      // Stale exact/UNKNOWN: aggregate tiers with no source contributors
      const staleExact = aggregates
        .filter(
          (a) =>
            a.patch === cell.patch &&
            a.championId === cell.championId &&
            a.teamPosition === cell.position &&
            a.rankTier !== 'ALL' &&
            a.rankTier !== 'UNKNOWN' &&
            (cell.byExactTier[a.rankTier] ?? 0) === 0 &&
            a.sampleSize > 0,
        )
        .map((a) => ({ tier: a.rankTier, sampleSize: a.sampleSize }));

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
        failedPermanent: cell.failedPermanent,
        unresolved: cell.unresolved,
        exactChecks,
        staleExact,
        staleUnknown: (unknownAgg?.sampleSize ?? 0) > 0 && cell.resolvedUnranked === 0,
      });
    }

    // Prefer Camille / Akali cells when present; always include all cells in checks.
    const spotlight = cellChecks.filter((c) => c.championId === 164 || c.championId === 84);

    const report = {
      ok: true,
      database: db,
      matchCount: matches.length,
      stateCounts: counts,
      exactRankCoverage: metrics.exactRankCoverage,
      rankResolutionCoverage: metrics.rankResolutionCoverage,
      health: health.health,
      warning: health.warningCode,
      cellCount: cellChecks.length,
      spotlight,
      allCellsAllOk: cellChecks.every((c) => c.allOk),
      allCellsUnknownOk: cellChecks.every((c) => c.unknownOk),
      allCellsExactOk: cellChecks.every((c) => c.exactChecks.every((e) => e.ok)),
      noStaleExact: cellChecks.every((c) => c.staleExact.length === 0),
      noStaleUnknown: cellChecks.every((c) => !c.staleUnknown),
      // UNKNOWN must equal RESOLVED_UNRANKED only (failedPermanent never counted as unknownSource).
      permanentUnavailableNotInUnknown: cellChecks.every((c) => c.unknownOk),
    };

    report.ok =
      report.allCellsAllOk &&
      report.allCellsUnknownOk &&
      report.allCellsExactOk &&
      report.noStaleExact &&
      report.noStaleUnknown;

    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason: String(error).slice(0, 200) }));
  process.exit(2);
});
