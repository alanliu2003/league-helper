import type { PrismaClient } from '@prisma/client';

/** Subset of expansion outcomes that drive non-reserving async counters. */
export type AsyncExpansionOutcome =
  | 'created'
  | 'already_tracked'
  | 'skipped_depth_limit'
  | 'skipped_total_cap'
  | 'skipped_population_cap'
  | 'skipped_run_cap'
  | 'skipped_source_cap'
  | 'skipped_identity'
  | string;

/**
 * Best-effort async Task 4 CollectorRun expansion counters.
 *
 * - Never touches Task 3 execution counters or CollectorRun.status.
 * - Does NOT increment playersEnrolledFromParticipants (reservation TX owns that).
 * - Missing run id / missing run row → no-op (0 rows updated).
 * - Observational: reprocessing may increment more than once; hard quotas remain authoritative.
 */
export async function attributeAsyncExpansionCounters(
  prisma: PrismaClient,
  sourceCollectorRunId: string | null | undefined,
  outcomes: Array<{ outcome: AsyncExpansionOutcome }>,
  participantsConsidered: number,
): Promise<void> {
  if (!sourceCollectorRunId) {
    return;
  }

  let alreadyTracked = 0;
  let skippedDepthLimit = 0;
  let skippedPopulationCap = 0;

  for (const row of outcomes) {
    if (row.outcome === 'already_tracked') {
      alreadyTracked += 1;
    } else if (row.outcome === 'skipped_depth_limit') {
      skippedDepthLimit += 1;
    } else if (row.outcome === 'skipped_population_cap') {
      skippedPopulationCap += 1;
    }
  }

  if (
    participantsConsidered <= 0 &&
    alreadyTracked <= 0 &&
    skippedDepthLimit <= 0 &&
    skippedPopulationCap <= 0
  ) {
    return;
  }

  await prisma.$executeRaw`
    UPDATE "CollectorRun"
    SET
      "participantsConsidered" = "participantsConsidered" + ${participantsConsidered},
      "playersAlreadyTrackedFromParticipants" =
        "playersAlreadyTrackedFromParticipants" + ${alreadyTracked},
      "playersSkippedDepthLimit" = "playersSkippedDepthLimit" + ${skippedDepthLimit},
      "playersSkippedPopulationCap" = "playersSkippedPopulationCap" + ${skippedPopulationCap},
      "updatedAt" = now()
    WHERE id = ${sourceCollectorRunId}
  `;
}
