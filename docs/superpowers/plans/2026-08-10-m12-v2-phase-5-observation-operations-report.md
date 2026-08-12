# M12-v2 Phase 5 Report — Observation-Scale Continuous Operations

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2`  
**Decision:** `READY_FOR_M12_V2_PHASE_6`

---

## Scheduler audit (Task 1)

| Check | Finding |
| ----- | ------- |
| Default enable | `COLLECTOR_SCHEDULER_ENABLED` defaults **false**; `readCollectorSchedulerEnabled` re-reads env each tick |
| Boot auto-start | **None.** `CollectorSchedulerService` is Nest-provided but only `collector:scheduler` / `collector:scheduler-trigger` call `runLoop` / `tick`. Module has no `OnModuleInit` scheduling (covered by unit test) |
| Lease | Atomic SQL acquire on `CollectorSchedulerState` singleton; renew during owned tick; release in `finally` |
| Overlap | Second owner gets `SKIPPED_OVERLAP` when lease held |
| Shared Riot cooldown | Preflight skip → `SKIPPED_COOLDOWN` (no `runOnce`) |
| Local scheduler cooldown | Status-mirror after rate-limited run; must not shorten shared floor |
| Backpressure | Skip when `waiting+active+delayed > COLLECTOR_MAX_PENDING_INGESTION_JOBS`; queue probe failure → fail-safe skip |
| HOT/WARM/COLD | Success-path only via `collector-refresh-policy` (enqueuedNewCount + zero-new streak). Not a persisted DB column |
| Expansion / ladder | Defaults off; not touched this phase |

Live disabled tick:

```text
outcome=SKIPPED_DISABLED
```

---

## Observation configuration (Task 2)

Documented in example env only (real `.env` / `apps/api/.env` / `apps/worker/.env` **not** modified).

Recommended developer-key observation profile (process-env overrides):

| Knob | Observation value |
| ---- | ----------------- |
| `COLLECTOR_SCHEDULER_ENABLED` | `true` (window only) |
| `COLLECTOR_SCHEDULE_INTERVAL_MS` | `120000` |
| `COLLECTOR_SCHEDULE_BATCH_SIZE` | `2` |
| `COLLECTOR_SCHEDULE_CONCURRENCY` | `1` |
| `COLLECTOR_SCHEDULE_MAX_MATCHES_PER_PLAYER` | `5`–`20` |
| `COLLECTOR_SCHEDULE_MAX_MATCH_IDS` | `20`–`40` |
| `COLLECTOR_SCHEDULE_MAX_ENQUEUE` | `20` |
| `COLLECTOR_MAX_PENDING_INGESTION_JOBS` | `50` |
| `COLLECTOR_EXPAND_FROM_PARTICIPANTS` | `false` |
| Worker concurrencies | ingest/rank/agg = `1` |

Optional short HOT/WARM/COLD intervals used for multi-tick observation only (`60s` / `120s` / `300s`) — **production COLD policy unchanged** in defaults/examples.

Enablement method used:

1. Process-env overrides on CLI (dotenv does not override existing env)
2. One-shot `pnpm collector:scheduler-trigger` (not long-running loop for most of the window)
3. Worker started with concurrency overrides only

Snapshot helper: `pnpm ops:phase5-observation-snapshot`

---

## Execution window

| Item | Value |
| ---- | ----- |
| DB guard | `league_helper_m12v2` only |
| Window start | `2026-08-11T02:20:06Z` |
| Bounded pipeline focus | HOT refresh `2026-08-11T02:37:35Z` → capture `02:46:02Z` |
| Scheduler ticks attempted | disabled×1 + enabled×6 (3 productive zero-new + 1 HOT wider + 2 empty due to ineligibility) |
| Long-running `collector:scheduler` loop | **not** left running |
| Caps / ladder / expansion / crawler | **not** enabled |

COLD natural wait was abandoned (incorrect multi-hour sleep risk). Validation continued via the already-HOT PRODUCT_SEARCH player after a wider discovery tick.

---

## Product search validation (Task 6)

Tiny path (process-env `COLLECTOR_ENROLL_FROM_SEARCH=true` on CLI only):

```text
player:search:mock --game-name aaqqewdr --tag-line 058 --platform na1 --match-count 5
→ PRODUCT_SEARCH TrackedPlayer created (total tracked 0 → 1)
→ refreshState COMPLETE, queuedMatchCount 0 (already ingested)
```

Flow proven:

Search → PRODUCT_SEARCH enrollment → scheduler refresh → match discovery → (later) ingestion enqueue → rank enrichment jobs → aggregation updates.

No ladder seeding, no participant expansion, no cap increases.

---

## Refresh

| Metric | Observation window | HOT pipeline run `8f21f8f9…` |
| ------ | ------------------ | ---------------------------- |
| Players claimed | 3 successful zero-new + 1 HOT wider | 1 |
| Successful refreshes | 4 / 4 attempted productive claims | 1 / 1 |
| Failed refreshes | 0 | 0 |
| Refresh success rate | **100%** | **100%** |
| HOT/WARM/COLD | After 3× zero-new → COLD (priority 10); after HOT wider enqueue → **HOT** (priority 100, streak 0) | HOT |

Empty ticks while ineligible (`claimed=0`) are expected cadence behavior, not failures.

---

## Match ingestion

HOT wider discovery run (`maxMatches=20`):

| Metric | Value |
| ------ | ----- |
| Match IDs discovered | 20 |
| Jobs / matches enqueued | **15** |
| Skipped already-complete | **5** (duplicate handling) |
| Ingestion durable status | all window matches **COMPLETED** (38 total; +15 vs baseline 23) |
| Ingestion BullMQ waiting/active/delayed after drain | **0 / 0 / 0** |
| Orphan failed set (pre-existing Phase 1 Redis hygiene) | 30 (unchanged; not grown) |

Unique match yield for HOT run: **15 enqueued / 1 refreshed player**.

---

## Rank enrichment

| Metric | Value |
| ------ | ----- |
| Jobs created (ingestion-hook) | yes (`reason=MATCH_INGESTION`) |
| Completed (BullMQ cumulative) | 143 (baseline 71 → +72) |
| Delayed at capture | **33** (shared cooldown deferrals) |
| Failed | 0 |
| Avg enrichment lag (resolved in window) | **~3.08s** (p50 **3.45s**; n=118) |
| RESOLVED_RANKED (global eligible) | 184 |
| RESOLVED_UNRANKED | 2 |
| PENDING | 32 |
| FAILED_RETRYABLE | 2 |
| FAILED_PERMANENT | 0 |

Important: new unresolved samples after ingest are **expected**. Jobs defer with `SHARED_COOLDOWN_ACTIVE` and `riotCalled=false` (no Riot storm). Delay is capped by `PARTICIPANT_RANK_ENRICHMENT_BACKOFF_MAX_MS` (60s), so jobs re-wake periodically until the shared floor expires — noisy but bounded, not an unbounded queue growth.

At capture: shared cooldown **active**, remaining ≈ **413s** (~7 min). Residual PENDING should continue resolving asynchronously after cooldown ends. Capture was not held for full drain (per “no long COLD wait” direction).

---

## Riot API / cooldown

| Signal | Observation |
| ------ | ----------- |
| Auth failure | none |
| Collector `rateLimitStops` | 0 on all observed runs |
| Shared cooldown | **activated** during/after HOT ingest burst (15-min floor) |
| Enrichment under cooldown | defer-only; zero Riot calls while active |
| Snapshot parser note | first draft incorrectly treated Redis value as JSON; fixed to epoch-ms string |

---

## Queue health (end of bounded capture)

| Queue | waiting | active | delayed | failed |
| ----- | ------- | ------ | ------- | ------ |
| match-ingestion | 0 | 0 | 0 | 30 (orphan baseline) |
| participant-rank-enrichment | 0 | 0 | 33 | 0 |
| champion-aggregation | 0 | 0 | 0 | 0 |

No uncontrolled match-ingestion backlog. Enrichment delayed set is finite and cooldown-gated.

---

## Coverage velocity

Baseline → final (full Phase 5 observation, not tracked-player-count success):

| Metric | Delta |
| ------ | ----- |
| Matches total / completed | **+15** |
| Rank-resolved samples | **+116** |
| Champion aggregates | **+307** |
| Tracked players | +1 (PRODUCT_SEARCH only) |
| Unique match yield (HOT run) | **15 / player** |
| Matches/day equivalent | not claimed as production rate — window is minutes-scale observation |

100% rank coverage from Phase 4 did **not** persist after new ingest (correctness ≠ coverage). Health moved to `HEALTHY_ISH` with pending async residual — expected.

---

## Data quality (rank health)

Command: `pnpm aggregates:rank-enrichment-health -- --json --platform na1 --queue 420`

| Metric | After bounded HOT pipeline |
| ------ | -------------------------- |
| eligibleRankedParticipants | 220 |
| exactRankCoverage | **83.6%** |
| rankResolutionCoverage | **84.5%** |
| health | **HEALTHY_ISH** |
| PENDING | 32 |
| FAILED_RETRYABLE | 2 |
| FAILED_PERMANENT | 0 |
| permanentUnavailableSampleCount | 0 |
| UNKNOWN collapse | **not observed** |

---

## Aggregate updates

Champion aggregate rows: **308 → 615** (+307) after HOT ingest + enrichment/aggregation chain. Aggregation queue completed additional jobs (23 → 35 completed cumulative in Redis counts).

---

## Tests (Task 10)

```text
API: collector-scheduler / collector.config / refresh-policy / player-search.enrollment
WORKER: participant-rank-enrichment + match-ingestion.processor + champion-aggregation.service + rank-enrichment-health
→ worker suite 9 files / 63 tests passed
API + worker typecheck → exit 0
```

No frontend suites run.

---

## Files changed (Phase 5)

### New

- `apps/api/scripts/phase5-observation-snapshot.mjs`
- `apps/api/scripts/phase5-list-accounts.mjs` (ops helper; no PUUID)
- `apps/api/scripts/phase5-tracked-eligibility.mjs` (ops helper)
- `apps/api/scripts/phase5-queue-probe.mjs` (ops helper)
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-5-observation-operations-report.md`

