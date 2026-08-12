# M12-v2 Phase 4 Report — Bounded Current-Patch Rank Backfill

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2`  
**Migration head:** `20260810190000_m12v2_participant_rank_foundation`  
**Decision:** `READY_FOR_M12_V2_PHASE_5`

---

## Baseline

Preflight confirmed:

| Check | Result |
| ----- | ------ |
| Database | `league_helper_m12v2` only |
| Old DB `league_helper` | **not touched** |
| Redis / enrichment queue | waiting/active/delayed/failed = **0** |
| Stale conflicting job names | none |
| TrackedPlayer count | **0** (PRODUCT_SEARCH path; no artificial tracked players) |
| PlayerAccount count | 2 |
| MatchParticipant rows | 230 (70 ranked eligible; 150 `NOT_APPLICABLE` draft/other) |

### Rank health before backfill

Command: `pnpm aggregates:rank-enrichment-health -- --json --platform na1 --queue 420`

| Metric | Value |
| ------ | ----- |
| eligibleRankedParticipants | 70 |
| RESOLVED_RANKED | 70 |
| RESOLVED_UNRANKED | 0 |
| PENDING | 0 |
| FAILED_RETRYABLE | 0 |
| FAILED_PERMANENT | 0 |
| permanentUnavailableSampleCount | 0 |
| exactRankCoverage | **100%** |
| rankResolutionCoverage | **100%** |
| health | **MATURE** |
| warning | none |

Current-patch slice (`--patch 16.15`): 30 eligible, all `RESOLVED_RANKED`, MATURE / 100%.

**Denominator is non-zero** — not `INSUFFICIENT_DENOMINATOR`. No unnecessary Riot calls were required for baseline classification.

Patch mix in DB: `16.15` (Phase 3 Challenger seed, 3×q420) + `16.11` (PRODUCT_SEARCH-ingested ranked + draft). Ranked eligible remain fully resolved from Phase 3 enrichment + async ingestion-hook enrichment on product-search matches.

---

## Backfill implementation

### Command / job used

```bash
pnpm aggregates:backfill-participant-ranks -- --dry-run|--confirm [--wait] \
  --platform na1 --queue 420 [--patch 16.15] \
  --max-participants 200 --max-riot-calls 100 \
  [--after-participant-id <cursor>] [--json]
