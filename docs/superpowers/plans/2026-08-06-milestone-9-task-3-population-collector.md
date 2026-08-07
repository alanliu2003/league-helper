# Milestone 9 Task 3 — Population Collector Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bounded, manually triggered population collector (`TrackedPlayer` + `CollectorRun` + CLIs) that selects known players and reuses the Task 2 discovery/enqueue path so current-patch queue-420 aggregates can grow toward the public ranking floor without lowering `CHAMPION_AGGREGATION_MIN_SAMPLE`.

**Architecture:** Extract a Nest-injectable single-player discovery/enqueue service (Riot-ID + existing-`PlayerAccount` modes). Collector claims eligible `TrackedPlayer` rows with PostgreSQL `FOR UPDATE SKIP LOCKED` in concurrency-sized waves, calls account-mode discovery/enqueue outside the claim TX, owner-protects success/failure finalization, and persists one `CollectorRun` per mutating run. Manual CLIs only; no scheduler.

**Tech Stack:** TypeScript, Nest application context (same CLI bootstrap pattern as `matches:bootstrap-player`), Prisma/PostgreSQL, existing `MatchIngestionProducer` / BullMQ, Zod, Vitest, `@league-helper/shared`

**Spec:** `docs/superpowers/specs/2026-08-06-milestone-9-task-3-population-collector-design.md`

**Plan decisions (locked):**

1. Dry-run uses `preview()` — no claims; `--sample-discovery N` uses **read-only** `paginateRecentMatchIds` only (no rank sync, upsert, enroll, enqueue, cache invalidation).
2. Collector default path uses existing `PlayerAccount` mode (no account re-resolve).
3. Claim via raw SQL `FOR UPDATE SKIP LOCKED` in repository; wave size ≤ concurrency.
4. Finalized counter invariant: `playersSucceeded + playersFailed + ownershipLost = playersAttempted`.
5. No normal finalize while run still owns unaccounted leases.
6. Success finalize is status-aware: ACTIVE resets failures; PAUSED/SUSPENDED preserves failure context + operator status.
7. Persist `CollectorRun.effectivePlatforms`.
8. Enrollment flags default false → short-circuit with **zero** enrollment DB writes and **zero** extra Riot calls.
9. Do **not** commit unless the user explicitly asks.
10. Do **not** lower `CHAMPION_AGGREGATION_MIN_SAMPLE`. Do **not** implement Task 4 scheduling or participant expansion.

---

## File structure

### Create

```text
apps/api/src/features/players/discovery/
  player-match-discovery.types.ts
  player-match-discovery.service.ts
  player-match-discovery.service.test.ts

apps/api/src/features/collector/
  collector.config.ts
  collector.config.test.ts
  collector.types.ts
  collector.failure-codes.ts
  tracked-player.repository.ts
  tracked-player.repository.integration.test.ts
  collector-run.repository.ts
  collector-enrollment.service.ts
  collector-enrollment.service.test.ts
  collector-eligibility.service.ts
  collector-eligibility.service.test.ts
  population-collector.service.ts
  population-collector.service.test.ts
  collector-coverage.service.ts
  collector-coverage.service.test.ts
  collector-status.service.ts
  collector-audit.service.ts
  collector-cli.output.ts
  collector.args.ts
  collector.args.test.ts
  collector.module.ts
  cli/
    seed-player.ts
    set-player-status.ts
    run.ts
    status.ts
    audit.ts

apps/api/prisma/migrations/<timestamp>_tracked_player_collector_run/
  migration.sql
```

### Modify

```text
apps/api/prisma/schema.prisma
apps/api/src/features/players/bootstrap/bootstrap-player-core.ts   # delegate to discovery service
apps/api/src/features/players/bootstrap/bootstrap-player-cli.ts
apps/api/src/features/players/players.module.ts                    # export discovery; optional enroll hook
apps/api/src/features/players/player-search.service.ts             # optional enroll short-circuit
apps/api/src/features/champions/champion-stats.service.test.ts     # ranking floor regressions
apps/api/src/app.module.ts                                        # import CollectorModule if needed
apps/api/package.json
package.json
.env.example
apps/api/.env.example
README.md
```

### Do not modify

