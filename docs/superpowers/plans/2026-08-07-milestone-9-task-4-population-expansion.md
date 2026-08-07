# Milestone 9 Task 4 — Recurring Collection + Bounded Population Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional recurring scheduling for `PopulationCollectorService.runOnce` and optional bounded match-participant population expansion with explicit depth, **race-safe** quotas, owner-safe overlap prevention, and ingestion backpressure — without a second ingestion pipeline or unbounded crawl.

**Architecture:** Dedicated Nest CLI process (`collector:scheduler`) acquires a PostgreSQL singleton scheduler lease **before** probing queues or mutating shared outcomes, with lease TTL validated against worst-case `runOnce` wall time. After match-ingestion marks a match `COMPLETED`, a non-fatal worker-side expansion hook may upsert `PlayerAccount` and create `TrackedPlayer` rows with `MATCH_PARTICIPANT` + `discoveryDepth` inside a short reservation transaction that atomically guards autonomous/global, per-run, and per-source budgets. No recursive immediate collection.

**Tech Stack:** TypeScript, Nest application context (scheduler CLIs), Prisma/PostgreSQL, BullMQ job counts, existing match-ingestion worker, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-08-07-milestone-9-task-4-population-expansion-design.md`

**Base commit:** `b1e1781` (Task 3 merged)

**Plan decisions (locked):**

1. Scheduler = dedicated Nest CLI process; never starts on normal API boot.
2. Overlap = `CollectorSchedulerState` singleton TTL lease; **owner-safe** mutations only.
3. Lease TTL must satisfy `leaseMs > ceil(batch/concurrency)*playerTimeoutMs + safetyMargin` (default lease 60m; derived minimum 55m under Task 3 defaults).
4. Expansion = worker post-COMPLETED non-fatal hook; disabled by default.
5. Identity = normalized participant fields only; skip incomplete; no Account-v1 N+1.
6. Enrollment source = `MATCH_PARTICIPANT` (additive enum).
7. Depth = `TrackedPlayer.discoveryDepth` with min semantics; explicit enroll roots to 0.
8. No parent/edge graph tables; `CollectorRunSourceQuota` is budget-only with FKs + CASCADE.
9. Global autonomous cap via `CollectorPopulationBudget` atomic reservation — **not** COUNT+unique.
10. Quota reservations + TrackedPlayer INSERT share one TX; unique race → ROLLBACK (no quota leak).
11. Per-match cap = fixed deterministic consideration window of size N ordered by `externalAccountId ASC`, `participantId ASC` only (no mutable linkage/tracked/depth in ordering); post-window state checks; no MatchExpansion table.
12. Seed/search/bootstrap do **not** consume or get blocked by autonomous budget.
13. Task 4 CollectorRun expansion counters are **async post-finalization**; must not affect Task 3 status/equality.
14. Optional `sourceCollectorRunId` on match-ingestion payload; missing run → un-attributed policy.
15. Manual `collector:run` bypasses backpressure; scheduled path respects it (winner-only probe).
16. Do **not** commit unless the user explicitly asks.
17. Do **not** lower `CHAMPION_AGGREGATION_MIN_SAMPLE`.
18. Do **not** implement recursive crawl or public collector HTTP/UI.

**Phase review gates:** stop after Phase 1, 2, 3, and before final commit in Phase 4.

---



## File structure



### Create

```text
apps/api/prisma/migrations/<timestamp>_task4_population_expansion/
  migration.sql

apps/api/src/features/collector/
  collector-scheduler.state.ts
  collector-scheduler.lease.ts
  collector-scheduler.lease.test.ts
  collector-scheduler.lease.integration.test.ts
  collector-scheduler.service.ts
  collector-scheduler.service.test.ts
  collector-scheduler.service.integration.test.ts
  collector-population-budget.ts          # optional Nest/repo helper for status/audit reads
  cli/scheduler.ts
  cli/scheduler-status.ts
  cli/scheduler-trigger.ts

