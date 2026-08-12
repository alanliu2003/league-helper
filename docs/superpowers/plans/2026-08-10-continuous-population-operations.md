# Milestone 12 (v2) Implementation Plan: Continuous Population Operations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task after Phase 0 approval. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Hard rule for this restart:** RANK CORRECTNESS BEFORE POPULATION SCALING. Do not begin Phase 1 until Phase 0 review approval.

**Goal:** From Milestone 11 (`395d251`), build honest participant-rank attribution and aggregate convergence first, then run bounded continuous representative population operations without high-elo-only bias.

**Architecture:** Reuse M11 ladder + collector + shared Riot cooldown + champion aggregation substrate. Add a first-class co-participant rank enrichment pipeline (League-v4 by PUUID, durable observations, retry/cooldown) whose resolution state never gates `ALL` eligibility. Only after rank-quality gates pass, resume observation-scale scheduler ops and staged ladder representation waves (Apex → D/E/P → Gold → S/B/I).

**Tech Stack:** pnpm monorepo, NestJS API, BullMQ worker, Prisma/PostgreSQL, Redis shared cooldown, Zod/shared types, Vitest.

**Design spec:** `docs/superpowers/specs/2026-08-10-continuous-population-operations-design.md`  
**Code baseline:** `395d251`  
**Working branch:** `milestone-12-continuous-population-operations-v2`  
**Abandoned archive (evidence only):** `archive/m12-first-attempt` @ `a48cb23`

---



## 1. Milestone objective

Deliver M12-v2 such that:

1. Ranked champion stats attribute samples to the **actual participant rank** when Riot can provide it.
2. `ALL` always equals otherwise-eligible source-backed samples, independent of rank-resolution progress.
3. Unresolved / retryable lookups never silently become `UNKNOWN`.
4. Aggregation converges under rank transitions without deleting valid source samples.
5. Only after rank pipeline health, continuously collect a capped representative population across Challenger → Iron.
6. Ranking floor remains 30; no frontend redesign; no matchups.

---



## 2. Current baseline from M11

Confirmed on clean branch:

- HEAD = `395d251`
- Collector ladder acquisition, HOT/WARM/COLD refresh, shared 429 cooldown, coverage CLI exist
- Champion aggregation exists with exact + `ALL` rollups
- M11 gap: null `rankTierAtIngestion` currently maps to `UNKNOWN` in aggregation eligibility
- M11 A1 validated ~30 tracked players / improved ≥1 coverage; no ≥30 ranking-floor saturation yet

Abandoned attempt is **not** on this branch. Do not cherry-pick its production code or migration as baseline.

---



## 3. Locked invariants

1. `TrackedPlayer` = population acquisition only; **not** required for participant rank attribution.
2. `MatchParticipant` = source truth for aggregates.
3. `ALL` independent of rank-resolution state.
4. Exact tier only after successful participant rank resolution.
5. `UNKNOWN` / `UNRANKED` only after Riot lookup completed successfully with no applicable ranked entry (`RESOLVED_UNRANKED`).
6. `UNRESOLVED` / `FAILED_RETRYABLE` / `FAILED_PERMANENT` remain in `ALL`, excluded from exact tiers, never silently `UNKNOWN`.
  - `FAILED_PERMANENT` = separate `PERMANENT_UNAVAILABLE` diagnostic (technical/data gap, not proof of unranked).
7. Aggregate repair must never create consistency by deleting valid source-backed match samples.
8. No champion-targeted crawling; no uncontrolled graph traversal.
9. Ranking floor 30 unchanged.
10. Shared Riot 429 cooldown mandatory for enrichment.
11. Scheduler / crawlers never auto-start from API/worker boot.
12. Agents never edit real `.env` / `apps/api/.env` / `apps/worker/.env`.
13. No CN / unofficial clients.
14. Do not build on abandoned M12 migration as if approved.
15. `exactRankCoverage < 60%` = RED / `RANK_COVERAGE_UNHEALTHY` (minimum health floor, not target); population scaling blocked unless documented human exception.
16. Never “fix” low exact coverage by converting unresolved→UNKNOWN, dropping unresolved from `ALL`, lowering the 60% floor, or hiding the warning.

---



## 4. Environment ownership rules

Agents may modify only:

- `.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`
- config schemas, docs, tests, production code under review

Operator manually applies runtime env changes (keys, scheduler enable flags, concurrency, caps).

