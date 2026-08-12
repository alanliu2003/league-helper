# M12-v2 Phase 6B.2 Report — Fresh-Load Scalability Benchmark

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (root / api / worker verified; `league_helper` untouched)  
**Real `.env` files:** not modified (process-env budget/concurrency overrides only)  
**Decision:** `READY_FOR_M12_V2_PHASE_6C`

Stopped for review. Phase 6C / lower-tier waves / continuous crawler were **not** started.

---

## Primary answer

**Yes — with an important ops caveat.**

On genuinely fresh Apex acquisition at volumes that previously caused 429 thrashing, the proactive Riot budget coordinator **materially improves useful throughput**:

| Evidence | Result |
| -------- | ------ |
| Stage B (budget-wired worker from start) | **+113** new matches, **0** shared cooldowns, **~326 matches/hour**, queues drained |
| Phase 6B (pre-coordinator, first-touch) | +52 matches, **3** cooldowns, ~30 min lost to floors, CD thrash |
| Phase 6B.1 (coordinator, duplicate-heavy) | +13 matches, 0 cooldowns — pacing proof only, not freshness proof |

Stage A also collected **+62** fresh matches (16% duplicate) but its first ingest burst ran on a **stale worker `dist/`** missing budget wiring, which caused **one** isolated 15-minute shared cooldown. After rebuild + recovery there was **no re-429 thrash**. Stage B is the clean fresh-load proof.

---

## Baselines

### Phase 6B (pre-coordinator, first-touch Apex)

| Metric | Value |
| ------ | ----- |
| New matches | +52 |
| Shared cooldowns | 3 (2 full floors waited ≈30 min) |
| Thrash | CD1→CD2 in ~17s |
| Useful yield amid stalls | +52 current-patch matches |

### Phase 6B.1 (coordinator, re-refresh)

| Metric | Value |
| ------ | ----- |
| New matches | +13 |
| Discovered / already-complete | 60 / 45 (75% duplicate) |
| Admitted Riot calls | 111 |
| Shared cooldowns | 0 |
| Wall-clock | ~10 min |
| Note | **Not** fresh-load scalability proof |

### Phase 6B.2 pre-stage baseline (`league_helper_m12v2`)

| Metric | Value |
| ------ | ----- |
| Matches 420/na1 | 96 |
| LADDER roots | 15 |
| Rank exact / resolution | 98.0% / 98.5% |
| ALL aggregate rows | 395 |
| Queues | drained |
| Shared cooldown | inactive |

Artifacts: `apps/api/.local/m12v2-phase6b2/baseline-*`.

---

## Stage A

### Plan

- Fresh Apex enrollment: **5 / tier** (15 new LADDER roots)
- Refresh only Stage A roots: batch 15, `maxMatches=5`, `maxEnqueue=75`, concurrency 1
- Budget coordinator enabled via process env (`utilization=0.75`)

### Dry-run / enrollment

| Tier | Already tracked (scan) | Created | Identity resolved |
| ---- | ---------------------- | ------- | ----------------- |
| Challenger | 5 | 5 | 5 |
| Grandmaster | 5 | 5 | 5 |
| Master | 4 | 5 | 5 |
| **Total** | — | **15** | **15** |

Estimated enrollment Riot cost ≈ 3 ladder lists + 15 identity ≈ 18 calls.

### Freshness

| Metric | Value |
| ------ | ----- |
| Match IDs discovered | 75 |
| Already-complete skipped | 12 |
| Enqueued / genuinely new (DB Δ) | 62 / **62** |
| Duplicate % | **16%** (majority fresh) |

### Ops incident (budget wiring)

Initial `pnpm --filter @league-helper/worker start` used a **stale worker `dist/`** that did **not** wire `RiotRequestBudgetStore` (API collector refresh was paced; match ingest was not).

Observed:

- Budget admits during first burst: refresh **30**, match **0**
- Shared 429 cooldown activated once (~15 min floor)
- After `pnpm --filter @league-helper/worker build` + restart: recovery completed with **no second cooldown**

This is an operator packaging issue, not a request to weaken pacing.

### Throughput / Riot budget (Stage A window incl. cooldown + rank backfill)