```text
MatchIngestionProducer contract
match-ingestion / champion-aggregation workers (formulas)
PlayerRefreshService lock/cooldown product behavior
CHAMPION_AGGREGATION_MIN_SAMPLE default
Public champion HTTP contracts / Nuxt UI
Classic Jade visibility filter
```

---

### Task 1: Ranking floor pre-task regressions

**Files:**
- Modify: `apps/api/src/features/champions/champion-stats.service.test.ts`
- Optionally add: `apps/api/src/features/champions/champion-stats-floor.regression.test.ts` if the existing file is already large

- [x] **Step 1: Add failing/locking tests for floor + ALL-tier + cache generation**

Extend the existing service test helpers. Use `config.minimumSample` (or the test fixture’s configured floor) rather than scattering magic `30` in new assertion helpers when practical. Existing fixture already uses floor 30 — keep that aligned with config under test.

```ts
it('hides ranking rows below configured minimum sample with BELOW_MINIMUM_SAMPLE', async () => {
  const { service, aggregates } = createService({ tableRows: [], totalCount: 0 });
  aggregates.findTableRows
    .mockResolvedValueOnce({ rows: [], totalCount: 0 })
    .mockResolvedValueOnce({ rows: [baseAggregate({ sampleSize: 29 })], totalCount: 1 });

  const response = await service.getTable({
    position: 'MIDDLE',
    tier: 'ALL',
    sortBy: 'winRate',
    sortDirection: 'desc',
    limit: 50,
  } as ChampionStatsTableQuery);

  expect(response.rows).toEqual([]);
  expect(response.emptyReason).toBe('BELOW_MINIMUM_SAMPLE');
  expect(response.effectiveMinimumSample).toBe(30);
});

it('shows ranking rows at exactly configured minimum sample', async () => {
  const { service } = createService({
    tableRows: [baseAggregate({ sampleSize: 30, position: 'MIDDLE', rankTier: 'ALL' })],
    totalCount: 1,
  });

  const response = await service.getTable({
    position: 'MIDDLE',
    tier: 'ALL',
    sortBy: 'winRate',
    sortDirection: 'desc',
    limit: 50,
  } as ChampionStatsTableQuery);

  expect(response.rows).toHaveLength(1);
  expect(response.rows[0]?.metrics.sampleSize).toBe(30);
  expect(response.emptyReason).toBeUndefined();
});

it('queries ALL-tier materialized rows for tier=ALL (does not sum tiers in service)', async () => {
  const { service, aggregates } = createService({
    tableRows: [baseAggregate({ sampleSize: 40, rankTier: 'ALL' })],
    totalCount: 1,
  });

  await service.getTable({
    position: 'SUPPORT',
    tier: 'ALL',
    sortBy: 'winRate',
    sortDirection: 'desc',
    limit: 50,
  } as ChampionStatsTableQuery);

  expect(aggregates.findTableRows).toHaveBeenCalledWith(
    expect.objectContaining({
      rankTier: 'ALL',
      position: 'SUPPORT',
    }),
  );
});

it('returns non-empty table after cache generation advances past an empty generation', async () => {
  const { service, cache, aggregates } = createService({
    tableRows: [],
    totalCount: 0,
    generation: 1,
  });
  aggregates.findTableRows
    .mockResolvedValueOnce({ rows: [], totalCount: 0 })
    .mockResolvedValueOnce({ rows: [], totalCount: 0 }); // unfiltered emptyReason probe

  const empty = await service.getTable({
    position: 'TOP',
    tier: 'ALL',
    sortBy: 'winRate',
    sortDirection: 'desc',
    limit: 50,
  } as ChampionStatsTableQuery);
  expect(empty.rows).toEqual([]);

  cache.getGeneration.mockResolvedValue(2);
  aggregates.findTableRows.mockResolvedValue({
    rows: [baseAggregate({ sampleSize: 40, position: 'TOP' })],
    totalCount: 1,
  });

  const filled = await service.getTable({
    position: 'TOP',
    tier: 'ALL',
    sortBy: 'winRate',
    sortDirection: 'desc',
    limit: 50,
  } as ChampionStatsTableQuery);
  expect(filled.rows).toHaveLength(1);
});
```

Adjust mocks to match the real `findTableRows` argument shape in `champion-stats.service.ts` (inspect call sites; use `expect.objectContaining`).