```

Enqueues existing BullMQ job `ENRICH_PARTICIPANT_RANK` with `reason=BACKFILL` into queue `participant-rank-enrichment`.  
**No separate Riot lookup script.** Worker concurrency remains developer-key default **1**.

### Bounds

| Bound | Default | Hard cap |
| ----- | ------- | -------- |
| `--max-participants` | 200 | 500 |
| `--max-riot-calls` (unique PUUID / Riot-call upper bound) | 100 | 500 |
| Platform / queue | na1 / 420 | 420 or 440 only |
| Mutating guard | requires `--confirm` | dry-run otherwise |
| DB guard | refuses unless DB = `league_helper_m12v2` | abandoned `league_helper` blocked |

Env documentation (examples only; real `.env` not modified):

- `PARTICIPANT_RANK_BACKFILL_MAX_PARTICIPANTS`
- `PARTICIPANT_RANK_BACKFILL_MAX_RIOT_CALLS`

### Target selection

1. `PENDING` first  
2. then `FAILED_RETRYABLE`  
3. never fresh `RESOLVED_*`  
4. never `FAILED_PERMANENT` (including `MISSING_PUUID`)  
5. identity dedupe at `(platform, PUUID, queueType)`  
6. resumable via `--after-participant-id`

### Concurrency / cooldown

- Enrichment worker concurrency: **1** (unchanged)
- Shared Riot 429 cooldown still checked inside the enrichment resolver before every League-v4 call
- CLI `--wait` drains waiting/active/delayed before cost measurement

### Idempotence

BullMQ job-id singleflight + observation freshness reuse + terminal-row non-overwrite from Phase 3 are unchanged.

---

## Results

### Live execution (bounded)

| Step | Result |
| ---- | ------ |
| Dry-run na1/q420 | `participantsSelected=0`, `uniquePuuids=0` |
| Dry-run na1/q420/patch=16.15 | `participantsSelected=0` |
| Confirm + wait | `published=0`, `alreadyLive=0`, `failed=0` |

### Cost / status deltas

| Metric | Value |
| ------ | ----- |
| participants attempted | 0 |
| unique PUUIDs | 0 |
| Riot calls (estimated) | **0** |
| cache hits | 0 |
| observations created | 0 |
| RESOLVED_RANKED / UNRANKED deltas | 0 / 0 |
| FAILED_RETRYABLE / FAILED_PERMANENT after | 0 / 0 |
| 429 count | 0 |
| cooldown events | 0 |

**Why zero Riot work:** the existing collected ranked denominator was already fully resolved by Phase 3 tiny validation + post-ingest enrichment on PRODUCT_SEARCH matches. Phase 4 correctly selected **no** unresolved rows and did **not** re-hit fresh `RESOLVED_RANKED` identities.

---

## Rank quality

| Metric | After Phase 4 |
| ------ | ------------- |
| exactRankCoverage | **100%** (≥90% → mature) |
| rankResolutionCoverage | **100%** (≥90% maturity target) |
| health | **MATURE** |
| `RANK_COVERAGE_UNHEALTHY` / `<60%` | **not raised** |
| Gate band | preferred / mature — **not** `BLOCKED_RANK_QUALITY` |

Thresholds were **not** lowered. RED warnings remain wired in `classifyExactRankCoverageHealth`.

---

## Aggregate correctness

Script: `apps/worker/scripts/phase4-aggregate-smoke.mjs`  
Scope: all na1 / q420 / COMPLETED / non-remake champion×position cells (63 cells).

| Assertion | Result |
| --------- | ------ |
| source eligible == aggregate ALL | **all cells OK** |
| exact tiers == `RESOLVED_RANKED` contributors | **all cells OK** |
| UNKNOWN == `RESOLVED_UNRANKED` only | **OK** (0 / 0) |
| no stale exact buckets | **OK** |
| no stale UNKNOWN | **OK** |
| FAILED_PERMANENT not in UNKNOWN | **OK** (0 permanent) |
| ALL decreased after enrichment | **no** (unchanged 70) |
| unresolved → UNKNOWN | **no** |

Spotlight: Akali (`championId=84`) MIDDLE cells on patches `16.11` / `16.15` matched source vs aggregate. Camille (`164`) had no rows in this DB slice.

No repair scripts were created or run.

---

## Cost / yield

| Metric | Value |
| ------ | ----- |
| resolution yield | n/a (0 attempted; already resolved) |
| Riot calls / resolved participant | n/a (0 Riot calls) |

Phase 3 prior cost context (for ops continuity): 30 participants / 28 PUUIDs → 27 League-v4 calls. Phase 4 added **0** additional Riot spend on this DB.

---

## Remaining gaps (Phase 5)

Explicitly **not started**:

> Phase 5 — Observation-scale continuous scheduler on existing population

Still needed later:

1. Operator-enabled scheduler observation window on the **existing** population (no ladder waves)
2. Coverage velocity / enrichment lag / cooldown stability snapshots
3. Confirm rank-quality gate still holds as new matches arrive under observation-scale ops
4. Broader rank-mix realism beyond current Challenger-heavy + small PRODUCT_SEARCH set (scaling stays Phase 6+)

Do **not** begin Phase 5 until approval.

---

## Tests

```text
pnpm --filter @league-helper/worker exec vitest run \
  src/cli/aggregates/backfill-participant-ranks-core.test.ts \
  src/cli/aggregates/rank-enrichment-health-core.test.ts \
  src/queues/participant-rank-enrichment
→ 8 files / 42 tests passed (includes 12 new backfill tests)

pnpm --filter @league-helper/worker exec vitest run \
  src/queues/match-ingestion/match-ingestion.processor.test.ts \
  src/queues/champion-aggregation \
  src/main.bootstrap.test.ts
→ 8 files / 96 tests passed

pnpm --filter @league-helper/worker typecheck → exit 0
pnpm --filter @league-helper/api typecheck → exit 0
```

---

## Files changed (Phase 4)

### New

- `apps/worker/src/cli/backfill-participant-ranks.ts`
- `apps/worker/src/cli/aggregates/backfill-participant-ranks-core.ts`
- `apps/worker/src/cli/aggregates/backfill-participant-ranks-core.test.ts`
- `apps/worker/scripts/phase4-inspect-baseline.mjs`
- `apps/worker/scripts/phase4-inspect-ingestion.mjs`
- `apps/worker/scripts/phase4-aggregate-smoke.mjs`
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-4-rank-backfill-report.md`

### Modified

- `apps/worker/package.json` (+ `aggregates:backfill-participant-ranks`)
- `package.json` (root script)
- `.env.example`
- `apps/worker/.env.example`

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Scheduler enablement, ladder waves, caps, frontend, matchups, Phase 5

---

## Decision

**`READY_FOR_M12_V2_PHASE_5`**

Rationale:

- Rank-quality gates are MATURE (100% exact + 100% resolution) on a non-zero denominator
- Bounded backfill pipeline is implemented, tested, DB-guarded, and rate-limit-aware
- Live confirm run correctly found **zero** unresolved candidates (no wasted Riot calls)
- Aggregate ALL / exact / UNKNOWN convergence holds; unresolved never collapsed to UNKNOWN
- Population scaling / scheduler / ladder waves remain off