| Metric | Value |
| ------ | ----- |
| Wall-clock | ~37.7 min (includes ~15 min cooldown + enrichment catch-up) |
| New matches / hour | **98.6** |
| Riot admits | 358 |
| By workload | match 14 / refresh 30 / enrichment 314 |
| Proactive delayed / deferred | 315 / 309 |
| Shared cooldowns | **1** isolated |
| Cooldown thrash | **none** (no immediate re-429) |
| Riot calls / new match | ~5.8 |

### Queues

| Queue | Peak delayed (approx) | Final |
| ----- | --------------------- | ----- |
| match-ingestion | 19 during cooldown | drained |
| participant-rank-enrichment | bounded; required backfill enqueue for PENDING | drained |
| champion-aggregation | bounded | drained |

Enrichment jobs did not fully fan out during the stale-dist burst; bounded `aggregates:backfill-participant-ranks` restored PENDING→resolved without dumping to UNKNOWN.

### Rank / aggregates

| Metric | After Stage A |
| ------ | ------------- |
| exactRankCoverage | **99.7%** |
| rankResolutionCoverage | **100%** |
| PENDING | 0 |
| ALL rows | 395 → **478** (no decrease) |

Artifacts: `apps/api/.local/m12v2-phase6b2/stage-a-*`.

---

## Stage A gate

| Requirement | Result |
| ----------- | ------ |
| ≥40 genuinely new matches | **PASS** (62) |
| Duplicate majority-fresh | **PASS** (16%) |
| ≤1 isolated shared 429 | **PASS** (1) |
| No back-to-back thrash | **PASS** |
| Queues drain | **PASS** |
| rankResolutionCoverage ≥90% | **PASS** (100%) |
| exactRankCoverage ≥80% (pref ≥90%) | **PASS** (99.7%) |
| ALL does not decrease | **PASS** |
| UNKNOWN semantics (no PENDING dump) | **PASS** |

**Stage A gate: PASS** → proceeded to Stage B.

---

## Stage B

### Plan

- Fresh Apex enrollment: **8 / tier** (24 new LADDER roots)
- Refresh only Stage B unrefreshed roots in batches of 4 (long-window budget deferrals made batch-24 brittle)
- Budget-wired rebuilt worker from the start
- Target 80–120 new matches

### Enrollment

| Tier | Created | Identity |
| ---- | ------- | -------- |
| Challenger | 8 | 8 |
| Grandmaster | 8 | 8 |
| Master | 8 | 8 |
| **Total** | **24** | **24** |

TrackedPlayer after enroll: `LADDER:54`, `PRODUCT_SEARCH:1`.

### Freshness

| Metric | Value |
| ------ | ----- |
| Collector batches (1–9) discovered | 100 |
| Skipped complete | 33 |
| Enqueued (counted batches) | 67 |
| Duplicate % | **33%** (majority fresh; &lt;50%) |
| DB new matches (Stage A end → Stage B end) | **+113** |

Some early failed/partial collector attempts also contributed ingest before the counted batch loop; DB delta is the source of truth for yield.

### Throughput / Riot budget

| Metric | Value |
| ------ | ----- |
| Wall-clock (refresh start → final metrics) | **~20.8 min** |
| New matches / hour | **~326** |
| Riot admits | 573 |
| By workload | match 48 / refresh 83 / enrichment 442 |
| Proactive delayed / deferred | 891 / 824 |
| `delayedMsTotal` | ~20.7e6 ms (retry/defer accounting; not equal to wall stall) |
| Shared cooldowns / 429 thrash | **0 / none** |
| Riot calls / new match | **~5.07** |
| Cooldown seconds / new match | **0** |
| New matches / refreshed root | ~113 / 24 ≈ **4.7** |

Collector note: large single `collector:run` batches can fail a player when refresh hits `RiotRequestBudgetDeferredError` (long window). Smaller batches + short waits avoided emergency cooldown while preserving progress.

### Queues

| Queue | Behavior |
| ----- | -------- |
| match-ingestion | bounded; drained (0 waiting/active/delayed) |
| participant-rank-enrichment | paced via deferrals; drained after backfill catch-up |
| champion-aggregation | drained |

No uncontrolled backlog growth. No shared cooldown activation during Stage B.

### Rank / aggregates

| Metric | After Stage B |
| ------ | ------------- |
| exactRankCoverage | **99.7%** |
| rankResolutionCoverage | **99.9%** |
| PENDING | 3 (near-zero; not converted to UNKNOWN) |
| ALL rows | 478 → **602** (no decrease) |

Artifacts: `apps/api/.local/m12v2-phase6b2/stage-b-*`.