- [x] **Step 2: Run tests**

```bash
pnpm --filter @league-helper/api test:unit -- src/features/champions/champion-stats.service.test.ts
```

Expected: PASS. If a test fails due to a real ranking bug, fix the minimal production defect; do not lower the floor.

- [ ] **Step 3: Commit only if the user asks**

---

### Task 2: Extract Nest single-player discovery/enqueue service

**Files:**
- Create: `apps/api/src/features/players/discovery/player-match-discovery.types.ts`
- Create: `apps/api/src/features/players/discovery/player-match-discovery.service.ts`
- Create: `apps/api/src/features/players/discovery/player-match-discovery.service.test.ts`
- Modify: `apps/api/src/features/players/bootstrap/bootstrap-player-core.ts`
- Modify: `apps/api/src/features/players/bootstrap/bootstrap-player-cli.ts` (wire Nest provider)
- Modify: `apps/api/src/features/players/players.module.ts`

- [x] **Step 1: Define neutral result + input types**

```ts
// player-match-discovery.types.ts
export type PlayerMatchDiscoveryRiotIdInput = {
  mode: 'RIOT_ID';
  gameName: string;
  tagLine: string;
  platform: string;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  correlationId: string;
};

export type PlayerMatchDiscoveryAccountInput = {
  mode: 'PLAYER_ACCOUNT';
  playerAccountId: string;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  correlationId: string;
};

export type PlayerMatchDiscoveryInput =
  | PlayerMatchDiscoveryRiotIdInput
  | PlayerMatchDiscoveryAccountInput;

export type PlayerMatchDiscoveryResult = {
  ok: boolean;
  playerAccountId?: string;
  discoveredMatchCount: number;
  enqueuedCount: number;
  skippedAlreadyCompleteCount: number;
  externalMatchIds: string[];
  warnings: Array<{ code: string; message: string }>;
  normalizedFailureCode?: string;
  rateLimited?: boolean;
  retryAfterMs?: number;
};
```

- [x] **Step 2: Write failing service tests**

```ts
describe('PlayerMatchDiscoveryService', () => {
  it('Riot-ID mode resolves, upserts, soft-fails ranks, paginates, enqueues', async () => {
    // mock resolvePlayer, upsert, getRankedEntries throwing, paginate, enqueue
    // expect ok=true, enqueuedCount from enqueue helper
  });

  it('PLAYER_ACCOUNT mode loads account and does not call resolvePlayer', async () => {
    const resolvePlayer = vi.fn();
    // run account mode
    expect(resolvePlayer).not.toHaveBeenCalled();
  });

  it('dryRun=true discovers without enqueue/upsert mutations', async () => {
    // Riot-ID dry-run may resolve+discover; must not enqueue
    // Account dry-run: discover only; no upsert/enqueue
  });

  it('maps provider rate-limit errors to rateLimited + RATE_LIMITED', async () => {
    // throw typed 429 from getRecentMatchIds
  });
});
```

- [x] **Step 3: Implement `PlayerMatchDiscoveryService`**

Reuse existing helpers:

- `paginateRecentMatchIds` from `../bootstrap/paginate-match-ids`
- `enqueueDiscoveredMatches` from `../bootstrap/enqueue-discovered-matches`

Account mode:

1. Load `PlayerAccount` by id (fail `TRACKED_ACCOUNT_MISSING` / `ACCOUNT_REFERENCE_INVALID` if absent)
2. Soft-fail rank sync using stored routing + provider account shape already available, or skip resolve — if rank sync needs a provider account object, build from stored fields **without** account-v1 resolve
3. Paginate with stored `externalAccountId` / regional route
4. Enqueue via existing helper

Riot-ID mode: keep current `bootstrapPlayer` behavior (resolve → upsert → rank soft-fail → paginate → enqueue).

Surface `rateLimited` / `retryAfterMs` when the Riot client error is a dedicated rate-limit type (inspect `@league-helper/shared` / server-riot error classes already used by bootstrap).

- [x] **Step 4: Refactor bootstrap core to call the service**

`bootstrapPlayer` becomes a thin adapter mapping CLI targets → `mode: 'RIOT_ID'` and mapping `PlayerMatchDiscoveryResult` → existing `BootstrapPlayerResult` for CLI compatibility.