apps/worker/src/collector/
  participant-expansion.config.ts
  participant-expansion.select.ts
  participant-expansion.select.test.ts
  participant-expansion.reserve.ts        # SQL/TX reservation helpers
  participant-expansion.service.ts
  participant-expansion.service.test.ts
  participant-expansion.quota.integration.test.ts   # REQUIRED real PG concurrency
  expand-match-participants-safe.ts
  expand-match-participants-safe.test.ts
```



### Modify

```text
apps/api/prisma/schema.prisma
packages/shared/src/job-queues/match-ingestion-job.ts
packages/shared/src/job-queues/match-ingestion-job.test.ts
apps/api/src/features/collector/collector.config.ts
apps/api/src/features/collector/collector.config.test.ts
apps/api/src/features/collector/collector.types.ts
apps/api/src/features/collector/tracked-player.repository.ts
apps/api/src/features/collector/tracked-player.repository.integration.test.ts
apps/api/src/features/collector/collector-enrollment.service.ts
apps/api/src/features/collector/collector-enrollment.service.test.ts
apps/api/src/features/collector/collector-run.repository.ts
apps/api/src/features/collector/population-collector.service.ts
apps/api/src/features/collector/collector-status.service.ts
apps/api/src/features/collector/collector-audit.service.ts
apps/api/src/features/collector/collector-cli.output.ts
apps/api/src/features/players/bootstrap/enqueue-discovered-matches.ts
apps/api/src/queues/match-ingestion.producer.ts
apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts
apps/worker/src/queues/match-ingestion/match-ingestion.processor.test.ts
apps/api/package.json
apps/worker/package.json
package.json
.env.example
apps/api/.env.example
README.md
```

---



## PHASE 1 — Schema, config, race-safe expansion domain (no scheduler, no ingestion hook)

**STOP FOR REVIEW** at end of Phase 1.

### Task 1: Additive Prisma schema + migration

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: migration SQL

- [x] **Step 1: Schema**

```prisma
enum TrackedPlayerEnrollmentSource {
  ADMIN_SEED
  PRODUCT_SEARCH
  BOOTSTRAP
  MATCH_PARTICIPANT
}

enum CollectorSchedulerOutcome {
  TRIGGERED
  SKIPPED_BACKPRESSURE
  SKIPPED_COOLDOWN
  FAILED_TO_START
  // Note: SKIPPED_DISABLED / SKIPPED_OVERLAP are local tick results only — not persisted by losers.
}

model TrackedPlayer {
  // existing...
  discoveryDepth Int @default(0)
  runSourceQuotas CollectorRunSourceQuota[]
}

model CollectorRun {
  // existing Task 3 counters unchanged in semantics...
  participantsConsidered                Int @default(0)
  playersEnrolledFromParticipants       Int @default(0)
  playersAlreadyTrackedFromParticipants Int @default(0)
  playersSkippedDepthLimit              Int @default(0)
  playersSkippedPopulationCap           Int @default(0)
  sourceQuotas CollectorRunSourceQuota[]
}

model CollectorPopulationBudget {
  id                            String   @id // 'singleton'
  matchParticipantEnrolledCount Int      @default(0)
  createdAt                     DateTime @default(now()) @db.Timestamptz(3)
  updatedAt                     DateTime @updatedAt @db.Timestamptz(3)
}

model CollectorSchedulerState {
  id                 String                     @id // 'singleton'
  leaseOwner         String?
  leaseExpiresAt     DateTime?                  @db.Timestamptz(3)
  lastTriggerAt      DateTime?                  @db.Timestamptz(3)
  lastOutcome        CollectorSchedulerOutcome?
  lastCollectorRunId String?
  lastErrorCode      String?
  cooldownUntil      DateTime?                  @db.Timestamptz(3)
  createdAt          DateTime                   @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime                   @updatedAt @db.Timestamptz(3)
}