### Modified

- `.env.example` (observation profile docs; scheduler remains default false)
- `apps/api/.env.example` (same)
- `apps/worker/.env.example` (observation concurrency notes)
- `package.json` (`ops:phase5-observation-snapshot`)

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Cap increases, ladder waves, crawler, lower-tier acquisition
- Frontend / matchups
- Git commit

---

## Closure validation — residual async enrichment drain

**When:** 2026-08-11 (post observation capture)  
**Method:** Wait for existing shared Riot cooldown to expire naturally; then run worker at observation concurrency (1) only. No cooldown/retry/concurrency logic changes. No population scaling / ladder.

### Pre-closure (cooldown still active)

| Signal | Value |
| ------ | ----- |
| Shared cooldown | active (`remainingMs` ≈ 183s at pre-check) |
| Enrichment delayed | 33 |
| Enrichment waiting/active | 0 / 0 |
| PENDING | 32 |
| FAILED_RETRYABLE | 2 |
| exactRankCoverage | 83.6% |
| rankResolutionCoverage | 84.5% |
| health | `HEALTHY_ISH` |

### Natural cooldown expiry

Waited ~203s (remaining + buffer). No Redis key clearing, no env edits.

| Signal | After natural expiry (worker still stopped) |
| ------ | --------------------------------------------- |
| Shared cooldown | **inactive** (`remainingMs=0`) |
| Enrichment delayed | 33 (held until a consumer runs) |
| PENDING | 32 (unchanged until drain) |