- [x] **Step 5: Run Task 2 suite**

```bash
pnpm --filter @league-helper/api test:unit -- src/features/players/bootstrap src/features/players/discovery
```

Expected: all existing bootstrap tests green; new discovery tests green.

- [ ] **Step 6: Checkpoint commit only if the user asks** (preferred separate from collector schema)

---

### Task 3: Prisma models + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via Prisma

- [x] **Step 1: Add enums and models to schema**

Append (names may match project enum style):

```prisma
enum TrackedPlayerStatus {
  ACTIVE
  PAUSED
  SUSPENDED
}

enum TrackedPlayerEnrollmentSource {
  ADMIN_SEED
  PRODUCT_SEARCH
  BOOTSTRAP
}

enum CollectorRunStatus {
  RUNNING
  COMPLETED
  PARTIAL
  FAILED
}

model TrackedPlayer {
  id                      String                        @id @default(uuid())
  playerAccountId         String                        @unique
  provider                String
  platformRoute           String
  enrollmentSource        TrackedPlayerEnrollmentSource
  status                  TrackedPlayerStatus           @default(ACTIVE)
  priority                Int                           @default(0)
  nextEligibleAt          DateTime                      @db.Timestamptz(3)
  lastSuccessfulRefreshAt DateTime?                     @db.Timestamptz(3)
  lastClaimedAt           DateTime?                     @db.Timestamptz(3)
  leaseOwner              String?
  leaseExpiresAt          DateTime?                     @db.Timestamptz(3)
  consecutiveFailureCount Int                           @default(0)
  lastFailureCode         String?
  createdAt               DateTime                      @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime                      @updatedAt @db.Timestamptz(3)

  playerAccount PlayerAccount @relation(fields: [playerAccountId], references: [id], onDelete: Restrict)

  @@index([status, nextEligibleAt, priority, leaseExpiresAt])
  @@index([platformRoute, status])
  @@index([leaseOwner])
}

model CollectorRun {
  id                      String             @id @default(uuid())
  ownerToken              String             @unique
  status                  CollectorRunStatus
  startedAt               DateTime           @db.Timestamptz(3)
  finishedAt              DateTime?          @db.Timestamptz(3)
  platformFilter          String?
  /// JSON string array of platforms used for this run's claims
  effectivePlatforms      Json
  queueId                 Int
  batchLimit              Int
  concurrency             Int
  playersClaimed          Int                @default(0)
  playersAttempted        Int                @default(0)
  playersSucceeded        Int                @default(0)
  playersFailed           Int                @default(0)
  ownershipLost           Int                @default(0)
  matchIdsDiscovered      Int                @default(0)
  matchesEnqueued         Int                @default(0)
  matchesSkippedComplete  Int                @default(0)
  rateLimitStops          Int                @default(0)
  budgetExhausted         Boolean            @default(false)
  failureCode             String?
  createdAt               DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime           @updatedAt @db.Timestamptz(3)

  @@index([status, startedAt])
  @@index([finishedAt])
}
```

Add reverse relation on `PlayerAccount`:

```prisma
trackedPlayer TrackedPlayer?
```

- [x] **Step 2: Create migration (no backfill)**

```bash
pnpm --filter @league-helper/api prisma:migrate -- --name tracked_player_collector_run
```

Verify SQL is additive only (CREATE TYPE / CREATE TABLE / CREATE INDEX). Zero `INSERT` into `TrackedPlayer`.

- [x] **Step 3: Generate client + typecheck**

```bash
pnpm --filter @league-helper/api prisma:generate
pnpm --filter @league-helper/api typecheck
```

**Rollback note (document in README ops section):** restore previous migration / `DROP TABLE "CollectorRun"; DROP TABLE "TrackedPlayer";` + drop enums if needed. Operational rollback is manual.

- [ ] **Step 4: Commit only if the user asks**

---

### Task 4: Collector config loader

**Files:**
- Create: `apps/api/src/features/collector/collector.config.ts`
- Create: `apps/api/src/features/collector/collector.config.test.ts`
- Modify: `.env.example`, `apps/api/.env.example`

- [x] **Step 1: Write failing config tests**

Cover defaults, hard caps, `leaseDuration > playerTimeout + 60_000`, `staleRunAfterMs > leaseDuration`, platform allowlist parse, enrollment flags default false, priority clamp bounds.

