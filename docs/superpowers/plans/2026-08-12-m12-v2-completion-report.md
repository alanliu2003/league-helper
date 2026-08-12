# M12-v2 Completion Report

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Approval:** `APPROVE M12-V2 COMPLETE`  
**Working DB:** `league_helper_m12v2` (`league_helper` untouched)  
**Final decision:** **M12_V2_COMPLETE**

---

## Executive summary

Milestone 12 v2 is complete against the authoritative definition of done (§24 of the continuous-population plan). Participant-rank enrichment, ALL/exact/UNKNOWN aggregation contracts, representative Challenger→Iron population under current caps, observation-scale ops validation, and rank-aware analytics preparation are all in place.

Continuous crawler/scheduler remain **disabled** by default. Hard caps were **not** raised. Historical UNKNOWN aggregate inflation is **deferred debt**, not a DoD failure.

---

## Definition-of-done checklist

| # | Criterion | Result | Evidence |
| - | --------- | ------ | -------- |
| 1 | Participant-rank enrichment without requiring TrackedPlayer | **PASS** | `apps/worker/src/queues/participant-rank-enrichment/*`; League-v4 by PUUID; observation cache |
| 2 | ALL / exact / UNKNOWN / unresolved contract holds | **PASS** | `packages/shared/src/participant-rank-resolution.ts`; eligibility + rank-dimension-keys tests |
| 3 | Aggregate convergence without deleting valid ALL samples | **PASS** | `previous-keys.ts` + lifecycle tests; Phase 3/4 reports |
| 4 | Rank-quality gates healthy (≥80% exact prefer; ≥90% resolution) | **PASS** | Live: exact **99.56%**, resolution **100%**, PENDING **0**, health **MATURE** |
| 5 | Observation-scale continuous collection proven stable | **PASS** | Phase 5 report; scheduler observation profile; queues drained at closeout |
| 6 | Apex Challenger + GM + Master honest | **PASS** | Phase 6A/6D.1; shared `APEX_RANK_TIERS` |
| 7 | Representative waves Diamond→Iron | **PASS** | Phases 6B–6E reports; 270 LADDER roots Challenger→Iron |
| 8 | Hard-cap changes only behind evidence | **PASS** | Phase 7: `INSUFFICIENT_EVIDENCE_FOR_CAP_RAISE`; caps unchanged |
| 9 | Rank-aware analytics prep without UI/matchup creep | **PASS** | Phase 8 report; RankScope/merge helpers; no frontend |
| 10 | Environment ownership rules respected | **PASS** | Real `.env` gitignored/untracked; examples only; scheduler default false |

Deferred debt items below are **PASS_WITH_DEFERRED_DEBT** where noted (UNKNOWN mass, statistical depth) — they do not fail §24.

---

## Final architecture

### Prisma (M12-v2 migrations)

| Migration | Purpose |
| --------- | ------- |
| `20260810190000_m12v2_participant_rank_foundation` | `ParticipantRankObservation`, `MatchParticipant.rankResolutionStatus` / `rankResolvedAt`; **not** abandoned `20260810160000` |
| `20260811140000_m12v2_build_data_preservation` | Timeline/item/perk preservation fields |

### Queues / workers

- `participant-rank-enrichment` queue + processor/service/resolver/observation repo
- Match-ingestion hook enqueues enrichment; timeline build-event persistence
- Champion aggregation classification-aware keys + convergence
- Shared `RiotRequestBudgetStore` coordination (utilization 0.75)

### Collector

- Representative ladder seed (segment allowlists from shared vocabulary)
- Scheduler/lease/backpressure (disabled by default)
- Throughput / Riot pressure policy (`collector-riot-pressure`)

### Shared

- Rank resolution + quality metrics
- Rank segments (APEX/HIGH/MID/LOW)
- RankScope, merge helpers, eligibility meta, cache tokens

---

## Rank semantics (locked, unchanged)

1. MatchParticipant is aggregate source truth.  
2. TrackedPlayer / LADDER root rank is never participant attribution.  
3. ALL includes unresolved; exact = RESOLVED_RANKED; UNKNOWN = RESOLVED_UNRANKED only.  
4. Rank = observed during ingestion/enrichment cycle.  
5. Ranking floor = **30**.

---

## Rank-quality result (closeout live)

| Metric | Value |
| ------ | ----- |
| eligible ranked participants | 13530 |
| RESOLVED_RANKED | 13471 |
| RESOLVED_UNRANKED | 59 |
| PENDING / FAILED_* | 0 / 0 / 0 |
| exactRankCoverage | **99.56%** |
| rankResolutionCoverage | **100%** |
| health | **MATURE** |

---

## Population representation