Every phase stop gate must remind: do not enable scheduler/crawler by editing real env files.

---



## 5. Rollback / DB safety notes



### 5.1 Phase 0 audit findings (this machine)

- Git code: M11-clean
- Local DB: **not M11-clean**
  - abandoned migration `20260810160000_participant_rank_enrichment` applied
  - `ParticipantRankObservation` + resolution columns/enum present
  - experimental population larger than M11 A1 (~95 tracked players observed during audit)



### 5.2 Before Phase 1 implementation

Operator must choose and perform one:

**Preferred A — archive + fresh M11 DB**

1. `pg_dump` current DB to an archive file/name
2. Create new empty DB (or reset a dedicated dev DB with explicit operator approval)
3. Apply only the 9 M11 migrations from this branch
4. Verify absence of abandoned rank-enrichment objects

**Preferred B — restore known M11 backup**

1. Keep current DB dump as archive
2. Restore pre-M12 / M11 backup
3. Verify migration head = `20260810130000_milestone_11_refresh_activity`

**Discouraged unless carefully reviewed — in-place reverse**

- Dropping abandoned objects + deleting migration row is error-prone if experimental data depends on them
- Only with explicit operator approval and backup first



### 5.3 Agent constraints

- Do **not** auto-drop DB
- Do **not** silently depend on abandoned schema
- Any new M12-v2 migration must be designed/implemented fresh on M11 baseline

---



## 6. New phase sequence


| Phase | Name                                               | Gate to enter next                                                                                              |
| ----- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0     | Design + plan                                      | Human approval of spec/plan                                                                                     |
| 1     | Operational stabilization + DB readiness           | Auth/coverage/scheduler baseline + M11-compatible DB                                                            |
| 2     | Rank-dimension foundation                          | Semantics/tests/design approval; no live enrichment flood                                                       |
| 3     | Rank enrichment implementation + tiny validation   | Tiny co-participant proof + convergence tests green                                                             |
| 4     | Bounded current-patch rank backfill                | Rank health classified; `<60%` exact = `BLOCKED_RANK_QUALITY`; prefer `≥80%` exact + `≥90%` resolution maturity |
| 5     | Observation-scale scheduler on existing population | Ops stability without ladder expansion                                                                          |
| 6A    | Apex representation correction                     | Challenger+GM+Master presence audit                                                                             |
| 6B    | Diamond / Emerald / Platinum waves                 | Bounded wave evidence                                                                                           |
| 6C    | Gold                                               | Bounded wave evidence                                                                                           |
| 6D    | Silver / Bronze / Iron                             | Bounded wave evidence                                                                                           |
| 7     | Coverage balancing / hard-cap gates                | Evidence package                                                                                                |
| 8     | Rank-aware analytics prep                          | Docs/schemas/metrics only                                                                                       |


Approval phrases are listed per phase.

---



## 7. Phase 0 — Design + plan (this document)



### Intent

Rewrite design and recreate plan for M12-v2 restart. No production code.

### Allowed

- Docs only
- Branch/archive safety
- Read-only DB/migration audit



### Forbidden

- Migrations, queues, aggregation changes, ladder waves, rank backfill, scheduler enable, commits (except prior archive WIP already done)



### Stop condition

Human reviews spec + plan.

**Approval phrase to enter Phase 1:** `APPROVE M12-V2 PHASE 1`

---



## 8. Phase 1 — Operational stabilization from M11



### Intent

Confirm the environment can safely support later rank work: DB compatibility, Riot auth, failed jobs, coverage baseline, scheduler health.

### Allowed production changes

- Ops/diagnostic scripts under `apps/api/scripts/` if missing and necessary
- Docs updates for runbook outputs
- Example-env comments only if needed



### Forbidden

- Participant-rank schema
- Aggregation semantic changes
- Ladder allowlist expansion / live representative waves
- Enabling scheduler via real `.env`
- Large ingest floods



### Likely files/modules

- `apps/api/scripts/phase1-*.mjs` (create only if needed)
- `docs/superpowers/plans/` artifacts folder for baselines (optional)
- Read-only use of existing `pnpm collector:coverage`, `collector:status`, `collector:scheduler-status`



### Tasks

- [x] **1.1 Confirm branch/baseline**
  - `git rev-parse HEAD` == `395d251` or fast-forward-safe descendant with only approved Phase 1 docs/scripts
  - Working tree has no abandoned M12 implementation leftovers