model CollectorRunSourceQuota {
  id                    String   @id @default(uuid())
  collectorRunId        String
  sourceTrackedPlayerId String
  newPlayersEnrolled    Int      @default(0)
  createdAt             DateTime @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime @updatedAt @db.Timestamptz(3)

  collectorRun        CollectorRun  @relation(fields: [collectorRunId], references: [id], onDelete: Cascade)
  sourceTrackedPlayer TrackedPlayer @relation(fields: [sourceTrackedPlayerId], references: [id], onDelete: Cascade)

  @@unique([collectorRunId, sourceTrackedPlayerId])
  @@index([collectorRunId])
}
```

- [x] **Step 2: Migration seeds singleton rows**

```sql
INSERT INTO "CollectorPopulationBudget" (id, "matchParticipantEnrolledCount", "createdAt", "updatedAt")
VALUES ('singleton', 0, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "CollectorSchedulerState" (id, "createdAt", "updatedAt")
VALUES ('singleton', now(), now())
ON CONFLICT (id) DO NOTHING;
```

- [x] **Step 3:** `prisma migrate` **/ generate; verify clean status**

---



### Task 2: Config + lease-duration invariant

**Files:**

- Modify: `collector.config.ts` (+ tests)
- Mirror expansion knobs in worker config loader
- Modify: `.env.example`, `apps/api/.env.example`

- [x] **Step 1: Add scheduler/expansion fields** per spec §4.
- [x] **Step 2: Enforce lease invariant**

```ts
const minimumSchedulerLeaseMs =
  Math.ceil(scheduleBatchSize / scheduleConcurrency) * playerTimeoutMs +
  schedulerLeaseSafetyMarginMs;

if (!(schedulerLeaseMs > minimumSchedulerLeaseMs)) {
  throw new ValidationFailureError(
    'COLLECTOR_SCHEDULER_LEASE_MS must be greater than ceil(batch/concurrency)*COLLECTOR_PLAYER_TIMEOUT_MS + safety margin.',
    { schedulerLeaseMs, minimumSchedulerLeaseMs, scheduleBatchSize, scheduleConcurrency, playerTimeoutMs, schedulerLeaseSafetyMarginMs },
  );
}
```

Defaults: lease `3600000` (60m), safety margin `300000` (5m). Derived minimum under Task 3 defaults = 55m; `60m > 55m` passes.

- [x] **Step 3: Tests**

```ts
it('rejects unsafe scheduler lease vs batch/concurrency/timeout', ...);
it('rejects lease equal to derived minimum (strict greater-than)', ...);
it('accepts lease at minimum + 1ms', ...);
it('accepts default config (60m lease with Task 3 defaults)', ...);
it('defaults expansion/scheduler flags to safe disabled values', ...);
it('clamps budget knobs to hard maxima', ...);
```

---



### Task 3: Depth-aware Nest enrollment (no autonomous budget)

**Files:**

- Modify: `tracked-player.repository.ts` (+ integration tests)
- Modify: `collector-enrollment.service.ts` (+ unit tests)

- [x] **Step 1:** `discoveryDepth` **on upsert; INSERT sets depth; UPDATE** `LEAST`
- [x] **Step 2: Seed/search/bootstrap propose depth 0; do not touch** `CollectorPopulationBudget`
- [x] **Step 3: Tests for min-depth, source immutability, seed succeeds at autonomous cap**

---



### Task 4: Deterministic selection + reservation TX expansion service

**Files:**

- Create worker collector modules listed above

- [x] **Step 1: Pure** `selectExpansionCandidates` **— fixed reprocess-safe window** (+ unit tests)

Window selection is a pure function of stable match identity inputs. Do **not** accept or use `playerAccountId`, tracked flags, depth, enrollmentSource, or live account metadata for filter/sort/window.

```ts
export function selectExpansionCandidates(input: {
  participants: Array<{
    externalAccountId: string | null;
    riotIdGameName: string | null;
    riotIdTagLine: string | null;
    participantId: number;
    // deliberately omit playerAccountId from selection inputs
  }>;
  sourceExternalAccountId: string;
  maxPerMatch: number; // COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH
}): Array<{ externalAccountId: string; participantId: number /* + stable identity fields */ }> {
  // 1) filter malformed / source-self / missing required normalized identity
  // 2) sort: externalAccountId ASC, participantId ASC  (ONLY)
  // 3) return FIRST maxPerMatch candidates (fixed lifetime window)
}
```

Pipeline after selection (orchestration, not inside selector):

```text
fixed window → inspect TrackedPlayer/depth/account → already_tracked | depth-min | reserve+create
```

```ts
it('deterministic fixed window equals maxPerMatch', ...);
it('same normalized participant set always produces same candidate identity window', ...);
it('linkage mutation does not change the fixed window', () => {
  // A..F, cap=3; first call all playerAccountId irrelevant/null
  // second call arbitrary A..F linkage values changed
  // selected externalAccountId set identical
});
it('tracked status does not affect window; later candidates never appear', ...);
it('depth/status/account metadata changes do not influence ordering', ...);
it('reprocessing same match does not advance beyond window', ...);
// e.g. immutable order A..F, cap=3 → always [A,B,C]
```

- [x] **Step 2: Implement** `reserveAndCreateTrackedParticipant` **TX** matching spec §8.2

Conceptual SQL flow (exact binding style may use Prisma `$executeRaw` / `$queryRaw`):

```ts
// IMPORTANT: any failed reservation or unique race MUST throw inside $transaction
// so PostgreSQL rolls back prior guarded increments. Do not `return { ok:false }`
// after a successful UPDATE reservation — that would commit the increment.
await prisma.$transaction(async (tx) => {
  const budget = await tx.$queryRaw/* UPDATE CollectorPopulationBudget ... RETURNING */`;
  if (!budget.length) throw new QuotaRejectedError('population_cap');

  if (attributed) {
    const run = await tx.$queryRaw/* UPDATE CollectorRun SET playersEnrolledFromParticipants = ... */`;
    if (!run.length) throw new QuotaRejectedError('run_cap');

    await ensureSourceQuotaRow(tx, runId, sourceId);
    const source = await tx.$queryRaw/* UPDATE CollectorRunSourceQuota ... */`;
    if (!source.length) throw new QuotaRejectedError('source_cap');
  }

  try {
    await tx.trackedPlayer.create({ data: { /* MATCH_PARTICIPANT, discoveryDepth */ } });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AlreadyTrackedRollbackError();
    throw e;
  }
});
// Catch QuotaRejectedError / AlreadyTrackedRollbackError outside → map to skip/already_tracked
```

- [x] **Step 3:** `expandFromCompletedMatch` **orchestration** (match-level gates → `selectExpansionCandidates` → **then** TrackedPlayer/depth inspection → reserve/create only for window members; async metric increments for non-reserving counters). Do not sort/filter the lifetime window using linkage or tracked state. Do not implement per-invocation “N new creates then slide window.”

- [x] **Step 4: REQUIRED PostgreSQL concurrency integration tests**

```ts
it('global autonomous cap: concurrent distinct candidates never exceed N', async () => {
  // cap=N; fire >N parallel reserveAndCreate with distinct playerAccountIds
  // expect final matchParticipantEnrolledCount <= N
  // expect COUNT(MATCH_PARTICIPANT) <= N
});

it('per-run cap: concurrent matches attributed to one run never exceed run max', ...);
it('per-source-per-run cap: concurrent matches never exceed source max', ...);
it('same participant race: one TrackedPlayer and at most one quota slot', ...);
it('unique race after reservation rolls back budget counters', ...);
it('seed enrollment succeeds when autonomous budget is at cap', ...);
it('missing collector run uses un-attributed path and does not throw', ...);
```

**STOP FOR REVIEW — Phase 1 complete.** Do not wire processor yet.

---



## PHASE 2 — Ingestion integration, async counters, status/audit

**STOP FOR REVIEW** at end of Phase 2.

### Task 5: Plumb `sourceCollectorRunId`

- [x] Additive optional Zod uuid on `MatchIngestionJobPayload`
- [x] Collector enqueue sets current `CollectorRun.id`
- [x] Existing payloads without field still validate

---



### Task 6: Non-fatal processor hook

- [x] `expandMatchParticipantsSafe` mirrors `enqueueAggregationSafe`
- [x] Call on new COMPLETED + `already_complete` paths
- [x] Tests: disabled zero-ops; throw does not fail ingest; queue≠420 skips
- [x] Integration: concurrent processor expansions respect caps

---



### Task 7: Status + audit for budgets + async counters

- [x] Status: depth histogram, MATCH_PARTICIPANT counts, autonomous budget usage, total tracked count, scheduler config enable + state snapshot
- [x] Label CollectorRun expansion counters as async post-finalization metrics in output
- [x] Audit: budget drift vs COUNT(MATCH_PARTICIPANT); depth/cap findings; **do not** flag Task 3 equality failures because expansion counters changed after terminal status
- [x] Audit: missing/negative budget impossible states

**STOP FOR REVIEW — Phase 2 complete.**

---



## PHASE 3 — Owner-safe scheduler

**STOP FOR REVIEW** at end of Phase 3.

### Task 8: Scheduler lease repository (owner-protected)

**Files:**

- Create: `collector-scheduler.lease.ts` (+ unit + **PG integration** tests)

Methods (all owner-guarded except acquire):

```ts
ensureSingleton(): Promise<void>
tryAcquireLease(owner: string, leaseMs: number): Promise<boolean>
renewLease(owner: string, leaseMs: number): Promise<boolean>
recordTrigger(owner: string, collectorRunId: string): Promise<boolean>
recordOutcome(owner: string, outcome: CollectorSchedulerOutcome, errorCode?: string): Promise<boolean>
setCooldown(owner: string, cooldownUntil: Date): Promise<boolean>
releaseLease(owner: string): Promise<boolean>
```

- [x] **Step 1: Implement conditional SQL with** `WHERE leaseOwner = $owner` **for mutations**
- [x] **Step 2: Integration tests**

```ts
it('concurrent acquire: exactly one winner', ...);
it('expired stale lease is reclaimable', ...);
it('losing replica cannot overwrite winner outcome', ...);
it('stale owner cannot renew', ...);
it('stale owner cannot release', ...);
it('stale owner cannot set terminal outcome', ...);
it('winning owner can record SKIPPED_BACKPRESSURE then release', ...);
it('lease renewal succeeds only for current owner', ...);
```

---



### Task 9: Scheduler service (owner-safe tick order)

**Files:**

- Create: `collector-scheduler.service.ts` (+ tests)

```ts
async tick(): Promise<SchedulerTickResult> {
  if (!isEnabledFromEnv()) return { outcome: 'SKIPPED_DISABLED' }; // no DB write

  const owner = randomUUID();
  const acquired = await lease.tryAcquireLease(owner, config.schedulerLeaseMs);
  if (!acquired) return { outcome: 'SKIPPED_OVERLAP' }; // no DB write

  try {
    const state = await lease.readState();
    if (state.cooldownUntil && state.cooldownUntil > new Date()) {
      await lease.recordOutcome(owner, 'SKIPPED_COOLDOWN');
      return { outcome: 'SKIPPED_COOLDOWN' };
    }

    const pending = await probeMatchIngestionPending(); // only winner
    if (pending === 'probe_failed' || pending > config.maxPendingIngestionJobs) {
      await lease.recordOutcome(owner, 'SKIPPED_BACKPRESSURE', pending === 'probe_failed' ? 'QUEUE_PROBE_FAILED' : undefined);
      return { outcome: 'SKIPPED_BACKPRESSURE' };
    }

    const renew = startRenewalLoop(owner);
    try {
      const run = await populationCollector.runOnce(scheduleInput);
      await lease.recordTrigger(owner, run.collectorRunId);
      await lease.recordOutcome(owner, 'TRIGGERED');
      if (runWasRateLimited(run)) {
        await lease.setCooldown(owner, computeCooldownUntil(run));
      }
      return { outcome: 'TRIGGERED', collectorRunId: run.collectorRunId };
    } finally {
      stopRenewalLoop(renew);
    }
  } catch {
    await lease.recordOutcome(owner, 'FAILED_TO_START', 'RUN_ONCE_START_FAILED');
    return { outcome: 'FAILED_TO_START' };
  } finally {
    await lease.releaseLease(owner);
  }
}
```

- [x] Unit tests for ordering + mocked probes
- [x] Integration: two replicas → one TRIGGERED path, one local OVERLAP; winner state intact
- [x] Prove AppModule import does not start the loop

---



### Task 10: Scheduler CLIs + scripts

- [x] `collector:scheduler` / `scheduler-status` / `scheduler-trigger`
- [x] Status shows config `enabled` separately from `lastOutcome`
- [x] Manual `collector:run` regression still green

**STOP FOR REVIEW — Phase 3 complete.**

---



## PHASE 4 — Docs, regression gates, controlled validation

**STOP FOR REVIEW BEFORE COMMIT.**

### Task 11: README

Document Task 3 vs Task 4, process ownership, lease TTL invariant (default 60m; strict `>` over derived minimum), owner-safe overlap, winner-only backpressure, race-safe autonomous budget, fixed per-match window ordered by `externalAccountId`/`participantId` only (reprocess-safe; linkage must not reorder), async expansion counters, seed vs cap policy, emergency disable, no public UI/API.

### Task 12: Full regression gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @league-helper/api exec prisma migrate status
```

Include focused collector/scheduler/expansion/bootstrap/search/discovery/champion-stats/match-ingestion/persistence/aggregation suites.

### Task 13: Controlled real-data validation (Stages A–F)

Per spec §14. Confirm second scheduler replica does not clobber winner outcome.

### Task 14: Final commit (only if user asks)

Exclude untracked diagnose/recovery scripts.

**STOP FOR REVIEW BEFORE COMMIT.**

---



## Spec coverage checklist


| Spec requirement                    | Plan task                       |
| ----------------------------------- | ------------------------------- |
| Race-safe global/run/source quotas  | Task 4 (+ PG concurrency tests) |
| Reservation rollback on unique race | Task 4                          |
| Seed not blocked by autonomous cap  | Tasks 3–4                       |
| Lease TTL invariant                 | Task 2                          |
| Owner-safe tick + stale owner       | Tasks 8–9                       |
| Async expansion counters            | Tasks 6–7                       |
| SourceQuota FKs CASCADE             | Task 1                          |
| Winner-only backpressure            | Task 9                          |
| Recurring scheduling CLIs           | Task 10                         |
| README / regression / real-data     | Tasks 11–13                     |




## Placeholder / safety scan

No TBD remains for:

- hard global quota mechanism
- per-run / per-source reservation
- same-participant race behavior
- scheduler lease formula/default (60m default; strict `>` over 55m minimum under Task 3 defaults)
- owner-safe tick ordering
- stale-owner behavior
- async CollectorRun expansion-counter semantics
- per-match fixed-window reprocess-safe semantics
- lifetime window ordering uses only immutable match identity keys (`externalAccountId`, `participantId`)

Residual only: shared account-upsert file placement (behavior locked).

## Type consistency notes

- Enrollment source: `MATCH_PARTICIPANT`
- Budget field: `matchParticipantEnrolledCount`
- Depth field: `discoveryDepth`
- Job field: `sourceCollectorRunId`
- Persisted scheduler outcomes: `TRIGGERED`  `SKIPPED_BACKPRESSURE`  `SKIPPED_COOLDOWN`  `FAILED_TO_START`
- Local-only outcomes: `SKIPPED_DISABLED`  `SKIPPED_OVERLAP`