| Signal | Value |
| ------ | ----- |
| Tracked players | 271 |
| LADDER | 270 |
| PRODUCT_SEARCH | 1 |
| Completed non-remake 420/na1 matches | 1353 |
| Representation | Challenger → Iron |

---

## Collector / Riot pacing

| Knob | Closeout value |
| ---- | -------------- |
| RIOT_REQUEST_BUDGET_UTILIZATION | 0.75 (examples) |
| Soft long threshold | ~71 (config-derived) |
| Hard long heuristic | 85 |
| Hard caps | unchanged (total tracked example 5000) |
| COLLECTOR_SCHEDULER_ENABLED | **false** |

---

## Queue / worker health (closeout)

| Queue | waiting | active | delayed | notes |
| ----- | ------- | ------ | ------- | ----- |
| match-ingestion | 0 | 0 | 0 | 30 historical failed retained |
| champion-aggregation | 0 | 0 | 0 | drained |
| participant-rank-enrichment | 0 | 0 | 0 | drained |

Shared Riot cooldown key may exist but was **inactive** at closeout (`until` < now). Scheduler not enabled. No continuous crawler.

---

## Analytics preparation

- **DERIVE_SEGMENTS_FROM_EXACT_TIERS**
- **HIDE_UNKNOWN_FROM_PRODUCT_UNTIL_RECONCILED**
- **RANK_AWARE_READ_CONTRACT_READY**
- Exact-tier / segment product rankings remain statistically immature under floor 30 (see Phase 8)

---

## Build-data preservation

Migration + ingestion path preserves timeline/item/perk events for later build analytics. Build aggregate/read/UI **deferred**.

---

## Hard-cap decision

**INSUFFICIENT_EVIDENCE_FOR_CAP_RAISE** (Phase 7). Caps unchanged.

---

## Continuous-ops readiness

**CONTINUOUS_OPS_READY_WITH_CURRENT_CAPS** — architecture ready; scheduler/crawler intentionally not enabled at M12 close.

---

## Test results

| Suite | Result |
| ----- | ------ |
| packages/shared | 202 passed |
| packages/match-analytics | 54 passed |
| packages/server-riot | 84 passed |
| apps/web unit | 116 passed |
| apps/worker | 252 passed (33 files) |
| apps/api | **538 passed** (55 files) after remigrating `league_helper_m12v2` schema `league_helper_test` |
| typecheck | PASS (all packages) |
| lint | PASS (all packages) |
| build | shared, match-analytics, server-riot, api, worker PASS |

Closeout fix: API integration test defaults / `prepare-test-db.mjs` now target `league_helper_m12v2?schema=league_helper_test` (aligned with worker; avoids abandoned `league_helper` DB).

Note: `prisma generate` was EPERM-locked by a long-running local `pnpm dev` worker holding the query engine DLL; migrate deploy + tests confirm schema consistency.

---

## Environment / DB safety

| Check | Result |
| ----- | ------ |
| Working DB | `league_helper_m12v2` only |
| `league_helper` public data | not modified for closeout ops |
| Real `.env` files | gitignored; not staged |
| Secrets in git | none found |
| Scheduler default | false in examples |
| Hard-cap defaults | unchanged |

---

## Deferred debt

1. **UNKNOWN aggregate reconciliation** — source RESOLVED_UNRANKED (59) ≪ UNKNOWN aggregate mass (all-patch sampleSizeSum ~3218 at Phase 8). Hide from product until reconciled. Never reinterpret unresolved as UNKNOWN.  
2. **Statistical depth** — exact-tier ≥30 cells = 0; segment mostly immature; ALL still 0 cells ≥100 on current patch at last checkpoint. Floor stays 30.  
3. **Matchup pipeline** — source readiness audited; MatchupAggregate writer/API/UI absent; pair depth sparse.  
4. **Build analytics** — preservation exists; aggregates/read/UI deferred.  
5. **Continuous operation** — ready with current caps; scheduler/crawler not enabled; no cap raise.  
6. **Storage scaling** — MatchTimelineEvent dominates size; review before very large-scale collection.  
7. **Segment HTTP wiring** — RankScope helpers ready; endpoint/UI wiring is post-M12.

These are **not** M12 failures under §24.

---

## Recommended next milestone boundary

Later work (explicitly **not** started here) may include: champion UX polish, matchup writer/API/UI, build analytics, UNKNOWN reconciliation, continuous-ops enablement behind evidence, and rank-scope product filters. Do not begin without a new approved plan.

---

## Commit classification

**Included:** M12 implementation, tests, migrations, example env knobs, phase reports/specs, reusable ops scripts under `apps/*/scripts`.

**Excluded:** `apps/api/.local/**` (local diagnostics), real `.env` files.
