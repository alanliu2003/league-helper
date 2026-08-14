import type { PrismaClient } from '@prisma/client';
import { MatchIngestionStatus } from '@prisma/client';
import { RANKED_FLEX_QUEUE_ID, RANKED_SOLO_QUEUE_ID } from '@league-helper/shared';
import type { ChampionAggregationWorkerConfig } from '../../config.js';
import { evaluateMatchEligibility } from '../../queues/champion-aggregation/eligibility.js';
import type { AggregateCliFilters } from './parse-args.js';
import { EXIT_COMMAND_FAILURE, EXIT_SUCCESS } from './exit-codes.js';

const RANKED_QUEUE_IDS = new Set([RANKED_SOLO_QUEUE_ID, RANKED_FLEX_QUEUE_ID]);

export type AuditRankCoverageInput = {
  prisma: PrismaClient;
  config: ChampionAggregationWorkerConfig;
  filters?: AggregateCliFilters;
};

export type RankCoverageBucket = {
  totalEligibleParticipants: number;
  linkedParticipants: number;
  knownRankTier: number;
  unknownRankTier: number;
  coveragePercent: number | null;
};

export type AuditRankCoverageReport = {
  ok: boolean;
  sourceNormalizationVersion: string;
  aggregationVersion: string;
  primaryDenominatorQueues: number[];
  ranked: RankCoverageBucket & {
    byQueue: Array<{ queueId: number } & RankCoverageBucket>;
    byPatch: Array<{ patch: string } & RankCoverageBucket>;
    byPlatform: Array<{ platformRoute: string } & RankCoverageBucket>;
  };
  nonRanked: RankCoverageBucket & {
    note: string;
  };
  error?: string;
};

export type AuditRankCoverageResult = {
  exitCode: number;
  report: AuditRankCoverageReport;
};

function emptyBucket(): RankCoverageBucket {
  return {
    totalEligibleParticipants: 0,
    linkedParticipants: 0,
    knownRankTier: 0,
    unknownRankTier: 0,
    coveragePercent: null,
  };
}

function finalize(bucket: RankCoverageBucket): RankCoverageBucket {
  const coveragePercent =
    bucket.totalEligibleParticipants === 0
      ? null
      : (bucket.knownRankTier / bucket.totalEligibleParticipants) * 100;
  return { ...bucket, coveragePercent };
}

/**
 * Rank coverage audit. Primary denominator = ranked queues 420 and 440 only.
 * Non-ranked queues are reported separately and intentionally UNKNOWN-heavy.
 */