---

## Stage B gate

| Requirement | Result |
| ----------- | ------ |
| 80–120 new matches | **PASS** (113) |
| Duplicate &lt;50% / majority fresh | **PASS** (33%) |
| ≤1 isolated 429 | **PASS** (0) |
| No cooldown thrash | **PASS** |
| Bounded backlog + full drain | **PASS** |
| Throughput not collapse vs Stage A | **PASS** (326/hr vs 98.6/hr; Stage A wall-clock included a full cooldown) |
| Rank coverage | **PASS** |

**Stage B gate: PASS.**

---

## Stage C

**Not run.**

Stage A + Stage B already answer the primary question with sufficient fresh volume (62 + 113) and a clean 0-cooldown Stage B wave. Optional Stage C (150–250) left for a later bounded ops session if desired.

---

## Riot budget behavior

| Stage | Admitted | Match | Refresh | Enrichment | Delayed | Deferred | Cooldown blocked | Shared CD |
| ----- | -------- | ----- | ------- | ---------- | ------- | -------- | ---------------- | --------- |
| 6B.1 | 111 | 22 | 24 | 65 | 1985 | 1945 | 0 | 0 |
| 6B.2 A | 358 | 14 | 30 | 314 | 315 | 309 | 4 | **1** |
| 6B.2 B | 573 | 48 | 83 | 442 | 891 | 824 | 0 | **0** |

Interpretation:

- **Proactive wait** (delayed/deferred) replaced most emergency floors on Stage B.
- Stage A’s single reactive cooldown coincided with missing worker budget wiring on match ingest.
- Enrichment remains the largest admit share by design (capped share + catch-up backfill).

Distinguish carefully:

- Proactive wait = budget reserve delay/defer (**preferred**)
- Reactive 429 cooldown = shared emergency floor (**Stage A once; Stage B never**)

---

## Queue behavior

Both stages ended with ingest / enrichment / aggregation **waiting=active=delayed=0**.

Stage A spent ~15 minutes with ingest jobs delayed under shared cooldown, then drained cleanly.  
Stage B stayed in proactive enrichment defer mode without activating shared cooldown.

---

## Throughput

| Wave | New matches | Dup % | Wall-clock | Matches/hour | Riot calls | Calls/new | Cooldown wall |
| ---- | ----------- | ----- | ---------- | ------------ | ---------- | --------- | ------------- |
| Phase 6B | 52 | low (first-touch) | ~30+ min incl floors | poor amid stalls | n/a | n/a | ~30 min |
| Phase 6B.1 | 13 | **75%** | ~10 min | n/a as fresh proof | 111 | ~8.5 | 0 |
| Stage A | **62** | **16%** | 37.7 min | **98.6** | 358 | ~5.8 | ~15 min (1×) |
| Stage B | **113** | **33%** | 20.8 min | **326.1** | 573 | ~5.1 | **0** |

Primary metric (useful new data / wall-clock): Stage B is the decisive fresh-load result.

---

## Rank quality

| Checkpoint | exact | resolution | PENDING | health |
| ---------- | ----- | ---------- | ------- | ------ |
| Pre-6B.2 baseline | 98.0% | 98.5% | 14 | MATURE |
| Post Stage A | 99.7% | 100% | 0 | MATURE |
| Post Stage B | 99.7% | 99.9% | 3 | MATURE |

PENDING remained PENDING until enrichment resolved it. No unresolved→UNKNOWN conversion.

---

## Aggregate correctness

Spot-check after Stage B:

| Signal | Observation |
| ------ | ----------- |
| ALL rows | 395 → 478 → **602** (never decreased) |
| Exact tiers | fed by `RESOLVED_RANKED` growth (Challenger/GM/Master rows/sampleSize rose) |
| UNKNOWN row inventory | elevated vs `RESOLVED_UNRANKED=5~6` (pre-existing inventory/convergence noise; not PENDING dump) |
| New writes | Stage windows show resolved participants tracking new matches |

Historical UNKNOWN repair was intentionally not performed.

---

## Build preservation smoke

For Stage-window new matches:

| Stage | New matches | itemIds length=7 | perk styles present | matches with timeline events |
| ----- | ----------- | ---------------- | ------------------- | ---------------------------- |
| A | 62 | 398/620 participants | 70/620 | 7/62 |
| B | 113 | 804/1130 participants | 270/1130 | 21/113 |