- [x] **1.2 DB readiness gate**
  - Verify `_prisma_migrations` matches M11 set only
  - Verify no `ParticipantRankObservation` / resolution enum/columns
  - If not compatible: STOP and require operator remediation (§5). Do not continue.

- [x] **1.3 Auth probe**
  - Run Riot auth probe against League-v4 / Account as appropriate
  - Record operating mode: developer-key vs production-key
  - On 401/403: fail closed; no later live enrichment/waves

- [x] **1.4 Failed ingest triage**
  - Classify failed BullMQ / ingestion jobs (auth vs 404 vs transient)
  - Document counts; drain/retry only auth-fixed transient classes with operator approval

- [x] **1.5 Coverage baseline**
  - Capture na1 queue-420 current-patch density: ≥1 / ≥30 / ≥100 / classic-zero
  - Capture tracked-player counts by `enrollmentSource`
  - Capture null vs non-null `rankTierAtIngestion` on queue-420 participants (baseline honesty gap)

- [x] **1.6 Scheduler health**
  - Verify scheduler process exists, default disabled, lease/cooldown/backpressure gates intact
  - Do not enable in Phase 1 unless a tiny controlled run is explicitly approved after healthy auth

- [x] **1.7 Optional tiny controlled collector run**
  - Only if auth+DB healthy
  - Bounds: existing tracked set, small batch, no ladder enrollment
  - Verify shared cooldown path still sane



### Tests

- No new product-behavior tests required unless scripts are added; then unit-test pure helpers.



### Live validation bounds

- No new ladder creates
- No rank backfill
- Tiny run ≤ existing M11 population refresh scope



### Stop condition

Written Phase 1 report with DB/auth/coverage/scheduler evidence.

**Approval phrase:** `APPROVE M12-V2 PHASE 2`

---



## 9. Phase 2 — Rank-dimension foundation



### Intent

Design and land the semantic/data-model foundation so aggregation can distinguish unresolved vs finalized unknown **without** yet running large Riot enrichment.

Spend detail on A–I:

- A Rank semantic/data-model
- B Participant rank observation/cache model
- C Enrichment queue contract (interfaces/jobs; may stub worker)
- D Shared 429 cooldown integration points
- E Aggregation semantics (`ALL` independent of rank resolution)
- F Generic affected-key convergence model
- G Backfill strategy sketch (no large run)
- H Rank-quality metrics definitions
- I Champion smoke-test fixtures/assertions (Camille, Akali, + extra cells)



### Allowed

- Prisma schema + migration for rank resolution/observation (fresh M12-v2 migration; not copy of abandoned one unless carefully re-derived and reviewed)
- Shared types / pure resolution helpers
- Aggregation eligibility changes + tests
- Queue name / job schema scaffolding
- Metrics helper stubs



### Forbidden

- Large live Riot rank backfill
- Ladder population scaling
- Frontend redesign
- Champion-specific repair scripts as product architecture
- Enabling scheduler