- [x] **Step 2: Implement `loadCollectorConfig`**

Mirror `loadMatchBootstrapConfig` bounded-int parsing style in `bootstrap-player.config.ts`. Reject unsafe lease/timeout/stale combinations with `ValidationFailureError`.

- [x] **Step 3: Document env keys in both `.env.example` files** (no secrets)

Include all knobs from the spec defaults table + enrollment flags.

- [x] **Step 4: Run**

```bash
pnpm --filter @league-helper/api test:unit -- src/features/collector/collector.config.test.ts
```

---

### Task 5: TrackedPlayer repository — claim + owner-protected updates

**Files:**
- Create: `apps/api/src/features/collector/tracked-player.repository.ts`
- Create: `apps/api/src/features/collector/tracked-player.repository.integration.test.ts`
- Create: `apps/api/src/features/collector/collector.failure-codes.ts`
- Create: `apps/api/src/features/collector/collector-run.repository.ts`

- [x] **Step 1: Write PostgreSQL integration tests (real DB)**

Use the same test DB prepare path as other `*.integration.test.ts` files.

Required cases:

1. Two concurrent claim transactions → disjoint IDs  
2. Active unexpired lease skipped  
3. Expired lease reclaimed (owner overwritten)  
4. Stale owner finalize updates 0 rows  
5. Success finalize while status PAUSED preserves PAUSED + failure fields  
6. ACTIVE success resets failure count  
7. Failure finalize increments count / sets backoff atomically  
8. Ordering: higher priority first, then nextEligibleAt, then lastSuccessfulRefreshAt nulls first, then id  

- [x] **Step 2: Implement claim SQL (isolated in repository)**

```sql
WITH candidates AS (
  SELECT id
  FROM "TrackedPlayer"
  WHERE status = 'ACTIVE'
    AND "nextEligibleAt" <= now()
    AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= now())
    AND "platformRoute" = ANY($1::text[])
    AND provider = $2
  ORDER BY priority DESC,
           "nextEligibleAt" ASC,
           "lastSuccessfulRefreshAt" ASC NULLS FIRST,
           id ASC
  LIMIT $3
  FOR UPDATE SKIP LOCKED
)
UPDATE "TrackedPlayer" AS tp
SET
  "leaseOwner" = $4,
  "leaseExpiresAt" = now() + ($5::text)::interval,
  "lastClaimedAt" = now(),
  "updatedAt" = now()
FROM candidates
WHERE tp.id = candidates.id
RETURNING tp.*;
```

Wrap in `prisma.$transaction`. Pass `effectivePlatforms`, provider `'RIOT'`, wave limit, `ownerToken`, lease interval.

Run `EXPLAIN` during implementation and adjust the composite index if needed; keep the SQL comment documenting order + predicates.

- [x] **Step 3: Implement owner-protected finalize methods**

- `finalizeSuccessActive(...)` — reset failures  
- `finalizeSuccessOperatorHold(...)` — preserve failures when status is PAUSED/SUSPENDED  
- Prefer **one** SQL update that branches with `CASE WHEN status = 'ACTIVE' THEN ...` so concurrent pause is respected atomically:

```sql
UPDATE "TrackedPlayer"
SET
  "leaseOwner" = NULL,
  "leaseExpiresAt" = NULL,
  "lastSuccessfulRefreshAt" = now(),
  "nextEligibleAt" = now() + ($interval)::interval,
  "consecutiveFailureCount" = CASE WHEN status = 'ACTIVE' THEN 0 ELSE "consecutiveFailureCount" END,
  "lastFailureCode" = CASE WHEN status = 'ACTIVE' THEN NULL ELSE "lastFailureCode" END,
  "updatedAt" = now()
WHERE id = $id
  AND "leaseOwner" = $owner
RETURNING id, status;
```

Failure finalize: single update incrementing count with exponent cap via SQL/`LEAST`.

Return `{ updated: boolean }` from finalize helpers.

- [x] **Step 4: CollectorRun repository**

Methods: `createRunning`, `finalizeIfRunning` (WHERE status=RUNNING AND ownerToken=...), `findStaleRunning`, counter persistence.

- [x] **Step 5: Run integration tests**

