# Milestone 9 Task 4 Design: Recurring Collection + Bounded Population Expansion

**Date:** 2026-08-07
**Status:** Draft — revised concurrency/semantics (awaiting re-review)
**Branch:** `milestone-9-task-4-population-expansion`
**Base:** `b1e1781` (merge of PR #2 — Task 3 population collector)
**Depends on:** Milestone 9 Task 3 (`3417043` foundation + `032a2e0` participant identity repair)
**Plan:** `docs/superpowers/plans/2026-08-07-milestone-9-task-4-population-expansion.md`

---

## 1. Goal and non-goals

### Goal

Task 3 answered: *Given a bounded set of known players, can we safely run collection manually?*

Task 4 answers: *Can the system safely keep that population refreshed and grow it in a controlled way without an operator manually seeding every player or manually invoking every run?*

Task 4 introduces:

1. Recurring collection scheduling over existing `PopulationCollectorService.runOnce`
2. Database-authoritative overlap prevention for scheduled execution
3. Bounded participant-based population expansion (optional, off by default)
4. Explicit discovery depth
5. Strict **race-safe** population growth quotas and an autonomous-growth cap
6. Allowlist + queue-420 restrictions for expansion
7. Ingestion queue backpressure protection for scheduled runs
8. Scheduler observability and safe pause/disable via config
9. Operational validation that automatic runs remain bounded

### Critical safety invariant

The population must **never** grow without explicit bounds.

A single high-volume match must not recursively become an unbounded crawl.

**Prohibited pattern:**

```text
participant → enroll → immediately fetch matches → enroll participants → …
```

**Required pattern:**

```text
scheduled/manual trigger
  → PopulationCollectorService.runOnce
  → bounded TrackedPlayer claims
  → existing discovery/enqueue
  → existing match-ingestion
  → (optional) bounded participant enrollment
  → newly enrolled players wait for later bounded collector runs
```

Participant discovery must **not** recursively execute collection immediately. Newly enrolled participants become normal `TrackedPlayer` rows and are processed only by later bounded `runOnce` waves.

### Non-goals

- OP.GG-scale crawling / unlimited graph traversal
- Unrestricted participant enrollment
- Ladder / rank-list / Riot leaderboard scraping
- Web scraping or mainland China Riot infrastructure
- Public collector or scheduler REST endpoints
- Nuxt collector admin UI
- Per-user collection scheduling
- ML/AI player selection or champion-targeted crawling
- Dynamic lowering of the public ranking sample floor
- Changes to ranking or aggregation formulas
- Direct `Match` / `ChampionAggregate` writes from population discovery
- A second match-ingestion pipeline
- Kubernetes / production orchestration work
- Generalized workflow engine
- Full social/discovery graph tables (`ParticipantDiscoveryEdge`, `PlayerGraphEdge`, `CollectorRunPlayer`)
- Process-local mutexes for distributed safety

### Preserve

- Task 3 manual CLIs and `runOnce` safety rules (budgets, leases, rate-limit stop, **Task 3 counter invariants**)
- Task 2 discovery/enqueue + durable ingestion + champion aggregation path
- Product search / bootstrap success when optional enrollment fails
- Ranking floor (`CHAMPION_AGGREGATION_MIN_SAMPLE`) unchanged
- Classic `Jade_*` / ID ≥ 60000 public visibility filter
- No frontend Riot calls
- First `enrollmentSource` immutability

---

## 2. Existing architecture (inspected)

```text
apps/api (Nest)
  CollectorModule / CollectorEnrollmentModule
  PopulationCollectorService.runOnce / preview
  TrackedPlayer + CollectorRun (PostgreSQL)
  PlayerMatchDiscoveryService (PLAYER_ACCOUNT mode for collector)
  MatchIngestionProducer → durable IngestionJobRecord + BullMQ match-ingestion

apps/worker (non-Nest)
  match-ingestion consumer → normalize → persist → COMPLETED
  enqueueAggregationSafe (post-success, non-fatal)
  champion-aggregation consumer

No existing BullMQ repeatable/cron collector scheduler.
Normal `pnpm --filter @league-helper/api dev` must not start crawling.
```

### Identity facts used by this design

| Source | Fields available |
| ------ | ---------------- |
| `PlayerAccount` | `provider`, `externalAccountId` (PUUID), `platformRoute`, `regionalRoute`, `currentGameName`, `currentTagLine` |
| `MatchParticipant` (normalized) | `externalAccountId` (PUUID), `riotIdGameName`, `riotIdTagLine`, optional `playerAccountId` |
| `Match` | `queueId`, `platformRoute`, `regionalRoute`, `ingestionStatus` |

`upsertPlayerAccount` requires non-empty PUUID + platform + regional + gameName + tagLine. It does **not** require Account-v1 when those fields are already known.

Task 4 participant expansion therefore:

- **Does not** call Account-v1 for every participant when identity is complete in normalized data
- **Skips** participants with incomplete identity (no Riot resolve fallback in Task 4)
- Creates/links `PlayerAccount` then enrolls `TrackedPlayer`

---

## 3. Architecture decisions (locked for review)

### 3.1 Scheduler architecture — Option B (dedicated Nest CLI process)

**Chosen:** Explicit long-running Nest application-context process:

```bash
pnpm collector:scheduler
```

implemented as `apps/api/src/features/collector/cli/scheduler.ts` (same bootstrap pattern as `collector:run`).

| Option | Verdict |
| ------ | ------- |
| A. BullMQ repeatable trigger | Rejected as primary owner: still needs a Nest consumer for `runOnce`; adds queue machinery without removing process-boundary complexity |
| **B. Dedicated scheduler process** | **Chosen** — smallest design that reuses Nest collector services, does not start on API boot, matches existing CLI ops model |
| C. Worker-owned scheduler | Rejected: `apps/worker` is non-Nest and has no collector module; pulling Nest into worker is a larger boundary change |
| D. PostgreSQL-only loop without Nest | Rejected: would reimplement/duplicate `runOnce` orchestration |

**Properties:**

- `COLLECTOR_SCHEDULER_ENABLED=false` by default
- Cadence configurable (`COLLECTOR_SCHEDULE_INTERVAL_MS`)
- Each successful trigger calls **exactly** `PopulationCollectorService.runOnce` (no duplicate orchestration)
- Manual `collector:run` remains independent
- Safe SIGINT/SIGTERM shutdown (finish or abandon current tick cleanly; owner-protected lease release)
- Observable failures; no infinite retry storm

**Process boundary rule:** importing `CollectorModule` into `AppModule` must **not** start the scheduler. Only `collector:scheduler` (and optional one-shot trigger CLI) starts scheduling.

### 3.2 Overlap prevention — PostgreSQL singleton scheduler lease

**Chosen:** Single-row `CollectorSchedulerState` table (singleton id) with TTL lease ownership. Not Redis. Not `TrackedPlayer` leases. Not process-local mutexes.

| Mechanism | Verdict |
| --------- | ------- |
| PostgreSQL advisory lock only | Recoverable on connection drop, but weak ops visibility; rejected as sole mechanism |
| **Singleton lease row + hard min TTL** | **Chosen** — multi-process safe, crash-recoverable via expiry, status/audit visible, TTL covers worst-case `runOnce` |
| Partial unique RUNNING on CollectorRun | Insufficient alone |
| In-memory mutex | Rejected |

#### Lease duration invariant (hard)

Task 3 worst-case bounded wall time for a scheduled `runOnce`:

```text
minimumSchedulerLeaseMs =
  ceil(scheduleBatchSize / scheduleConcurrency)
  * collectorPlayerTimeoutMs
  + COLLECTOR_SCHEDULER_LEASE_SAFETY_MARGIN_MS
```

With Task 3 defaults (`batch=10`, `concurrency=2`, `playerTimeout=10m`) and safety margin default `5m`:

```text
minimumSchedulerLeaseMs = ceil(10/2) * 10m + 5m = 55m
```

**Validation (reject at config load) — keep strict `>`:**

```text
COLLECTOR_SCHEDULER_LEASE_MS > minimumSchedulerLeaseMs
```

Exact equality with the derived minimum is **rejected**. Unsafe combinations of lease/batch/concurrency/timeout must fail fast — do not silently clamp the lease downward.

**Default:** `COLLECTOR_SCHEDULER_LEASE_MS = 3600000` (60m).

With defaults: `minimum = 55m`, `lease = 60m` → validation passes (`60m > 55m`).

Renewal remains **defense-in-depth** (timer ≤ ½ lease TTL, owner-protected). A single missed renewal must **not** make a normal bounded run immediately unsafe: the initial TTL already covers the worst-case `runOnce` wall time plus margin.

#### Lease semantics

| Concern | Rule |
| ------- | ---- |
| **Owner identity** | `leaseOwner = randomUUID()` per tick attempt. Persist `leaseOwner`, `leaseExpiresAt`. Optional hostname/pid are diagnostic only. |
| **Acquisition** | Conditional update: acquire only if `leaseOwner IS NULL OR leaseExpiresAt < now()`. Set owner + `leaseExpiresAt = now() + COLLECTOR_SCHEDULER_LEASE_MS`. No row → `SKIPPED_OVERLAP` (local result only; see §9). |
| **Renewal** | Owner-protected: `WHERE leaseOwner = $owner`. Extends `leaseExpiresAt`. Stale owner renew is a no-op. |
| **Release** | Owner-protected clear: `WHERE leaseOwner = $owner`. Stale owner release is a no-op. |
| **Outcome / cooldown / trigger records** | Owner-protected while lease held (see §9). |
| **Stale recovery** | Expired lease reclaimable by any replica. |
| **Crash semantics** | Process kill leaves lease until TTL → peers `SKIPPED_OVERLAP` until expiry → automatic recovery. |
| **Emergency stop** | Stop process and/or `COLLECTOR_SCHEDULER_ENABLED=false` — not lease-row edits. |

Manual `collector:run` does **not** take the scheduler lease. Player leases still serialize per-player processing.

### 3.3 Participant expansion insertion point

**Chosen:** Worker post-success hook beside `enqueueAggregationSafe`, after match is durably `COMPLETED` (and on the `already_complete` linkage path).

```text
persist + timeline → Match.ingestionStatus = COMPLETED
  → durable job COMPLETED
  → enqueueAggregationSafe (existing, non-fatal)
  → expandMatchParticipantsSafe (new, non-fatal)
  → cache invalidation (existing)
```

Requirements:

- Match persistence success remains authoritative
- Expansion errors are warnings only
- No rollback of successful Match because expansion failed
- No extra match-ingestion retries solely because expansion failed
- No Riot network calls inside the main persistence transaction
- No Account-v1 calls in the default expansion path

### 3.4 Cross-process enrollment strategy

Worker cannot import Nest `CollectorEnrollmentService`.

**Chosen approach:**

1. Keep Nest enrollment for admin seed / search / bootstrap in `apps/api`
2. Implement worker-side pure Prisma expansion module that:
   - loads expansion config (same env knobs / caps)
   - upserts `PlayerAccount` using the same identity rules as `PlayerAccountRepository.upsertPlayerAccount` (extracted shared helper **or** carefully mirrored worker helper — plan prefers minimal churn)
   - creates `TrackedPlayer` via **atomic quota-reservation transactions** (§8)
3. Extend API `TrackedPlayerRepository.upsertEnrollment` for depth semantics so Nest enrollment paths apply depth-0 rooting **without** consuming participant-expansion budget

Avoid a second BullMQ “expansion queue” in Task 4.

### 3.5 No permanent discovery graph

**Omit** `discoveredFromTrackedPlayerId` and edge tables.

Provenance for Task 4 ops is sufficient via:

- `enrollmentSource = MATCH_PARTICIPANT`
- `discoveryDepth`
- async `CollectorRun` expansion counters (when attributed)
- ephemeral `CollectorRunSourceQuota` budget rows (not a graph)

---

## 4. Config

All new knobs validated with hard caps. Scheduled path must not exceed Task 3 hard caps.

### 4.1 Scheduler

| Env | Default | Notes |
| --- | ------- | ----- |
| `COLLECTOR_SCHEDULER_ENABLED` | `false` | Master enable |
| `COLLECTOR_SCHEDULE_INTERVAL_MS` | `900000` (15m) | Min 60s; hard max 24h |
| `COLLECTOR_SCHEDULE_BATCH_SIZE` | `10` | Clamped to Task 3 batch hard max (50) |
| `COLLECTOR_SCHEDULE_CONCURRENCY` | `2` | Clamped to Task 3 concurrency hard max (5) |
| `COLLECTOR_SCHEDULE_MAX_MATCHES_PER_PLAYER` | `20` | Clamped to Task 3 (100) |
| `COLLECTOR_SCHEDULE_MAX_MATCH_IDS` | `200` | Clamped to Task 3 (1000) |
| `COLLECTOR_SCHEDULE_MAX_ENQUEUE` | `200` | Clamped to Task 3 (1000) |
| `COLLECTOR_SCHEDULER_LEASE_SAFETY_MARGIN_MS` | `300000` (5m) | Used in minimum lease formula |
| `COLLECTOR_SCHEDULER_LEASE_MS` | `3600000` (60m) | **Must be >** `ceil(batch/concurrency)*playerTimeoutMs + safetyMargin` (defaults: 60m > 55m) |
| `COLLECTOR_SCHEDULER_RATE_LIMIT_COOLDOWN_MS` | `900000` (15m) | Floor cooldown after RATE_LIMITED run |
| `COLLECTOR_MAX_PENDING_INGESTION_JOBS` | `500` | Backpressure threshold |
| `COLLECTOR_SCHEDULE_QUEUE_ID` | `420` | Scheduled runs only enqueue this queue |
| `COLLECTOR_SCHEDULE_PLATFORM` | empty → allowlist default | Optional single-platform filter |

`collectorPlayerTimeoutMs` in the lease formula is the Task 3 `COLLECTOR_PLAYER_TIMEOUT_MS` value (default 10m).

Scheduled `runOnce` inputs are built from schedule knobs and still pass through the same `runOnce` safety rules / Task 3 config for refresh/backoff/player-lease/allowlist.

### 4.2 Expansion

| Env | Default | Hard bound |
| --- | ------- | ---------- |
| `COLLECTOR_EXPAND_FROM_PARTICIPANTS` | `false` | — |
| `COLLECTOR_EXPANSION_MAX_DEPTH` | `1` | hard max `3` |
| `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH` | `3` | hard max `9` |
| `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER` | `5` | hard max `50` |
| `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN` | `20` | hard max `200` |
| `COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS` | `500` | hard max `5000` — autonomous MATCH_PARTICIPANT budget (§8) |
| `COLLECTOR_EXPANSION_QUEUE_ID` | `420` | only this queue expands |

When `COLLECTOR_EXPAND_FROM_PARTICIPANTS=false`:

- zero expansion-specific DB reads/writes beyond existing ingestion
- zero additional Riot requests
- zero new `TrackedPlayer` rows from participants
- no product behavior change

Environment configuration must not remove all bounds (hard caps always apply).

---

## 5. Schema changes (additive only)

### 5.1 Enum

```text
TrackedPlayerEnrollmentSource += MATCH_PARTICIPANT
```

Additive migration. Existing rows unchanged. No backfill.

### 5.2 `TrackedPlayer`

| Field | Type | Default | Notes |
| ----- | ---- | ------- | ----- |
| `discoveryDepth` | `Int` | `0` | Explicit graph depth; not inferred from source |

Optional index on `discoveryDepth` for status group-by.

### 5.3 `CollectorRun` additive counters (default 0)

| Field | Class | Meaning |
| ----- | ----- | ------- |
| `participantsConsidered` | **Task 4 async** | Candidates examined for expansion attributed to this run |
| `playersEnrolledFromParticipants` | **Task 4 async** + **reservation counter** | New MATCH_PARTICIPANT creates attributed to this run |
| `playersAlreadyTrackedFromParticipants` | **Task 4 async** | Already tracked (incl. depth-only updates) |
| `playersSkippedDepthLimit` | **Task 4 async** | Skipped for depth |
| `playersSkippedPopulationCap` | **Task 4 async** | Skipped for autonomous population budget |

See §8.5 for async semantics vs Task 3 finalized counters.

### 5.4 `CollectorPopulationBudget` (singleton — autonomous growth)

| Field | Notes |
| ----- | ----- |
| `id` | Constant `'singleton'` |
| `matchParticipantEnrolledCount` | Reserved/committed count of successful MATCH_PARTICIPANT creates |
| `updatedAt` | Standard |

Seeded once in migration (`INSERT … ON CONFLICT DO NOTHING` with count `0`).

This counter — **not** `COUNT(TrackedPlayer)` check-then-insert — is the race-safe global autonomous-growth bound.

### 5.5 `CollectorSchedulerState` (singleton)

| Field | Notes |
| ----- | ----- |
| `id` | Constant `'singleton'` |
| `leaseOwner` | Nullable |
| `leaseExpiresAt` | Nullable timestamptz |
| `lastTriggerAt` | Nullable — written only by active owner |
| `lastOutcome` | `TRIGGERED` \| `SKIPPED_BACKPRESSURE` \| `SKIPPED_COOLDOWN` \| `FAILED_TO_START` (and optionally other **owner-recorded** outcomes). Losers do **not** write `SKIPPED_OVERLAP` / `SKIPPED_DISABLED` into this row. |
| `lastCollectorRunId` | Nullable |
| `lastErrorCode` | Nullable short code |
| `cooldownUntil` | Nullable; rate-limit cooldown — owner-protected writes |
| `updatedAt` | Standard |

No fake `CollectorRun` rows for skipped triggers.

### 5.6 `CollectorRunSourceQuota` (ephemeral per-source-per-run budget)

**Not a graph table.** Budget accounting only.

| Field | Notes |
| ----- | ----- |
| `id` | UUID PK |
| `collectorRunId` | FK → `CollectorRun.id` **ON DELETE CASCADE** |
| `sourceTrackedPlayerId` | FK → `TrackedPlayer.id` **ON DELETE CASCADE** |
| `newPlayersEnrolled` | Int default 0 — reservation counter |
| `@@unique([collectorRunId, sourceTrackedPlayerId])` | |

Deletion behavior:

- Deleting a `CollectorRun` removes its quota rows (ephemeral).
- Deleting a `TrackedPlayer` removes quota rows referencing it (cleanup; TrackedPlayer delete remains rare/RESTRICT from PlayerAccount in Task 3).

### 5.7 Match ingestion attribution (additive payload field)

```ts
sourceCollectorRunId?: string // uuid
```

Collector enqueue path sets it when present. Bootstrap/search omit it.

If the referenced run is **missing** at expansion time: expansion remains non-fatal and uses **un-attributed** quota policy (global budget + per-match only; no per-run / per-source reservations; do not fail ingestion).

---

## 6. Depth model

```text
0 = explicitly enrolled root (ADMIN_SEED / PRODUCT_SEARCH / BOOTSTRAP)
1 = participant discovered from a depth-0 tracked player
2 = participant discovered from depth-1
… up to configured max (hard ≤ 3)
```

### Rules

1. Do **not** infer depth from `enrollmentSource`.
2. New MATCH_PARTICIPANT enrollments set `discoveryDepth = sourceTrackedPlayer.discoveryDepth + 1`.
3. Re-discovery / re-enrollment: `discoveryDepth = min(existing, newlyDiscoveredDepth)`.
4. Never increase depth because a deeper parent rediscovered the player.
5. Explicit enrollment paths (seed / search / bootstrap) propose depth `0`. On existing rows: `discoveryDepth = min(existing, 0) = 0` **without** changing immutable `enrollmentSource` and **without** consuming participant-expansion budget.
6. If `sourceDepth + 1 > COLLECTOR_EXPANSION_MAX_DEPTH`, skip enrollment (`playersSkippedDepthLimit`).
7. Negative depth is invalid (audit finding); inserts must use `>= 0`.

### Source player for a match

Expansion runs only when `requestedByPlayerAccountId` resolves to an existing `TrackedPlayer`. Otherwise skip expansion for that match.

Child depth uses that source tracked player's current `discoveryDepth`.

---

## 7. Participant selection (deterministic, reprocess-safe)

### 7.1 Meaning of `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH` (locked)

This cap means: **one Match may contribute at most N deterministic participant identities across repeated/retried expansion processing**, not “N new creates per invocation.”

Without this, `already_complete` reprocessing or retries could gradually enroll all nine other participants by advancing past already-tracked candidates.

**No `MatchExpansion` table** (or other per-match persistence) is required. The lifetime window is a **pure function of stable normalized match identity data**.

### 7.2 Pipeline order (locked)

```text
stable Match / MatchParticipant identity inputs
  → filter (stable identity / match-context only)
  → sort (immutable keys only)
  → take fixed window of size N
  → THEN inspect current TrackedPlayer / account / depth state
  → already_tracked | depth-min | create reservation | skip
```

**Not:**

```text
current DB linkage/tracked state → sort/filter → window
```

### 7.3 Pre-window filter (stable inputs only)

Match-level gates (stable for the persisted match row used by expansion):

- Match `queueId === COLLECTOR_EXPANSION_QUEUE_ID` (default 420)
- Match `platformRoute` parseable and ∈ `COLLECTOR_PLATFORM_ALLOWLIST`
- Provider supported (`RIOT`)

Per-participant gates derived from **normalized `MatchParticipant` fields persisted for that match** (not live account/linkage state):

- `externalAccountId` present (PUUID)
- `riotIdGameName` + `riotIdTagLine` present (required for Account-v1-free upsert)
- Not the source tracked player's `externalAccountId`
- Not otherwise malformed empty/whitespace identity fields

**Must not participate in pre-window filter or ordering** (mutable application / post-ingest state):

- `playerAccountId` linkage
- whether `TrackedPlayer` already exists
- `enrollmentSource`
- `discoveryDepth` (source or candidate)
- current Riot ID from `PlayerAccount` (display updates)
- rank/tier
- other account metadata updated after ingestion

Depth limits and already-tracked checks run **after** the fixed window is selected (§7.5).

### 7.4 Fixed consideration window ordering (immutable only)

1. Apply §7.3 filter to persisted match participants.
2. Sort remaining candidates using **only**:
   - `externalAccountId` ascending
   - `participantId` ascending (deterministic tie-break; unique within a persisted match)
3. Take the first `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH` candidates — this is the lifetime window.
4. **Only** candidates in that window may be enrolled from this match.
5. On reprocessing, the same normalized participant identity set must yield the **same** window identity set. Already-tracked members remain in the window and **do not** advance selection to later candidates.

Rejected (not reprocess-safe): preferring linked `playerAccountId` first — linkage can appear later via another match, search, bootstrap, repair, or persistence and reorder the window (e.g. `D,A,B` → `C,D,A`, exposing previously excluded `C`).

Example (`cap=3`, after immutable sort eligible = `A,B,C,D,E,F` by `externalAccountId` / `participantId`):

| Processing | Linkage / tracked mutations | Window identities |
| ---------- | --------------------------- | ----------------- |
| First | all `playerAccountId=null` | `A,B,C` |
| Later | arbitrary linkage on `A..F`; `A/B/C` tracked | still `A,B,C` |
| Never | — | `D/E/F` become newly window-eligible solely due to linkage/tracked changes |

### 7.5 Post-window evaluation

For each identity in the fixed window, inspect **current** application state:

1. If `TrackedPlayer` exists → `already_tracked` (depth-min allowed; no quota)
2. Else if `source.discoveryDepth + 1 > maxDepth` → `skipped_depth_limit` (no create)
3. Else attempt quota reservation + create (§8)

### 7.6 Interaction with quotas

- Quota reservation (global / per-run / per-source) occurs **only for actual new creates**.
- Already-tracked window candidates consume **no** global/run/source quota.
- Candidates outside the window are never enrolled from this match, even if the entire window is already tracked.

No randomness. No AI. No champion preference. No extra ranked Riot calls for selection.

### Expansion outcomes (per window candidate)

| Outcome | Effect |
| ------- | ------ |
| created | new TrackedPlayer; consumed reserved quota slots |
| already_tracked | depth `min` only; **no** quota consumption; **still occupies window slot** |
| skipped_depth_limit / skipped_*cap / … | post-window decision; does not resize/reorder the window |

---

## 8. Quota model — atomic transactional reservation

### 8.0 Rejected approach

```text
COUNT(TrackedPlayer) < cap  +  unique(playerAccountId)
```

is **not** race-safe for distinct identities (two workers can both observe `count=499` and insert different players → `501`). The same check-then-write race applies to naive per-run / per-source reads.

Process-local mutexes are forbidden.

### 8.1 Cap policy (locked)

| Cap | Applies to | Mechanism |
| --- | ---------- | --------- |
| Global autonomous growth | **MATCH_PARTICIPANT creates only** | `CollectorPopulationBudget.matchParticipantEnrolledCount` atomic increment |
| Per-run | Attributed MATCH_PARTICIPANT creates | Guarded increment of `CollectorRun.playersEnrolledFromParticipants` |
| Per-source-per-run | Attributed creates from one source | Guarded increment of `CollectorRunSourceQuota.newPlayersEnrolled` |
| Per-match | At most N deterministic identities **per Match across reprocessing** | Fixed consideration window of size N (§7); not per-invocation create count |

**Manual `ADMIN_SEED` / `PRODUCT_SEARCH` / `BOOTSTRAP` enrollment is NOT blocked by and does NOT consume** `CollectorPopulationBudget`. Operators may seed above the autonomous cap intentionally. Status reports both total `TrackedPlayer` count and autonomous budget usage.

### 8.2 Create path (attributed) — one short PostgreSQL transaction

Preconditions outside the TX (idempotent / non-quota):

1. Expansion enabled, queue/platform/depth/identity checks
2. Upsert `PlayerAccount` if needed (no quota)
3. If `TrackedPlayer` already exists for `playerAccountId` → `already_tracked` depth-min update only (no budget TX)

For a **new** create attempt:

```text
BEGIN

-- A) global autonomous budget reservation
UPDATE "CollectorPopulationBudget"
SET "matchParticipantEnrolledCount" = "matchParticipantEnrolledCount" + 1,
    "updatedAt" = now()
WHERE id = 'singleton'
  AND "matchParticipantEnrolledCount" < :globalCap
RETURNING *;
-- 0 rows → ROLLBACK → skipped_population_cap

-- B) per-run reservation (attributed + run exists)
UPDATE "CollectorRun"
SET "playersEnrolledFromParticipants" = "playersEnrolledFromParticipants" + 1,
    "updatedAt" = now()
WHERE id = :runId
  AND "playersEnrolledFromParticipants" < :runCap
RETURNING *;
-- 0 rows → ROLLBACK → skipped_run_cap (or treat missing run as un-attributed — see below)

-- C) per-source-per-run reservation
-- insert quota row if needed, then:
UPDATE "CollectorRunSourceQuota"
SET "newPlayersEnrolled" = "newPlayersEnrolled" + 1,
    "updatedAt" = now()
WHERE "collectorRunId" = :runId
  AND "sourceTrackedPlayerId" = :sourceId
  AND "newPlayersEnrolled" < :sourceCap
RETURNING *;
-- 0 rows → ROLLBACK → skipped_source_cap

-- D) TrackedPlayer INSERT (discoveryDepth, MATCH_PARTICIPANT, …)
-- unique violation on playerAccountId → ROLLBACK entire TX
--   → caller re-reads row → already_tracked (depth-min outside / follow-up)
-- success → COMMIT

COMMIT
```

**Rollback semantics (locked):**

- If any reservation succeeds but `TrackedPlayer` insert resolves as already-exists / unique violation → **ROLLBACK** the transaction so **no** quota increments commit.
- Same-participant concurrent creates: exactly one INSERT wins; the loser rolls back reservations → **at most one quota slot** consumed for that identity.
- Cap N concurrent distinct candidates: committed `matchParticipantEnrolledCount` and corresponding create count finish at **≤ N**, never N+1.

### 8.3 Un-attributed path

Used when `sourceCollectorRunId` is absent **or** the run row is missing:

- Still perform global budget reservation + TrackedPlayer INSERT in one TX
- Skip per-run and per-source reservations
- Per-match local cap still applies
- Non-fatal; never fails match ingestion

### 8.4 Observability counters vs reservation counters

- `playersEnrolledFromParticipants` serves dual duty: reservation counter **and** status metric for attributed creates (atomic increment only on successful committed creates via the TX above).
- `participantsConsidered`, `playersAlreadyTrackedFromParticipants`, `playersSkippedDepthLimit`, `playersSkippedPopulationCap` are **non-reserving** async metrics (atomic `UPDATE … SET col = col + 1` after decisions; may run outside the create TX; best-effort).

### 8.5 Async expansion counter semantics (locked)

`sourceCollectorRunId` is carried on BullMQ jobs. `runOnce` may finalize `CollectorRun` **before** those jobs ingest and expand.

**Task 3 execution counters** (finalized by `runOnce`, retain Task 3 invariants):

- `playersClaimed`, `playersAttempted`, `playersSucceeded`, `playersFailed`, `ownershipLost`
- `matchIdsDiscovered`, `matchesEnqueued`, `matchesSkippedComplete`
- `rateLimitStops`, `budgetExhausted`, `failureCode`, terminal `status` / `finishedAt`

These must **not** be altered by participant expansion.

**Task 4 expansion counters** may legally change **after** `CollectorRun.status` is terminal:

- `participantsConsidered`
- `playersEnrolledFromParticipants`
- `playersAlreadyTrackedFromParticipants`
- `playersSkippedDepthLimit`
- `playersSkippedPopulationCap`

Constraints:

- never affect Task 3 terminal equality (`succeeded + failed + ownershipLost = attempted`)
- never change `CollectorRun.status`
- never imply the participant was collected/refreshed
- owner-independent worker attribution after ingestion
- use atomic increments
- tolerate jobs completing long after CollectorRun finalization

**Audit must NOT** report a finalized CollectorRun as corrupt merely because expansion counters changed after finalization.

### 8.6 Reconciliation / audit for budget counters

Read-only audit findings (no repair in Task 4):

- `CollectorPopulationBudget.matchParticipantEnrolledCount` vs `COUNT(TrackedPlayer WHERE enrollmentSource = MATCH_PARTICIPANT)` drift beyond tolerance `0`
- `CollectorRun.playersEnrolledFromParticipants` vs sum of source quotas for that run (informational drift check)
- Autonomous budget / run / source counters negative (impossible if constraints hold)
- Total MATCH_PARTICIPANT rows above configured hard cap (should be unreachable if reservation works; finding = defect)

---

## 9. Scheduler tick semantics (owner-safe)

### 9.1 Tick algorithm (locked)

```text
loop every COLLECTOR_SCHEDULE_INTERVAL_MS:
  1. Read COLLECTOR_SCHEDULER_ENABLED locally (process.env / config).
     If disabled:
       return SKIPPED_DISABLED
       do NOT mutate CollectorSchedulerState merely to record disabled ticks.
       scheduler-status derives enabled=false from config.

  2. Attempt scheduler lease acquisition (new owner token).
     If acquisition fails:
       return SKIPPED_OVERLAP
       do NOT overwrite fields owned by the active scheduler execution.

  3. Once lease is owned (only winner probes Redis / mutates shared execution state):
       try:
         if cooldownUntil > now → owner-record SKIPPED_COOLDOWN; return
         probe BullMQ match-ingestion counts
           on probe failure → fail-safe owner-record SKIPPED_BACKPRESSURE
             (or FAILED_TO_START + QUEUE_PROBE_FAILED); return
           if pending > max → owner-record SKIPPED_BACKPRESSURE; return
         start lease renewal timer (owner-protected; defense-in-depth)
         runOnce(...)
         owner-record TRIGGERED (+ lastCollectorRunId, lastTriggerAt)
         if rate-limited → owner-set cooldownUntil
       catch → owner-record FAILED_TO_START (+ lastErrorCode)
       finally → stop renewal; owner-protected release
```

Only the winning replica probes BullMQ.

### 9.2 Owner-protected state methods

All mutations of active execution fields require `WHERE leaseOwner = $owner` (and optionally unexpired lease):

| Method | Behavior if owner mismatch / stale |
| ------ | ---------------------------------- |
| `renewLease` | no-op / false |
| `recordTrigger` | no-op / false |
| `recordOutcome` | no-op / false |
| `setCooldown` | no-op / false |
| `releaseLease` | no-op / false |

Losing replicas must not call these against the winner’s ownership. Local return values (`SKIPPED_DISABLED`, `SKIPPED_OVERLAP`) are process-local / logs only.

No separate aggregate skip counter is required for MVP. If one is added later, it must not overwrite active-owner outcome fields.

### 9.3 Outcomes

| Outcome | Who may persist on singleton? | CollectorRun created? |
| ------- | ----------------------------- | --------------------- |
| `TRIGGERED` | Winning owner | Yes (by `runOnce`) |
| `SKIPPED_DISABLED` | **Nobody** (local only) | No |
| `SKIPPED_OVERLAP` | **Nobody** (local only) | No |
| `SKIPPED_BACKPRESSURE` | Winning owner | No |
| `SKIPPED_COOLDOWN` | Winning owner | No |
| `FAILED_TO_START` | Winning owner | No (unless `runOnce` created one — Task 3 finalize rules) |

### 9.4 Backpressure

Performed **only after** lease acquisition by the winner:

```text
pending = waiting + active + delayed  // BullMQ match-ingestion
if pending > COLLECTOR_MAX_PENDING_INGESTION_JOBS → SKIPPED_BACKPRESSURE
```

- Scheduled runs must respect pressure
- Probe failure → fail-safe skip (never flood)
- Manual `collector:run` bypasses pressure by default
- One probe per owned tick

### 9.5 Rate-limit / cooldown

- If finalized scheduled run has `rateLimitStops > 0` (or rate-limit failure): owner-set `cooldownUntil = now + max(COLLECTOR_SCHEDULER_RATE_LIMIT_COOLDOWN_MS, observedRetryAfterMs?)`
- Next winners see cooldown under lease → `SKIPPED_COOLDOWN`
- No immediate replacement run after rate limit
- Per-player TrackedPlayer backoff remains authoritative for claims

### 9.6 Disabled / emergency stop

1. Stop `collector:scheduler` process (strongest)
2. `COLLECTOR_SCHEDULER_ENABLED=false` (ticks become local no-ops; no shared-state spam)
3. Optionally `COLLECTOR_EXPAND_FROM_PARTICIPANTS=false` (worker restart to pick up)

---

## 10. Manual controls / CLIs

| Command | Role |
| ------- | ---- |
| Existing Task 3 CLIs | Unchanged behavior |
| `collector:scheduler` | Long-running scheduler process |
| `collector:scheduler-status` | Config enable flag + `CollectorSchedulerState` + recent runs |
| `collector:scheduler-trigger` | One-shot tick (same owner-safe guards) |

Do not add public HTTP.

---

## 11. Status / audit extensions

### Status (`collector:status`)

- tracked count by `discoveryDepth`
- enrollment counts including `MATCH_PARTICIPANT`
- autonomous budget usage: `matchParticipantEnrolledCount / COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS`
- total `TrackedPlayer` count (may exceed autonomous budget if operators seeded)
- scheduler **enabled from config** (not inferred solely from lastOutcome)
- scheduler lease owner / expiry / last **owner-recorded** outcome / last trigger / cooldown
- expansion counters on recent runs labeled as **async post-finalization metrics**

### Audit (`collector:audit`)

Retain all Task 3 checks (including Task 3 counter equality on finalized runs).

Add:

- negative `discoveryDepth`; depth above hard/configured max
- `CollectorPopulationBudget` drift vs `COUNT(MATCH_PARTICIPANT)`
- autonomous budget / run expansion counters above configured hard caps
- scheduler stale lease (owner set, `leaseExpiresAt` far in the past)
- scheduler ownership inconsistencies (should be impossible with singleton PK)

**Do not** flag finalized CollectorRuns as corrupt solely because Task 4 expansion counters increased after `status` became terminal.

Status/audit remain read-only — never repair tools.

---

## 12. Observability labels

- Collector success = discovery/enqueue orchestration (Task 3)
- Expansion success = bounded enrollment attempts (Task 4 async)
- Coverage = async DB snapshot
- Participant enrolled ≠ participant collected
- Expansion counters on CollectorRun ≠ Task 3 terminal invariants

---

## 13. Testing strategy

### Expansion — unit

- disabled flag → zero expansion writes/Riot
- root depth 0; discovered depth 1; depth limit; min depth; first source preserved
- fixed window size equals `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH`
- same normalized participant set always produces the same candidate identity window
- linkage mutation (`playerAccountId` null ↔ set on arbitrary participants) does **not** change the fixed window
- tracked status does not affect window; later candidates never appear
- depth / status / account metadata changes do not influence ordering
- reprocessing same match does not advance beyond the fixed window
- expansion failure does not fail Match ingestion

### Expansion — real PostgreSQL concurrency (required)

- global autonomous cap with concurrent **distinct** candidates → final count ≤ N, never N+1
- per-run cap with concurrent matches → ≤ run max
- per-source-per-run cap with concurrent matches → ≤ source max
- same-participant race → one TrackedPlayer and **at most one** quota slot consumed (global/run/source)
- reservation + unique violation → rollback leaves counters unchanged
- manual seed still succeeds when autonomous budget is at cap
- missing `sourceCollectorRunId` / missing run → un-attributed path; non-fatal

### Scheduler — config / unit / integration

- unsafe lease/batch/concurrency/timeout config **rejected**
- exact derived minimum lease **rejected** (strict `>`)
- `minimum + 1ms` accepted
- default config (60m lease with Task 3 defaults) accepted
- disabled → no shared-state mutation / no trigger
- losing replica cannot overwrite winner outcome/state
- stale owner cannot renew / release / set terminal outcome
- winning owner can record backpressure/cooldown then release
- expired stale lease reclaimable
- lease renewal owner-protected
- queue pressure skip; pressure clear allows later run
- cooldown after rate-limit
- manual `collector:run` still functions
- scheduler does not start on normal API boot
- shutdown clean

### Migrations

- clean DB applies full migration history
- singleton budget + scheduler rows seedable

---

## 14. Real-data validation (tiny, staged)

| Stage | Setup | Prove |
| ----- | ----- | ----- |
| A | scheduler off, expansion off | no behavior change |
| B | expansion on; depth 1; tiny caps; manual collector one NA1 player; ~5 matches | bounded new TrackedPlayers only |
| C | rerun | no duplicate TrackedPlayer; depth/source rules; quota counters coherent |
| D | enable scheduler; second replica | one owned run; other local SKIPPED_OVERLAP; no outcome clobber |
| E | artificial backlog / low threshold | owner-recorded SKIPPED_BACKPRESSURE |
| F | status + audit + aggregate audit + duplicate checks | clean / explained findings; no false Task 3 counter corruption |

Keep queue 420, platform na1, depth 1, small batches.

---

## 15. Documentation requirements

README must make unmistakable:

- Task 3 = manual bounded collector
- Task 4 = optional scheduling + bounded expansion
- both disabled/safe by default where applicable
- which process owns scheduling (`collector:scheduler`)
- lease TTL invariant vs batch/concurrency/player timeout
- overlap prevention (owner-safe singleton lease)
- ingestion queue backpressure (winner-only probe)
- expansion depth + race-safe quotas / autonomous budget
- async nature of CollectorRun expansion counters
- `MATCH_PARTICIPANT` source; seed not blocked by autonomous cap
- emergency disable
- status/audit commands
- no public UI/API / no unlimited crawler
- Task 4 does not guarantee coverage floor is reached
- downstream ingestion/aggregation remains asynchronous

---

## 16. Success criteria

1. Task 3 manual workflow intact
2. Scheduled collection enableable explicitly
3. Scheduler disabled by default
4. Multiple scheduler replicas cannot overlap scheduled collection (lease TTL covers worst-case run + owner-safe state)
5. Collection pauses under ingestion backpressure (scheduled, owner-probed)
6. Match participants can optionally become TrackedPlayers
7. Participant expansion disabled by default
8. Explicit discovery depth
9. Explicit per-match / per-source / per-run / autonomous global caps that remain hard under concurrency
10. Idempotent under concurrency; unique races do not leak quota
11. Expansion failures never invalidate ingested matches
12. No recursive immediate crawling
13. Status/audit expose unsafe state without false Task 3 finalization corruption
14. No public API/UI collector surface
15. Ranking floor unchanged
16. Existing ingestion/aggregation tests green
17. Controlled real-data validation proves bounded growth

---

## 17. Rollout / phase gates

| Phase | Scope | Gate |
| ----- | ----- | ---- |
| 0 | Spec + plan (this document) | Human review |
| 1 | Schema/config + race-safe expansion domain (no scheduler/hook) | Review |
| 2 | Ingestion hook + PG concurrency proofs + status/audit + async counter semantics | Review |
| 3 | Owner-safe scheduler + lease invariant + backpressure + cooldown | Review |
| 4 | CLIs + docs + regression gates + tiny real-data validation | Review before commit |

---

## 18. Risks and accepted limitations

| Risk | Acceptance |
| ---- | ---------- |
| Incomplete Riot ID on participants → skip | Prefer skip over Account-v1 N+1 |
| Un-attributed expansion weakens per-run metrics | Still hard-bounded by autonomous global + per-match |
| Operator seed can exceed autonomous budget total TrackedPlayers | Intentional; budget caps autonomous growth only |
| Budget counter drift | Audit finding; no auto-repair in Task 4 |
| Worker/API enrollment helper drift | Extract or mirror carefully |
| Ephemeral quota table growth | Fine at Task 4 scale |
| Manual + scheduled concurrent runs | Allowed; player leases serialize; ops guidance to avoid |

---

## 19. Residual non-blocking items

1. Shared upsert helper file placement (behavior locked).
2. Optional hostname/pid on scheduler state.
3. Optional `--respect-backpressure` on manual run.

No open TBD remains for quota races, lease TTL safety, owner-safe scheduler writes, or async expansion-counter semantics.

---

## Appendix A — Locked decisions summary

| Topic | Decision |
| ----- | -------- |
| Scheduler | Dedicated Nest CLI process `collector:scheduler` |
| Overlap | PostgreSQL `CollectorSchedulerState` singleton TTL lease |
| Lease TTL | `leaseMs > ceil(batch/concurrency)*playerTimeout + safetyMargin`; default 60m (min 55m under Task 3 defaults) |
| Per-match cap | Fixed window via `externalAccountId ASC`, `participantId ASC` only; post-window tracked/depth checks; no MatchExpansion table |
| Tick order | Enable local → acquire lease → owner-only cooldown/backpressure/run/outcome → owner release |
| Loser writes | No shared-state overwrite on DISABLED/OVERLAP |
| Expansion hook | Worker post-COMPLETED, non-fatal |
| Identity | Normalized participant fields only; skip incomplete |
| Enrollment source | `MATCH_PARTICIPANT` |
| Depth | `discoveryDepth`; min semantics; explicit enroll roots to 0 |
| Parent edges | None |
| Global cap | `CollectorPopulationBudget` atomic reservation (MATCH_PARTICIPANT only) |
| Per-run / per-source | Guarded increments in same TX as TrackedPlayer INSERT |
| Unique race | ROLLBACK reservations → already_tracked; ≤1 quota slot |
| Seed vs cap | Seed/search/bootstrap not blocked by autonomous budget |
| Expansion counters | Async post-finalization; do not affect Task 3 status/equality |
| Backpressure | Winner-only BullMQ probe; fail-safe skip |
| Public API/UI | None |
| Min sample | Unchanged |