### Likely files/modules

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/<new>_participant_rank_foundation/`
- `packages/shared/src/participant-rank-resolution.ts` (+ tests)
- `packages/shared/src/job-queues/*participant-rank*`
- `apps/worker/src/queues/champion-aggregation/eligibility.ts`
- `apps/worker/src/queues/champion-aggregation/previous-keys.ts`
- `apps/worker/src/queues/champion-aggregation/champion-aggregation.service.ts`
- `apps/worker/src/queues/champion-aggregation/*.test.ts`



### Tasks

- [x] **2.A Rank semantic/data-model**
  - Define statuses: `PENDING`, `FAILED_RETRYABLE`, `RESOLVED_RANKED`, `RESOLVED_UNRANKED`, plus documented permanent/N/A if needed
  - Define mapping into aggregate exact tier vs UNKNOWN sentinel vs unresolved exclusion
  - Write pure unit tests for Camille-style example: ALL=27, exact=2, UNKNOWN=0, unresolved=25

- [x] **2.B Observation/cache model**
  - Durable observation table keyed by provider/platform/puuid/queue (+ observedAt)
  - Freshness field/TTL policy default proposal 6h
  - No TrackedPlayer requirement

- [x] **2.C Enrichment queue contract**
  - Job payload: platform, puuid/externalAccountId, queueType, reason/source, optional matchParticipant ids
  - Dedup/singleflight key definition
  - Worker may be stubbed if not processing live yet

- [x] **2.D Cooldown integration points**
  - Document/enforce that enrichment checks `RiotSharedCooldownStore` before Riot calls
  - Unit test: when cooldown active, no Riot call; status remains retryable/unresolved
  - Note: live cooldown unit test deferred to Phase 3 worker (no live League-v4 in Phase 2); contract + env.example document the requirement

- [x] **2.E Aggregation semantics**
  - Change eligibility so unresolved ≠ UNKNOWN
  - `ALL` contributors include unresolved + retryable + ranked + finalized unranked
  - Exact keys only for `RESOLVED_RANKED`
  - UNKNOWN key only for `RESOLVED_UNRANKED` (successful no-applicable-rank); `FAILED_PERMANENT` is ALL-only diagnostic
  - Update tests that currently expect null → UNKNOWN

- [x] **2.F Generic affected-key convergence**
  - Model previous keys vs new keys from participant snapshots
  - For transitions PENDING→DIAMOND, UNKNOWN→DIAMOND, DIAMOND→EMERALD, DIAMOND→UNRANKED:
    - preserve ALL
    - remove stale exact/UNKNOWN contribution
    - add new contribution
    - delete empty aggregate rows
    - idempotent recompute from MatchParticipant source set
  - Tests must prove no valid ALL sample loss

- [x] **2.G Backfill strategy (design in code comments/docs + CLI skeleton only)**
  - Progressive current-patch batches
  - No large execution in Phase 2

- [x] **2.H Rank-quality metrics**
  - Implement pure counters:
    - `rankClassifiedSampleCount`
    - `rankUnresolvedSampleCount`
    - `rankResolutionCoverage`
    - `exactRankCoverage`
    - health status (`RED` / `YELLOW` / `HEALTHY_ISH` / `MATURE` from exact coverage bands)
    - warning code `RANK_COVERAGE_UNHEALTHY` when `exactRankCoverage < 0.60`
  - Unit tests for formulas and health classification

- [x] **2.I Champion smoke fixtures**
  - Deterministic fixtures for Camille SUPPORT, Akali (choose dominant position from fixture), plus ≥3 additional champion/position cells
  - Assert source-backed ALL preserved across reclassification



### Tests required

- Shared resolution mapping tests
- Aggregation eligibility tests (null/pending/retryable/ranked/unranked)
- Previous-key / convergence tests for rank transitions
- Metrics formula tests
- Migration semantics tests if SQL backfill of statuses is included



### Live validation bounds

- None required; if migration applied, verify schema only on M11-compatible DB



### Stop condition

Foundation merged/ready for review; all unit tests green; no large live enrichment.

**Approval phrase:** `APPROVE M12-V2 PHASE 3`

---



## 10. Phase 3 — Rank enrichment implementation + tiny validation



### Intent

Implement real co-participant League-v4-by-PUUID enrichment with cache/retry/cooldown and prove aggregation convergence on a tiny live sample.

### Allowed

- Enrichment worker/processor/repository
- Match-ingestion hook to enqueue enrichment for eligible participants
- Tiny live validation scripts
- Example-env knobs for enrichment concurrency/TTL (examples only)



### Forbidden

- Full current-patch backfill
- Ladder waves / population scaling
- Creating TrackedPlayer solely for rank lookup
- Copying root/tracked player tier onto co-participants
- Frontend changes



### Likely files/modules

- `apps/worker/src/queues/participant-rank-enrichment/**`
- `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts`
- `apps/worker/src/main.ts` / config wiring
- `packages/server-riot` reuse of entries-by-puuid
- `apps/worker/src/cli/*participant-rank*` (tiny ops CLIs)



### Tasks

- [x] **3.1 Observation repository**
  - Read latest fresh observation; write new observations
  - Dedup by puuid/platform/queue freshness

- [x] **3.2 Enrichment service**
  - Resolve via League-v4 `entries/by-puuid`
  - Map responses to RESOLVED_RANKED / RESOLVED_UNRANKED
  - Map 429/5xx/network to FAILED_RETRYABLE
  - Honor shared cooldown; concurrency default 1 in developer mode

- [x] **3.3 Queue worker**
  - Process enrichment jobs with singleflight
  - Update MatchParticipant resolution fields + rankTier/division observed
  - Enqueue/trigger affected aggregate recalculation

- [x] **3.4 Ingestion integration**
  - After ranked match persist, enqueue enrichment for participants needing resolution
  - Do not block match completion on enrichment completion

- [x] **3.5 Tiny live validation**
  - Select a tiny set of recent queue-420 matches with unresolved co-participants
  - Run enrichment with strict bounds (e.g. ≤50 PUUIDs or ≤5 matches — finalize in phase kickoff)
  - Verify:
    - some exact ranks appear
    - ALL source counts unchanged
    - unresolved decreased only for finalized lookups
    - UNKNOWN increased only for true unranked finals
    - cooldown behavior correct under any 429

- [x] **3.6 Convergence verification**
  - Force at least one transition path in tiny set or fixture-backed integration test
  - Confirm no orphan aggregate keys / no ALL regression



### Tests

- Enrichment service unit tests (ranked/unranked/429/cooldown/fresh cache hit)
- Processor tests
- Integration-ish repository tests with test DB if available
- Regression: aggregation ALL independence



### Live validation bounds

- Tiny only; operator-approved
- Developer concurrency 1
- Stop on auth failure or cooldown thrash



### Stop condition

Tiny validation report proves co-participant rank lookup + ALL preservation.

**Approval phrase:** `APPROVE M12-V2 PHASE 4`

---



## 11. Phase 4 — Bounded current-patch rank backfill



### Intent

Progressively resolve ranks for current-patch eligible ranked participants already in DB; measure rank-quality gates; smoke-test champion cells.

### Allowed

- Backfill CLI with batch limits, dry-run, resume cursor
- Coverage CLI extensions for rank metrics
- Aggregate recalculation for affected keys
- Smoke scripts for Camille / Akali / additional cells



### Forbidden

- Ladder population expansion
- Raising hard caps
- Champion-targeted match crawling
- Deleting MatchParticipant rows to “fix” totals



### Likely files/modules

- `apps/worker/src/cli/backfill-participant-ranks.ts`
- `apps/worker/src/cli/participant-rank-coverage.ts`
- `apps/api` coverage extensions if metrics surface there
- `apps/api/scripts/smoke-rank-dimension-cells.mjs` (or worker equivalent)



### Tasks

- [x] **4.1 Backfill CLI**
  - Filters: platform=na1, queue=420, current patch, unresolved/retryable only by default
  - Bounds: batch size, max PUUIDs, max runtime, cooldown abort
  - Dry-run mode counts candidates without Riot calls

- [x] **4.2 Progressive execution**
  - Run batches; record before/after coverage metrics each batch
  - Recalculate affected aggregates from source participants

- [x] **4.3 Rank-quality measurement**
  - Emit (required operational output):
    - `exactRankCoverage`
    - `rankResolutionCoverage`
    - PENDING count
    - FAILED_RETRYABLE count
    - RESOLVED_RANKED count
    - RESOLVED_UNRANKED count
    - health status
    - `RANK_COVERAGE_UNHEALTHY` when `exactRankCoverage < 0.60`
  - Also emit `rankClassifiedSampleCount` / `rankUnresolvedSampleCount` diagnostics

- [x] **4.4 Champion smoke tests**
  - Camille, Akali, and several additional champion/position cells
  - For each cell verify:
    - source-backed ALL count preserved vs pre-backfill eligible participant count
    - exact tiers sum + UNKNOWN ≤ ALL
    - unresolved diagnostic explains ALL − classified
    - no manual champion cleanup used

- [x] **4.5 Failure review**
  - Inspect residual FAILED_RETRYABLE / permanent-unavailable
  - Classify Phase 4 gate result per bands below
  - If still `<60%` exact after enrichment/backfill: **STOP and investigate** — do not convert unresolved→UNKNOWN, drop unresolved from ALL, lower threshold, or hide warning



### Tests

- Backfill candidate selection unit tests
- Smoke assertion helpers unit tests
- Continuations of convergence tests if new transition bugs appear
- Health-band classification tests (`<60` / `60–80` / `80–90` / `≥90`)



### Live validation bounds

- Current-patch / na1 / q420 only
- Batchwise; pause on 429 thrash
- No enrollment waves



### Phase 4 rank-quality gates (locked)


| `exactRankCoverage`                | Gate result                     | Action                                                                                                    |
| ---------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **< 60%**                          | `BLOCKED_RANK_QUALITY`          | RED / `RANK_COVERAGE_UNHEALTHY`. Do not advance to population scaling. STOP and investigate.              |
| **60%–80%**                        | Review required                 | YELLOW — usable but incomplete; enrichment/backfill continues; human review before any scaling discussion |
| **≥ 80%**                          | Preferred minimum for advancing | HEALTHY-ISH / strong validation range for moving past Phase 4 toward later ops                            |
| **≥ 90%** `rankResolutionCoverage` | Preferred maturity target       | Finalize as mature when feasible; keep `exactRankCoverage` as high as Riot-ranked data reasonably permits |


Additional evidence still required:

- unresolved residual understood
- ALL preservation smoke tests pass
- no reliance on TrackedPlayer for attribution

**Approval phrase:** `APPROVE M12-V2 PHASE 5`

---



## 12. Phase 5 — Observation-scale continuous scheduler on existing population



### Intent

Validate continuous refresh ops on the **existing** population after rank pipeline health — still no large ladder scaling.

### Allowed

- Operator-enabled scheduler via real env (operator-owned)
- Small collector batch config via examples + operator apply
- Ops snapshots / coverage velocity windows



### Forbidden

- Representative ladder waves (6B+)
- Hard-cap increases
- Disabling rank enrichment to “go faster”



### Likely files/modules

- Existing `collector-scheduler.service.ts`
- Coverage CLI
- Ops scripts for observation snapshots



### Tasks

- [x] **5.1 Preflight**
  - Rank-quality gate still holds or residual plan documented
  - Scheduler disabled by default in examples
  - Operator enables only for observation window

- [x] **5.2 Observation run**
  - Bounded duration/ticks
  - Capture before/after: coverage density, velocity proxies, queue depth, cooldown events, enrichment lag

- [x] **5.3 Stability checklist**
  - scheduler stable
  - cooldown works
  - ingestion reliable
  - enrichment not exploding unresolved forever
  - no uncontrolled queue growth
  - ALL semantics unchanged under newly ingested matches



### Tests

- Scheduler gate unit tests if touched
- No new product UI tests



### Live validation bounds

- Existing tracked population only
- Observation scale; developer-key conservative settings



### Stop condition

Ops-stability report; not champion-page completeness.

**Approval phrase:** `APPROVE M12-V2 PHASE 6A`

---



## 13. Phase 6A — Apex representation correction



### Intent

Audit and correct Challenger / Grandmaster / Master representation. Do not claim apex health from Challenger-only.

### Rank-quality precondition

Phase 6 representative / population acquisition (including 6A) **may not begin** while `exactRankCoverage` is RED/unhealthy (`< 60%` / `RANK_COVERAGE_UNHEALTHY`), unless a human explicitly approves a documented external-data exception.

Preferred before representative scaling: `exactRankCoverage ≥ 80%`.

### Allowed

- Apex ladder dry-run + tiny apply with explicit per-tier budgets
- Coverage representation metrics for apex tiers
- Small GM/Master repair enrollments



### Forbidden

- Starting while exact-rank coverage is RED without documented human exception
- Diamond+ representative flood
- Skipping GM/Master audit
- Treating Challenger-only as success



### Tasks

- [x] **6A.1 Apex audit**
  - Count LADDER roots / recent observations for Challenger, Grandmaster, Master
  - Flag create-budget ordering issues if GM/Master starved

- [x] **6A.2 Dry-run repair wave**
  - Explicit budgets ensuring GM/Master get create slots when missing

- [x] **6A.3 Tiny apply**
  - Bounded creates; verify RankSnapshots / enrollment sources
  - Refresh newly enrolled apex roots modestly
  - Confirm rank enrichment attributes co-participants correctly on new matches



### Stop condition

Apex representation report shows Challenger **and** non-zero path/plan for GM/Master health (ideally both present).

**Approval phrase:** `APPROVE M12-V2 PHASE 6B`

---



## 14. Phase 6B — Diamond / Emerald / Platinum representative acquisition



### Intent

Bounded high/mid representative enrollment after rank pipeline + apex audit.

### Rank-quality precondition

Must not begin while `exactRankCoverage` is RED (`< 60%`). Preferred entry: `exactRankCoverage ≥ 80%`.

### Allowed

- Extend representative allowlist/wave tooling if needed
- Dry-run then bounded live waves per tier/segment
- Coverage + unique-match yield measurement



### Forbidden

- Starting while exact-rank coverage is RED without documented human exception
- Uncapped pages/creates
- Gold/low-tier yet
- Champion-targeted acquisition



### Tasks

- [x] Dry-run cost/budget report for D/E/P
- [x] Apply Diamond bounded wave → refresh → aggregates/coverage delta
- [x] Apply Emerald bounded wave → refresh → delta
- [x] Apply Platinum bounded wave → refresh → delta
- [x] Verify rank enrichment keeps up (resolution coverage does not collapse)
- [x] Verify unique match yield and queue health



### Prior experimental findings (guidance only)

Abandoned attempt observed strong unique-match yield from D/E/P waves under conservative developer-key settings. Re-validate; do not assume archived rows exist.

**Approval phrase:** `APPROVE M12-V2 PHASE 6C`

---



## 15. Phase 6C — Gold



### Intent

Complete mid-low bridge band.

### Tasks

- [x] Gold dry-run
- [x] Bounded Gold apply + refresh
- [x] Representation + yield + rank-coverage checks

**Approval phrase:** `APPROVE M12-V2 PHASE 6D`

---



## 16. Phase 6D — Silver / Bronze / Iron



### Intent

Satisfy lower-tier representation honesty requirement.

### Tasks

- [x] Per-tier dry-runs with stricter page/create caps
- [x] Bounded applies Silver → Bronze → Iron (one dimension at a time)
- [x] Confirm system is not high-elo-only in roots and observations
- [x] Confirm rank enrichment + ALL semantics remain healthy under higher unique-match yield

**Approval phrase:** `APPROVE M12-V2 PHASE 7`

---



## 17. Phase 7 — Coverage balancing / hard-cap evidence gates



### Intent

Use coverage velocity, yield, representation, and rank-quality to decide whether to rebalance segment budgets or raise caps.

### Hard-cap increase evidence package (required)

1. Rank-quality still healthy
2. Δ ≥30 / day, Δ current-patch matches / day, Δ unique matches / day
3. Stable worker throughput
4. No cooldown thrashing
5. Storage growth acceptable
6. Queue/backpressure healthy



### Forbidden

- Raising caps without evidence
- Lowering ranking floor

**Approval phrase:** `APPROVE M12-V2 PHASE 8`

---



## 18. Phase 8 — Rank-aware analytics preparation



### Intent

Prepare for later rank-aware product views without UI redesign or matchups.

### Allowed

- Shared segment vocabulary draft
- Read/merge design docs
- Cache-key implications
- Metrics/docs only



### Forbidden

- Frontend redesign
- MatchupAggregate writer / Strong-Weak UI
- Claiming causal patch effects

**Stop condition:** prep doc merged; milestone completion review.

**Approval phrase for milestone close:** `APPROVE M12-V2 COMPLETE`

---



## 19. Tests required (summary)


| Area                            | Required tests                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Rank resolution mapping         | pending/retryable/ranked/unranked/permanent; Camille example invariant                                       |
| Aggregation eligibility         | ALL includes unresolved; UNKNOWN only finalized                                                              |
| Affected-key convergence        | PENDING→exact, UNKNOWN→exact, exact→exact, exact→unranked; empty-row deletion; idempotency; ALL preservation |
| Enrichment service              | cache hit, ranked, unranked, 429/cooldown, retryable failure                                                 |
| Metrics                         | coverage formulas                                                                                            |
| Collector/ladder (later phases) | existing tests remain green; new budget tests if allowlist expands                                           |
| Smoke                           | Camille, Akali, ≥3 other champion/position cells preserve source-backed ALL                                  |


---



## 20. Operational measurements

Track throughout Phases 3–7:

- tracked players by source/segment
- unique match yield
- coverage density + velocity
- pending ingest depth
- shared cooldown events
- enrichment: status histogram, resolution coverage, exact coverage, enrichment lag
- auth failure count

---



## 21. Rank-quality gates (before population scaling resumes)

Formulas:

```text
rankResolutionCoverage =
  (finalized ranked + finalized unranked)
  / eligible ranked participants

exactRankCoverage =
  resolved exact-ranked
  / eligible ranked participants
```

Required operational output:

- `exactRankCoverage`
- `rankResolutionCoverage`
- PENDING count
- FAILED_RETRYABLE count
- RESOLVED_RANKED count
- RESOLVED_UNRANKED count
- health status
- `RANK_COVERAGE_UNHEALTHY` when `exactRankCoverage < 0.60`



### Exact rank coverage health policy (locked)


| `exactRankCoverage` | Health class                  | Ops meaning                                                                 |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| **< 60%**           | RED / UNHEALTHY / PROBLEMATIC | Materially incomplete rank-filtered dataset; emit `RANK_COVERAGE_UNHEALTHY` |
| **60%–80%**         | YELLOW                        | Usable but incomplete                                                       |
| **80%–90%**         | HEALTHY-ISH                   | Strong validation range                                                     |
| **≥ 90%**           | Preferred mature range        | Where feasible                                                              |


**60% is a MINIMUM HEALTH FLOOR, not the target.** This is a product data-quality requirement — not a claim that Riot guarantees >60% ranked resolution.

Mature target: `rankResolutionCoverage ≥ 90%`, with `exactRankCoverage` as high as Riot-ranked population data reasonably permits.

If `exactRankCoverage` remains `< 60%` after enrichment/backfill: **STOP and investigate.** Do not convert unresolved→UNKNOWN, drop unresolved from ALL, lower the threshold, or hide the warning.

Do not accept ~10–15% known-rank coverage as healthy.

---



## 22. Population scaling gates

Population scaling (Phase 6 representative acquisition, including 6A–6D) remains **blocked** when:

```text
exactRankCoverage < 60%   # RED / RANK_COVERAGE_UNHEALTHY / BLOCKED_RANK_QUALITY
```

unless a human explicitly approves a documented external-data exception.

Preferred before representative scaling:

```text
exactRankCoverage >= 80%
```

Population expansion also requires:

1. Phase 4 rank-quality gate not `BLOCKED_RANK_QUALITY` (prefer ≥80% exact; ≥90% `rankResolutionCoverage` maturity target)
2. Phase 5 observation ops stable
3. Phase 6A apex audit done before claiming apex health (not Challenger-only)
4. Each wave: dry-run → bounded apply → coverage/yield/rank-coverage delta → stop
5. Rank-quality status re-checked so scaling does not continue while exact coverage is RED

Hard-cap raises only in Phase 7 with evidence package.

---



## 23. Explicit non-goals

- Building on abandoned M12 implementation/migration as baseline
- Champion-targeted crawling
- Infinite participant graph traversal
- Frontend redesign / matchups
- Lowering floor below 30
- High-elo-only product success definition
- Agent edits to real runtime env files
- Historical-MMR claims from League-v4
- Auto DB drop/reset by agents

---



## 24. Definition of milestone completion

M12-v2 is complete when:

1. Participant-rank enrichment exists and does not require TrackedPlayer for attribution.
2. ALL / exact / UNKNOWN / unresolved contract holds in aggregation and smoke tests.
3. Aggregate convergence handles rank transitions without deleting valid source samples.
4. Current-patch rank-quality gates reached: not left in RED/`BLOCKED_RANK_QUALITY` without documented exception; prefer ≥80% exact and ≥90% resolution maturity.
5. Observation-scale continuous collection proven stable.
6. Apex audit addressed Challenger + GM + Master honestly.
7. Representative waves through Diamond→Iron executed under bounds (or remaining waves explicitly deferred with product approval while architecture remains ready).
8. Hard-cap changes only behind evidence.
9. Rank-aware analytics prep documented without UI/matchup scope creep.
10. Environment ownership rules respected throughout.

### Completion status (2026-08-12)

**Status:** `M12_V2_COMPLETE` after explicit `APPROVE M12-V2 COMPLETE`.

Evidence package: [`2026-08-12-m12-v2-completion-report.md`](./2026-08-12-m12-v2-completion-report.md).

Locked semantics in this plan are unchanged. Deferred debt (UNKNOWN aggregate inflation, statistical depth, matchups, build analytics, continuous enablement) is recorded in the completion report and is **not** treated as a §24 failure.

---



## 25. Phase kickoff checklist (every implementation phase)

- [ ] Re-read locked invariants (§3)
- [ ] Confirm M11/M12-v2 DB expectations for this phase
- [ ] Confirm no real `.env` edits by agent
- [ ] Confirm not accidentally scaling population before rank gates
- [ ] Write failing tests first for semantic changes
- [ ] Stop at phase gate; wait for approval phrase

---



## 26. Immediate next step after Phase 0 approval

Do **not** start coding rank enrichment yet.

First human decisions needed:

1. Approve this plan + design, or request edits
2. Choose DB remediation path (§5.2)
3. Reply with `APPROVE M12-V2 PHASE 1` when ready