```bash
pnpm --filter @league-helper/api test:integration -- src/features/collector/tracked-player.repository.integration.test.ts
```

Expected: PASS against prepared test DB.

---

### Task 6: Enrollment + seed CLI + set-player-status CLI

**Files:**
- Create: `apps/api/src/features/collector/collector-enrollment.service.ts`
- Create: `apps/api/src/features/collector/collector-enrollment.service.test.ts`
- Create: `apps/api/src/features/collector/collector.args.ts`
- Create: `apps/api/src/features/collector/cli/seed-player.ts`
- Create: `apps/api/src/features/collector/cli/set-player-status.ts`
- Modify: `apps/api/package.json`, `package.json`

- [x] **Step 1: Enrollment service tests**

- Idempotent upsert on `playerAccountId`  
- Preserves `enrollmentSource` on re-enroll  
- Repairs denormalized provider/platform from account  
- Skips unsupported platform with warning  
- Does not reactivate PAUSED/SUSPENDED unless `reactivate: true`  
- Flag false path is tested at call sites (short-circuit), not inside enrollment  

- [x] **Step 2: Implement enrollment + seed CLI**

Seed flow:

1. Parse args (single XOR `--file`); Zod-validate file fully first  
2. Resolve Riot ID + upsert `PlayerAccount` (reuse search/bootstrap resolve path)  
3. `enroll({ account, source: ADMIN_SEED, reactivate? })`  
4. Aggregate report; exit 1 if any seed fails  

- [x] **Step 3: Implement `collector:set-player-status`**

Args: `--tracked-player-id` (required for v1), `--status`, optional `--force`, `--reset-failures`.

```ts
// semantics
// PAUSED/SUSPENDED: set status; if force, clear lease fields
// ACTIVE: set status ACTIVE; if resetFailures, clear failure fields; set nextEligibleAt=now();
//         if force, clear lease fields; else leave valid lease intact
```

- [x] **Step 4: Wire scripts**

```json
"collector:seed-player": "tsx src/features/collector/cli/seed-player.ts",
"collector:set-player-status": "tsx src/features/collector/cli/set-player-status.ts"
```

Root `package.json` proxies matching Task 2 style.

- [x] **Step 5: Run unit tests for enrollment/args**

---

### Task 7: Eligibility preview + read-only sample discovery

**Files:**
- Create: `apps/api/src/features/collector/collector-eligibility.service.ts`
- Create: `apps/api/src/features/collector/collector-eligibility.service.test.ts`

- [x] **Step 1: Tests proving preview does not mutate**

Assert no `CollectorRun` insert, no lease/`nextEligibleAt`/failure changes, no durable jobs. Ordering matches claim ORDER BY. `--sample-discovery` path calls only `paginateRecentMatchIds` (mock), never `enqueueDiscoveredMatches` / rank sync / upsert.

- [x] **Step 2: Implement `preview(input)`**

Share WHERE predicate with claim SQL (status, nextEligibleAt, lease free/expired, platforms) but **no** `FOR UPDATE`. Optional sample discovery:

```ts
async discoverMatchIdsReadOnly(account: PlayerAccount, queueId: number, maxMatches: number) {
  return paginateRecentMatchIds({
    getRecentMatchIds: this.gameData.getRecentMatchIds,
    account: /* provider account view from stored fields */,
    queueId,
    maxMatches,
    pageSize: this.config.pageSize,
  });
}
```

Do **not** call `PlayerMatchDiscoveryService` mutating entrypoints from preview.

---

### Task 8: `PopulationCollectorService.runOnce`

**Files:**
- Create: `apps/api/src/features/collector/population-collector.service.ts`
- Create: `apps/api/src/features/collector/population-collector.service.test.ts`
- Create: `apps/api/src/features/collector/collector.types.ts`
- Create: `apps/api/src/features/collector/collector.module.ts`

- [x] **Step 1: Write orchestration unit tests (mocked repos)**

Cases from spec §7.12 / clarifications:

- zero eligible → COMPLETED, counters 0  
- all succeed → COMPLETED  
- one player fail → PARTIAL  
- ownership lost → PARTIAL, `ownershipLost` incremented, not `playersFailed`  
- rate limit → stop further claims, PARTIAL  
- setup failure before attempts → FAILED  
- exception after one attempt → best-effort PARTIAL  
- finalization conflict (0 rows) → nonzero / throw  
- batchLimit across waves  
- in-flight ≤ concurrency  
- remaining match-ID budget shrinks `maxMatches`  
- no claim when remaining budget 0 while eligible remain → PARTIAL + `budgetExhausted`  
- before finalize, if owned leases remain → release/finalize or `UNRELEASED_LEASES`  
- counter equality: `succeeded + failed + ownershipLost === attempted`  

- [x] **Step 2: Implement `runOnce(input)`**

Pseudo-flow:

```ts
async runOnce(input: CollectorRunOnceInput): Promise<CollectorRunOnceResult> {
  const effectivePlatforms = intersect(allowlist, input.platformFilter);
  const ownerToken = randomUUID();
  const run = await this.runs.createRunning({ ownerToken, effectivePlatforms, ... });

  const counters = zeroCounters();
  try {
    // wave loop:
    //  compute remaining budgets; if none useful and eligibleExist → budgetExhausted stop
    //  claim wave = min(freeSlots, remainingBatch)
    //  process each claimed player with timeout:
    //    load account, validate denormalized routes
    //    discovery.discover({ mode: 'PLAYER_ACCOUNT', maxMatches: effectiveMax, dryRun: false })
    //    owner-protected success/failure finalize
    //    on rateLimited → backoff player, rateLimitStops++, stopClaims=true
    //  after loop: ensure no TrackedPlayer still leased by ownerToken
    //  assert counter equality
    //  finalize run COMPLETED|PARTIAL with owner+RUNNING guard
  } catch (e) {
    // best-effort finalize FAILED/PARTIAL
    throw e;
  }
}
```

Persist `effectivePlatforms` on create. Do not read CLI globals inside the service.

- [x] **Step 3: Run unit tests**

```bash
pnpm --filter @league-helper/api test:unit -- src/features/collector/population-collector.service.test.ts
```

---

### Task 9: `collector:run` CLI + coverage reporter

**Files:**
- Create: `apps/api/src/features/collector/cli/run.ts`
- Create: `apps/api/src/features/collector/collector-coverage.service.ts`
- Create: `apps/api/src/features/collector/collector-coverage.service.test.ts`
- Create: `apps/api/src/features/collector/collector-cli.output.ts`

- [x] **Step 1: Coverage unit tests**

- Uses `rankTier = ALL`, exact positions `TOP|JUNGLE|MIDDLE|BOTTOM|SUPPORT`  
- Excludes ALL-position and UNKNOWN from exact ranking summaries  
- Separate platforms from `effectivePlatforms`  
- Uses configured min sample + near-floor band  
- Coverage failure does not mutate run status (tested via run CLI orchestration mock)  

Query `ChampionAggregate` with current normalization/aggregation versions (reuse existing constants from match-analytics / worker config — import the same version strings the API already uses for reads).

- [x] **Step 2: Implement coverage snapshot**

Prefer aggregate table summaries + cheap Match patch counts. Label clearly as DB snapshot, not “this run added N samples.”

- [x] **Step 3: Implement CLI**

```bash
pnpm collector:run [--dry-run] [--sample-discovery N] [--platform na1] [--queue 420] \
  [--batch-size 10] [--concurrency 2] [--max-matches 20] [--max-match-ids 200] \
  [--max-enqueue 200] [--json]
```

- dry-run → `preview()` only; exit 0/1 per spec  
- apply → `runOnce()` then read-only coverage; coverage warning must not flip COMPLETED→failed exit unless run itself PARTIAL/FAILED  

Exit: 0 for COMPLETED; 1 for PARTIAL/FAILED.

- [x] **Step 4: Wire package scripts**

---

### Task 10: `collector:status` + `collector:audit`

**Files:**
- Create: `apps/api/src/features/collector/collector-status.service.ts`
- Create: `apps/api/src/features/collector/collector-audit.service.ts`
- Create: `apps/api/src/features/collector/cli/status.ts`
- Create: `apps/api/src/features/collector/cli/audit.ts`

- [x] **Step 1: Status report sections**

Run state (RUNNING/stale via `COLLECTOR_STALE_RUN_AFTER_MS`), latest finalized runs, tracked counts by status/platform/source, eligible now, valid leases, expired leases, next eligible timestamp, recent failure-code distribution, coverage snapshot optional/warning.

