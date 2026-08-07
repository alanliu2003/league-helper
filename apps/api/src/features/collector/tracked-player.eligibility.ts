/**
 * Shared eligibility predicates + ordering for claim and read-only preview.
 * Both paths must stay logically identical (preview omits FOR UPDATE / mutations).
 *
 * Eligibility (DB now()):
 * - status = ACTIVE
 * - nextEligibleAt due
 * - lease free or expired
 * - platformRoute ∈ platforms
 * - provider match
 *
 * Order: priority DESC, nextEligibleAt ASC, lastSuccessfulRefreshAt ASC NULLS FIRST, id ASC
 */

/** WHERE body (no leading WHERE). Parameters: $1 platforms text[], $2 provider. */
export const TRACKED_PLAYER_ELIGIBILITY_WHERE_SQL = `
  status = 'ACTIVE'
  AND "nextEligibleAt" <= now()
  AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now())
  AND "platformRoute" = ANY($1::text[])
  AND provider = $2
`.trim();

/** ORDER BY clause including the ORDER BY keyword. */
export const TRACKED_PLAYER_ELIGIBILITY_ORDER_SQL = `
  ORDER BY priority DESC,
           "nextEligibleAt" ASC,
           "lastSuccessfulRefreshAt" ASC NULLS FIRST,
           id ASC
`.trim();