### Post-drain (worker started only after cooldown expired)

| Signal | Final |
| ------ | ----- |
| Enrichment waiting/active/delayed | **0 / 0 / 0** |
| Enrichment completed (BullMQ) | 143 → **176** (+33) |
| Enrichment failed | **0** |
| PENDING | **0** |
| FAILED_RETRYABLE | **0** (decreased; no growth) |
| FAILED_PERMANENT | 0 |
| RESOLVED_RANKED | 215 |
| RESOLVED_UNRANKED | 5 |
| exactRankCoverage | **97.7%** |
| rankResolutionCoverage | **100%** |
| health | **MATURE** |
| Shared cooldown after drain | inactive |
| Manual intervention | **none** |

Command: `pnpm aggregates:rank-enrichment-health -- --json --platform na1 --queue 420`

Closure confirms residual unresolved samples resolve asynchronously after shared cooldown without operator mutation.

---

## Remaining Phase 6 work

Explicitly **not started**:

> Population scaling and representative acquisition (apex correction, D/E/P, Gold, S/B/I waves, cap increases, continuous crawler).

Optional later (not blocking Phase 6 approval): enrichment defer delay wake churn under max-backoff cap while a long shared floor is active — measure-only; do not optimize here.

---

## Decision

**`READY_FOR_M12_V2_PHASE_6`**

Rationale:

- Scheduler lease / disable / cadence / duplicate skip / HOT refresh path work on existing tiny population
- PRODUCT_SEARCH → refresh → ingest → enrichment → aggregates pipeline verified on a bounded HOT run
- Shared Riot cooldown correctly suppressed enrichment Riot calls during the active floor
- Closure: after natural cooldown expiry, delayed enrichment drained to empty; PENDING → 0; FAILED_RETRYABLE did not grow (ended at 0); exact/resolution coverage recovered to **97.7% / 100%** (`MATURE`) with no manual intervention
- Population scaling / ladder waves remain off

Do **not** begin Phase 6 until explicit approval.