- [x] **Step 2: Audit findings**

- duplicate tracked identity (unique constraint sanity)  
- orphan lease owner (leaseOwner not matching any RUNNING run)  
- stale RUNNING  
- counter inequality on finalized runs  
- non-RUNNING missing `finishedAt`  
- active lease on unsupported platform  
- denormalized route/provider mismatch vs `PlayerAccount`  
- leftover leases for finalized owner tokens  
- unsafe config if detectable  

Exit 0 if no findings; 1 if findings or audit execution fails.

- [x] **Step 3: Wire scripts + tests for audit counter equality / stale threshold ≠ lease duration**

---

### Task 11: Flag-gated enrollment hooks (default off)

**Files:**
- Modify: `apps/api/src/features/players/player-search.service.ts`
- Modify: bootstrap apply path (CLI/core after successful non-dry-run upsert)
- Test: enrollment short-circuit tests

- [x] **Step 1: Implement short-circuit**

```ts
if (!this.collectorConfig.enrollFromSearch) {
  return; // no DB, no Riot
}
try {
  await this.enrollment.enroll({ account, source: 'PRODUCT_SEARCH' });
} catch (error) {
  this.logger.warn({ message: 'Collector enrollment failed', /* no PUUID */ });
}
```

Same pattern for bootstrap with `enrollFromBootstrap`. Only after successful account upsert; never on dry-run; never on not-found.

- [x] **Step 2: Tests**

- flags false → enrollment service not called  
- flags true + enroll throw → search/bootstrap still ok  
- unsupported platform → warning, no throw to product  

---

### Task 12: README + module wiring + full verification

**Files:**
- Modify: `README.md`
- Modify: `apps/api/src/app.module.ts` / `collector.module.ts` / `players.module.ts` as needed
- Modify: package scripts if any missing

- [x] **Step 1: README ops section**

Document commands, one-shot nature, Task 4 boundary, enrollment flags default false, dry-run read-only sample discovery, set-player-status, migration rollback note, ops validation target (≥ floor is not a merge gate).

- [x] **Step 2: Run full relevant suites**

```bash
pnpm --filter @league-helper/api test:unit -- src/features/champions/champion-stats.service.test.ts src/features/players/bootstrap src/features/players/discovery src/features/collector
pnpm --filter @league-helper/api test:integration -- src/features/collector
pnpm --filter @league-helper/api lint
pnpm --filter @league-helper/api typecheck
```

Expected: all PASS.

- [x] **Step 3: Manual ops checklist (not a merge gate)**

1. `pnpm collector:seed-player --game-name ... --tag-line ... --platform na1`  
2. `pnpm collector:run --dry-run`  
3. `pnpm collector:run --dry-run --sample-discovery 1`  
4. `pnpm collector:run`  
5. Drain match-ingestion + aggregation workers  
6. `pnpm collector:status` / `pnpm collector:audit`  
7. Report current-patch queue-420 ALL-tier exact-position max samples vs floor  

---

## Spec coverage checklist

| Spec area | Task |
| --------- | ---- |
| Ranking floor regressions | Task 1 |
| Shared discovery extraction | Task 2 |
| Data model / migration | Task 3 |
| Config / budgets / lease invariants | Task 4 |
| SKIP LOCKED claim + owner finalize | Task 5 |
| Admin seed + set-player-status | Task 6 |
| Dry-run preview + read-only sample discovery | Task 7 |
| runOnce waves/budgets/counters/leases | Task 8 |
| CLI run + coverage | Task 9 |
| status/audit | Task 10 |
| Enrollment flags short-circuit | Task 11 |
| Docs + verification | Task 12 |
| No public API/UI | enforced by file list |
| No Task 4 scheduler/participants | out of scope |

---

## Self-review notes

- No TBD placeholders in task bodies.  
- Counter equality and unreleased-lease guard assigned to Task 8.  
- Status-aware success finalize assigned to Task 5 SQL.  
- `effectivePlatforms` persisted in Task 3 schema + Task 8 createRunning.  
- Read-only sample discovery assigned to Task 7 (not mutating discovery service).  
- Commits gated on explicit user request.
)