export async function runAuditRankCoverage(
  input: AuditRankCoverageInput,
): Promise<AuditRankCoverageResult> {
  const versions = {
    sourceNormalizationVersion: input.config.sourceNormalizationVersion,
    aggregationVersion: input.config.aggregationVersion,
  };

  try {
    const matches = await input.prisma.match.findMany({
      where: {
        ingestionStatus: MatchIngestionStatus.COMPLETED,
        remake: false,
        normalizationVersion: versions.sourceNormalizationVersion,
        ...(input.filters?.patch ? { normalizedPatch: input.filters.patch } : {}),
        ...(input.filters?.platformRoute
          ? { platformRoute: input.filters.platformRoute }
          : {}),
      },
      select: {
        id: true,
        ingestionStatus: true,
        remake: true,
        normalizationVersion: true,
        normalizedPatch: true,
        platformRoute: true,
        regionalRoute: true,
        queueId: true,
        mapId: true,
        gameMode: true,
        gameCreation: true,
        gameEndTimestamp: true,
        gameDurationSeconds: true,
        participants: {
          select: {
            participantId: true,
            championId: true,
            teamId: true,
            teamPosition: true,
            individualPosition: true,
            lane: true,
            role: true,
            rankTierAtIngestion: true,
            rankResolutionStatus: true,
            playerAccountId: true,
            win: true,
            kills: true,
            deaths: true,
            assists: true,
            totalCs: true,
            timePlayedSeconds: true,
            totalDamageDealtToChampions: true,
            visionScore: true,
            goldEarned: true,
            goldDifferenceAt10: true,
            goldDifferenceAt15: true,
            csDifferenceAt10: true,
            csDifferenceAt15: true,
          },
        },
      },
    });

    const ranked = emptyBucket();
    const nonRanked = emptyBucket();
    const byQueue = new Map<number, RankCoverageBucket>();
    const byPatch = new Map<string, RankCoverageBucket>();
    const byPlatform = new Map<string, RankCoverageBucket>();

    const bump = (bucket: RankCoverageBucket, linked: boolean, known: boolean) => {
      bucket.totalEligibleParticipants += 1;
      if (linked) {
        bucket.linkedParticipants += 1;
      }
      if (known) {
        bucket.knownRankTier += 1;
      } else {
        bucket.unknownRankTier += 1;
      }
    };

    for (const match of matches) {
      const { participants, ...matchRow } = match;
      const eligibility = evaluateMatchEligibility(matchRow, participants, versions);
      if (!eligibility.eligible) {
        continue;
      }

      const isRanked = RANKED_QUEUE_IDS.has(match.queueId);
      if (input.filters?.queueId !== undefined && match.queueId !== input.filters.queueId) {
        continue;
      }

      for (const contributor of eligibility.contributors) {
        const participant = participants.find(
          (p) => p.participantId === contributor.participantId,
        );
        const linked = Boolean(participant?.playerAccountId);
        // Exact-ranked only — unresolved must not count as "known" or UNKNOWN.
        const known = Boolean(contributor.rankClassification.exactRankTier);
        const target = isRanked ? ranked : nonRanked;
        bump(target, linked, known);

        if (isRanked) {
          const q = byQueue.get(match.queueId) ?? emptyBucket();
          bump(q, linked, known);
          byQueue.set(match.queueId, q);

          const patch = match.normalizedPatch ?? 'unknown';
          const p = byPatch.get(patch) ?? emptyBucket();
          bump(p, linked, known);
          byPatch.set(patch, p);

          const platform = match.platformRoute ?? 'unknown';
          const plat = byPlatform.get(platform) ?? emptyBucket();
          bump(plat, linked, known);
          byPlatform.set(platform, plat);
        }
      }
    }

    const report: AuditRankCoverageReport = {
      ok: true,
      sourceNormalizationVersion: versions.sourceNormalizationVersion,
      aggregationVersion: versions.aggregationVersion,
      primaryDenominatorQueues: [RANKED_SOLO_QUEUE_ID, RANKED_FLEX_QUEUE_ID],
      ranked: {
        ...finalize(ranked),
        byQueue: [...byQueue.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([queueId, bucket]) => ({ queueId, ...finalize(bucket) })),
        byPatch: [...byPatch.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([patch, bucket]) => ({ patch, ...finalize(bucket) })),
        byPlatform: [...byPlatform.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([platformRoute, bucket]) => ({ platformRoute, ...finalize(bucket) })),
      },
      nonRanked: {
        ...finalize(nonRanked),
        note: 'Non-ranked queues are intentionally UNKNOWN for rank-at-ingestion and are excluded from primary coverage percent.',
      },
    };

    return { exitCode: EXIT_SUCCESS, report };
  } catch (error: unknown) {
    return {
      exitCode: EXIT_COMMAND_FAILURE,
      report: {
        ok: false,
        sourceNormalizationVersion: versions.sourceNormalizationVersion,
        aggregationVersion: versions.aggregationVersion,
        primaryDenominatorQueues: [RANKED_SOLO_QUEUE_ID, RANKED_FLEX_QUEUE_ID],
        ranked: {
          ...emptyBucket(),
          byQueue: [],
          byPatch: [],
          byPlatform: [],
        },
        nonRanked: {
          ...emptyBucket(),
          note: 'Non-ranked queues are intentionally UNKNOWN for rank-at-ingestion and are excluded from primary coverage percent.',
        },
        error: error instanceof Error ? error.message.slice(0, 200) : 'AUDIT_RANK_FAILED',
      },
    };
  }
}
