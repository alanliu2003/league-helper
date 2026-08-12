# M12-v2 Phase 3 Report — Participant Rank Enrichment + Tiny Validation

**Date:** 2026-08-10  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2`  
**Migration head:** `20260810190000_m12v2_participant_rank_foundation`  
**Decision:** `READY_FOR_M12_V2_PHASE_4`

---

## Architecture implemented

### Observation repository

`apps/worker/src/queues/participant-rank-enrichment/participant-rank-observation.repository.ts`

- Latest lookup by `(provider, platformRoute, externalAccountId/PUUID, queueType)` ordered by `observedAt DESC`
- Append-only durable writes (`create`, never overwrite history)
- Freshness default = `PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS` (6h)
- Reuse: fresh `RESOLVED_RANKED` / `RESOLVED_UNRANKED`
- `FAILED_RETRYABLE` is **never** a durable success cache hit
- `FAILED_PERMANENT` reusable only for documented deterministic `providerResultCode` (`MISSING_PUUID`)
- No TrackedPlayer / PlayerAccount coupling

### Resolver

`apps/worker/src/queues/participant-rank-enrichment/participant-rank-resolver.ts`

- League-v4 `entries/by-puuid` via existing `GameDataProvider.getRankedEntries`
- Minimal stub `PlayerAccount` built from PUUID + platform (Account-v1 **not** used for rank)
- Queue type: `RANKED_SOLO_5x5` (420) / `RANKED_FLEX_SR` (440)

### Queue processor

`apps/worker/src/queues/participant-rank-enrichment/*`

- Worker concurrency default **1** (developer-key)
- Flow: validate → fresh observation → else League-v4 → append observation → update unresolved `MatchParticipant` rows → enqueue generic champion aggregation
- Shared cooldown checked before every Riot call; 429 publishes monotonic shared cooldown
- Auth 401/403 → fail-closed `UnrecoverableError` (no retry storm)

### Ingestion hook

`apps/worker/src/queues/participant-rank-enrichment/ingestion-hook.ts`  
Wired post-COMPLETED in `match-ingestion.processor.ts`

- Ranked matches enqueue enrichment for `PENDING` / `FAILED_RETRYABLE` participants
- Non-ranked queues produce no enrichment jobs
- **Does not** await League-v4; INGEST_MATCH completion stays async relative to rank

### Aggregation trigger

Reuses Phase 2 `enqueueChampionAggregationAfterCommit` + previous∪current key expansion.

Documented update scope: apply current-cycle observation to all unresolved/retryable rows for the same `(platform, PUUID, queueType)`. Terminal rows are never overwritten. This is ingestion/enrichment-cycle rank — not historical match-start rank.

### Retry / cooldown behavior

| Condition | Behavior |
| --------- | -------- |
| Shared cooldown active | Zero Riot calls; leave unresolved; delay job |
| 429 | `FAILED_RETRYABLE` observation; extend shared cooldown; delay job |
| 5xx / network | `FAILED_RETRYABLE`; bounded BullMQ backoff |
| 401 / 403 | Fail-closed; no retry storm |
| Missing PUUID | `FAILED_PERMANENT` / ALL-only; never UNKNOWN |
| Exhausted attempts | BullMQ fail retention; no endless loop |

---

## Request dedupe

1. **BullMQ job ID singleflight:** `buildParticipantRankEnrichmentBullMqJobId(platform, puuid, queueType)` — one live job per identity
2. **Ingestion candidate dedupe:** unique PUUID set before enqueue
3. **Observation reuse:** fresh finalized observation applied across multiple MatchParticipant rows for that PUUID
4. **Processor multi-row update:** one resolution updates all matching unresolved rows

Tiny validation evidence: 30 participants / 28 distinct PUUIDs → **27** League-v4 enrichment calls + **27** observations (remaining identities already `RESOLVED_RANKED` from local RankSnapshot at ingest). Not 30 Riot calls.

---

## Failure semantics

| Outcome | Status | ALL | Exact | UNKNOWN |
| ------- | ------ | --- | ----- | ------- |
| Applicable Solo/Duo entry | `RESOLVED_RANKED` | yes | tier | no |
| Successful empty / no applicable entry | `RESOLVED_UNRANKED` | yes | no | yes |
| 429 / 5xx / cooldown / transient | `FAILED_RETRYABLE` | yes | no | no |
| Missing PUUID | `FAILED_PERMANENT` | yes | no | **no** |
| Auth 401/403 | fail-closed; durable retryable marker; job not retried | yes | no | no |

---

## Runtime configuration

Documented in `.env.example` / `apps/worker/.env.example` (operator applies to real env):

| Knob | Default |
| ---- | ------- |
| `PARTICIPANT_RANK_ENRICHMENT_QUEUE_NAME` | `participant-rank-enrichment` |
| `PARTICIPANT_RANK_ENRICHMENT_WORKER_CONCURRENCY` | `1` |
| `PARTICIPANT_RANK_ENRICHMENT_JOB_ATTEMPTS` | `5` |
| `PARTICIPANT_RANK_ENRICHMENT_BACKOFF_BASE_MS` | `2000` |
| `PARTICIPANT_RANK_ENRICHMENT_BACKOFF_MAX_MS` | `60000` |
| `PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS` | `21600000` (6h) |
| `RIOT_SHARED_429_COOLDOWN_MIN_MS` | `900000` (shared) |

**Real `.env` / `apps/api/.env` / `apps/worker/.env` were not modified by the agent.**  
Live validation used code defaults (concurrency 1, 6h freshness, etc.).

---

## Tests

```text
pnpm --filter @league-helper/worker exec vitest run src/queues/participant-rank-enrichment src/cli/aggregates/rank-enrichment-health-core.test.ts src/main.bootstrap.test.ts
→ 8 files / 37 tests passed

pnpm --filter @league-helper/worker exec vitest run src/queues/match-ingestion/match-ingestion.processor.test.ts src/queues/champion-aggregation
→ 7 files / 89 tests passed

pnpm --filter @league-helper/worker typecheck
→ exit 0
```

Coverage includes: observation cache hit/miss/stale/retryable, resolver ranked/unranked/429/5xx/401/403/missing PUUID, cooldown zero-Riot, processor delay/fail-closed, service update+agg trigger without TrackedPlayer, multi-row PUUID reuse, ingestion ranked vs non-ranked enqueue, aggregation lifecycle ALL/exact/UNKNOWN, metrics health CLI.

---

## DB/Redis preflight

| Check | Result |
| ----- | ------ |
| Database | `league_helper_m12v2` only |
| Old DB `league_helper` touched | **no** |
| Migration head | `20260810190000_m12v2_participant_rank_foundation` |
| Enrichment queue before validation | waiting/active/delayed/failed = **0** |
| Stale conflicting job names | none |
| Mass Redis delete | **not performed** |

---

## Tiny validation

### Seed method

Option A: Challenger ladder → Account-v1 identity resolve (bootstrap only) → `matches:bootstrap-player` for **one** root.

- Seed: `never type#1998` @ `na1` (identity only; not used as co-participant rank source)
- `--max-matches 3 --queue 420 --wait`
- `COLLECTOR_ENROLL_FROM_BOOTSTRAP=false` → **TrackedPlayer count remained 0**
- Expansion / scheduler / ladder waves: **not enabled**

### Strict bounds

| Bound | Actual |
| ----- | ------ |
| Seed roots | 1 PlayerAccount / 0 TrackedPlayer |
| Matches | 3 q420 |
| Participants | 30 |
| Distinct PUUIDs | 28 |
| Enrichment concurrency | 1 |
| Timeline | normal ingestion only |
| Participant expansion | off |
| Scheduler | off |
| Ladder wave | none |

### Before → after

| Metric | After enrichment |
| ------ | ---------------- |
| PENDING | 0 |
| FAILED_RETRYABLE | 0 |
| FAILED_PERMANENT | 0 |
| RESOLVED_RANKED | 30 |
| RESOLVED_UNRANKED | 0 |
| Observations written | 27 (`HTTP_200_RANKED`) |
| League-v4 enrichment calls | 27 |
| Observation cache hits (live) | 0 (no re-lookup needed; PUUID job singleflight covered overlaps) |
| rankResolutionCoverage | 100% |
| exactRankCoverage | 100% |
| health | `MATURE` |
| warning | none |
| 429 / cooldown events | none |

Phase 3 did **not** chase the 60% gate; Challenger lobbies yielded high exact coverage naturally.

---

## Aggregate correctness

Measure script (`phase3-tiny-validation-measure.mjs`) over all champion×position cells in the tiny set:

| Assertion | Result |
| --------- | ------ |
| source eligible == aggregate ALL | **all cells OK** |
| exact tier counts match source `RESOLVED_RANKED` | **all cells OK** |
| UNKNOWN == `RESOLVED_UNRANKED` only | **OK** (0 / 0) |
| FAILED_PERMANENT not in UNKNOWN | **OK** (0 permanent) |
| No TrackedPlayer required | **proven** (`trackedPlayers=0`) |

---

## Remaining Phase 4 work

Explicitly **not started**:

> Bounded current-patch rank backfill

Phase 4 should classify rank health on a useful denominator, prefer ≥80% exact + ≥90% resolution maturity, and treat `exactRankCoverage < 60%` as `BLOCKED_RANK_QUALITY` unless a documented human exception applies.

Do **not** begin Phase 4 until approval.

---

## Files changed (Phase 3)

### New

- `apps/worker/src/queues/participant-rank-enrichment/**` (repository, resolver, service, processor, worker, enqueue, ingestion-hook, queue-type + tests)
- `apps/worker/src/cli/rank-enrichment-health.ts`
- `apps/worker/src/cli/aggregates/rank-enrichment-health-core.ts` (+ test)
- `apps/worker/scripts/phase3-rank-enrichment-preflight.mjs`
- `apps/worker/scripts/phase3-tiny-validation-measure.mjs`
- `apps/worker/scripts/phase3-count.mjs`
- `apps/api/scripts/phase3-tiny-seed-resolve.mjs`
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-3-rank-enrichment-report.md`

### Modified

- `apps/worker/src/main.ts` / `main.bootstrap.test.ts`
- `apps/worker/src/config.ts`
- `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts`
- `apps/worker/package.json` / root `package.json`
- `.env.example` / `apps/worker/.env.example`

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Phase 4 backfill / ladder / frontend / matchups

---

## Decision

**`READY_FOR_M12_V2_PHASE_4`**