Smoke samples prove the **new preservation path can persist**:

- 7-slot `itemIds` (incl. zeros when present)
- `primaryPerkStyleId` / `secondaryPerkStyleId`
- `MatchTimelineEvent` ITEM_* / SKILL_LEVEL_UP rows

Coverage is **not yet universal** across every newly ingested match/participant. Treat as smoke validation that the path is live, not as 100% build-analytics readiness. No historical refetch; no build analytics implemented.

---

## Comparison table

| Metric | Phase 6B | Phase 6B.1 | Stage A | Stage B |
| ------ | -------- | ---------- | ------- | ------- |
| new matches | 52 | 13 | 62 | **113** |
| duplicate % | low (first-touch) | **75%** | **16%** | **33%** |
| wall-clock | ~30+ min + stalls | ~10 min | 37.7 min | **20.8 min** |
| matches/hour | poor amid CD | n/a fresh | 98.6 | **326** |
| Riot calls | n/a | 111 | 358 | 573 |
| Riot calls/new match | n/a | ~8.5 | ~5.8 | **~5.1** |
| proactive wait | n/a | heavy | moderate | heavy (enrichment) |
| 429 / shared CD activations | **3** | 0 | **1** | **0** |
| cooldown wall time | ~30 min | 0 | ~15 min | **0** |
| peak ingest backlog | tens delayed | low | 19 delayed | bounded / 0 at end |
| peak enrichment backlog | 31 delayed | 36 delayed | bounded + backfill | paced defer / drained |
| rank exact | ~96% freeze | 98.0% | 99.7% | **99.7%** |
| rank resolution | healthy | 98.5% | 100% | **99.9%** |

---

## Developer-key scalability classification

### **A. SCALABLE_ENOUGH_FOR_BOUNDED_REPRESENTATIVE_ACQUISITION**

Reasons:

1. Stage B processed **100+ fresh matches** with **zero** shared cooldown activations.
2. Useful throughput remained high (**~326 matches/hour** wall-clock including enrichment catch-up).
3. Queues stayed bounded and recovered to empty.
4. Rank quality stayed MATURE (≥90% exact + resolution) after drain/backfill.
5. Stage A’s single cooldown did not thrash once the worker budget wiring was correct.

Not claiming uncapped continuous crawl readiness. Classification is for **bounded representative acquisition** under current developer-key windows + 0.75 utilization.

---

## Recommendation

1. **Treat Stage B as the fresh-load proof** that Phase 6B.1 could not provide.
2. Always run worker from a **rebuilt `dist/`** (or `tsx`/`dev`) after budget/preservation changes; stale `start` binaries invalidate pacing.
3. Prefer **small collector batches** (≈4–8) under developer-key long-window pressure; large batches can fail players on budget defer without needing to weaken cooldown.
4. Expect enrichment catch-up / bounded backfill after fresh waves; keep PENDING≠UNKNOWN.
5. Follow up separately on incomplete build-preservation coverage (events/styles not universal on all new matches).
6. Do **not** raise global caps or open Diamond/Emerald/Platinum production waves in this checkpoint.

### Decision

**`READY_FOR_M12_V2_PHASE_6C`**

Rationale: fresh-load Stage B demonstrates the coordinator prevents 429 thrash while preserving useful matches/hour at 80–120 new-match scale. Stopped here for operator review before Phase 6C.

---

## Files touched this phase

### Docs

- `docs/superpowers/plans/2026-08-10-m12-v2-phase-6b2-fresh-load-scalability-report.md`

### Ops helpers (local benchmark)

- `apps/api/scripts/phase6b2-make-ladder-eligible.mjs`
- `apps/api/scripts/phase6b2-make-unrefreshed-eligible.mjs`
- `apps/api/scripts/phase6b2-reset-budget-metrics.mjs`
- `apps/api/scripts/phase6b2-build-preservation-smoke.mjs`
- `apps/api/scripts/phase6b2-aggregate-spotcheck.mjs`
- `apps/api/scripts/phase6b2-stage-a-newmatch-stats.mjs`
- `apps/api/scripts/phase6b2-sum-collector-runs.mjs`

### Artifacts

- `apps/api/.local/m12v2-phase6b2/**`

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Phase 6C / D/E/P / Gold / continuous crawler / frontend / build analytics
- Riot pacing algorithm (no code weaken/raise)
- Git commit
