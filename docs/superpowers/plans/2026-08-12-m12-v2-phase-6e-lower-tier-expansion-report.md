# M12-v2 Phase 6E Report — Lower-Tier Representative Expansion

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (verified; `league_helper` untouched)  
**Real `.env` files:** not modified (process-env budget/concurrency overrides only)  
**Continuous crawler:** not enabled  
**Decision:** `READY_FOR_M12_V2_PHASE_7`

Stopped for review. Phase 7 was **not** planned or started.

---

## Preconditions

| Check | Result |
| ----- | ------ |
| DB | `league_helper_m12v2` (root / api / worker) |
| match-ingestion | drained |
| participant-rank-enrichment | drained |
| champion-aggregation | drained |
| PENDING | 0 |
| exactRankCoverage | ~99.8% |
| rankResolutionCoverage | 100% |
| health | MATURE |
| shared cooldown | inactive |
| soft long gate | **71** (Phase 6D.1; not magic 55) |
| worker dist | budget coordinator + timeline-build preservation + enrichment present |
| `COLLECTOR_EXPAND_FROM_PARTICIPANTS` | false |

**Code prerequisite for this phase:** representative ladder allowlist expanded to High+Mid+Low (`SILVER`/`BRONZE`/`IRON` opt-in via `--tiers`). Default env remains High+Mid only.

---

## Baseline

| Metric | Value |
| ------ | ----- |
| LADDER roots | 174 (C28 / GM18 / M8 / D23 / E24 / P32 / Gold40 / Silver**0** / Bronze**0** / Iron**0** / 1 missing) |
| Matches 420/na1 | **929** |
| Current patch 16.15 COMPLETED | 543 (non-remake 535) |
| Champion-position ALL | ≥1 **519**, ≥30 **56**, ≥100 **0**, ≥200 **0** |
| Exact participant samples | Apex 3372 / D 1015 / E 1517 / P 1773 / Gold 1256 / Silver **211** / Bronze **20** / Iron **0** |
| Rank health | MATURE — exact ~99.8%, resolution 100%, PENDING 0 |
| Matchup pair depth (16.15) | ≥1 **3998**, ≥5 **38**, ≥10 **2**, ≥20 **0**, ≥30 **0**, max **10** |
| Tier aggregate cells ≥1 | Silver 225 / Bronze 37 / Iron 0 |

Artifacts: `apps/api/.local/m12v2-phase6e/baseline-*`.

---

## Dry run

Representative mode, `na1`, page 1, caps `MAX_NEW=8` / `MAX_SCANNED=30`, all 12 cells.

| Tier | Cells OK | Fetched | Already tracked | Identity needed | Est. Riot cost | Potential roots |
| ---- | -------- | ------- | --------------- | --------------- | -------------- | --------------- |
| SILVER I–IV | 4/4 | 820 | 0 | 120 | 36 | **32** |
| BRONZE I–IV | 4/4 | 820 | 0 | 120 | 36 | **32** |
| IRON I–IV | 4/4 | 820 | 0 | 120 | 36 | **32** |
| **Total** | **12/12** | 2460 | 0 | 360 | 108 | **96** |

Iron ladder page-1 behavior matched Silver/Bronze (205 fetched / scan_ceiling). No DB mutation / no Account-v1.

---

## Wave design

| Dimension | Choice |
| --------- | ------ |
| Goal | Prove representative low-tier acquisition adds useful depth safely |
| Stages | Silver → Bronze → Iron (per-tier health checkpoints) |
| Creates | **8 per division** → **32 per tier** → **96 total** (80–100 band) |
| Refresh | `maxMatches=5`, batch=1, concurrency=1, util 0.75, softLong **71** |
| Expansion | `COLLECTOR_EXPAND_FROM_PARTICIPANTS=false` |
| Caps / crawler | unchanged / not enabled |

---

## Silver stage

### Enrollment

| Division | Created | Identity resolved | Failures |
| -------- | ------- | ----------------- | -------- |
| SILVER I–IV | 8×4 = **32** | 32 | 0 |

### Refresh

| Metric | Value |
| ------ | ----- |
| Roots refreshed | **32 / 32** |
| Wall clock | **~45.9 min** |
| Sec / root | **~86.0** |
| Discovered / skipped / enqueued | 160 / 0 / 160 |
| Duplicate rate | **0%** |
| New matches (420/na1) | **929 → 1089 (+160)** |
| Matches / hour | **~209** |
| Soft waits | 119 (~1785 s); soft `enrichPending=0`: **0** |
| Hard waits / shared cooldowns | **0 / 0** |
| Queue peaks | ingest 4 / enrich 41 / agg 2 |

### Checkpoint

MATURE — exact ~99.6%, PENDING 0, queues drained, proceed=true.

---

## Bronze stage

### Enrollment

| Division | Created | Identity resolved | Failures |
| -------- | ------- | ----------------- | -------- |
| BRONZE I–IV | 8×4 = **32** | 32 | 0 |

### Refresh

| Metric | Value |
| ------ | ----- |
| Roots refreshed | **32 / 32** |
| Wall clock | **~44.9 min** |
| Sec / root | **~84.1** |
| Discovered / skipped / enqueued | 156 / 0 / 156 |
| Duplicate rate | **0%** |
| New matches | **1089 → 1245 (+156)** |
| Matches / hour | **~209** |
| Soft waits | 109 (~1635 s); soft `enrichPending=0`: **0** |
| Hard waits / shared cooldowns | **0 / 0** |
| Queue peaks | ingest 3 / enrich 45 / agg 2 |

### Checkpoint

MATURE — exact ~99.5%, PENDING 8 (transient; enrich delayed 7), shared cooldown inactive, proceed=true. Acquisition continued under plan (≥80% exact, bounded recovering backlog).

---

## Iron stage

### Enrollment

| Division | Created | Identity resolved | Failures |
| -------- | ------- | ----------------- | -------- |
| IRON I–IV | 8×4 = **32** | 32 | 0 |

### Refresh

| Metric | Value |
| ------ | ----- |
| Roots refreshed | **32 / 32** (27 before pause + 5 after resume) |
| Wall clock (start→end, includes cooldown pause) | **~61.5 min** |
| Sec / root (wall including pause) | **~115** |
| Discovered / skipped / enqueued | 160 / 5 / 155 |
| Duplicate rate | **3.1%** |
| New matches | **1245 → 1400 (+155)** |
| Matches / hour (wall including pause) | **~151** |
| Soft `enrichPending=0` | **0** (observed) |
| Hard waits | **0** |

### Shared cooldown event (documented)

At ~27/32 roots, shared 429 cooldown activated (`cooldownBlocked=1`). Ops harness stopped after 3 consecutive cooldown wait polls (`shared_cooldown_thrash`).

Response (plan-aligned, no pacing weaken):

1. Stopped acquisition  
2. Waited until cooldown inactive and enrich pending ≤20 (~13 min)  
3. Resumed remaining 5 roots with Phase 6D.1 softGate=71  
4. Resume finished cleanly (0 additional cooldowns)

### Checkpoint

MATURE — exact ~99.6%, resolution 100%, PENDING 0, queues drained, cooldown inactive.

---

## Match yield

| Tier | Roots | New matches | Dup % | Matches/root | Wall | Matches/hour |
| ---- | ----- | ----------- | ----- | ------------ | ---- | ------------ |
| Silver | 32 | **+160** | 0% | 5.0 | ~45.9 min | ~209 |
| Bronze | 32 | **+156** | 0% | 4.9 | ~44.9 min | ~209 |
| Iron | 32 | **+155** | 3.1% | 4.8 | ~61.5 min* | ~151* |
| **Phase 6E** | **96** | **+471** | — | ~4.9 | — | — |

\*Iron wall includes shared-cooldown pause.

Comparisons (context only): Phase 6D ~125 matches/hour (old soft=55); Phase 6D.1 ~31.3 s/root (duplicate-heavy Apex); Phase 6C ~424 matches/hour (fresher cohort). Fresh low-tier yield here is closer to 6C efficiency than paced-idle 6D.

Final matches 420/na1: **1400**.

---

## Throughput

| Stage | Sec/root | Soft enrichPending=0 | Hard | Shared CD activations |
| ----- | -------- | -------------------- | ---- | --------------------- |
| Silver | ~86 | **0** | 0 | 0 |
| Bronze | ~84 | **0** | 0 | 0 |
| Iron | ~115 wall / cleaner resume after drain | **0** | 0 | **1** (paused+resumed) |

Phase 6D.1 soft-gate policy remained effective: no return of magic-55 idle with empty enrichment backlog.

---

## Riot budget behavior

| Metric | Observation |
| ------ | ----------- |
| Soft waits with `enrichPending=0` | **~0** across stages |
| Hard long waits | **0** |
| Shared cooldown activations | **1** (Iron late wave) |
| Cooldown wall-clock | ~13–14 min until clear |
| 429 thrash after resume | **none** |
| Admission authority | `RiotRequestBudgetStore` unchanged |
| Product reserve / enrichment share | unchanged |

---

## Champion-position coverage

ALL (420/na1):

| Floor | Before | After | Δ |
| ----- | ------ | ----- | - |
| ≥1 | 519 | **585** | **+66** |
| ≥30 | 56 | **78** | **+22** |
| ≥100 | 0 | **0** | 0 |
| ≥200 | 0 | **0** | 0 |

≥100 cells did **not** appear. Strongest cells now peak ~93 (Ashe BOTTOM) — still below display floor 100.

---

## Tier-specific coverage

ChampionAggregate champion-position cells (420/na1):

| Tier | ≥1 before → after | ≥10 before → after | ≥30 | Max sample |
| ---- | ----------------- | ------------------ | --- | ---------- |
| SILVER | 225 → **498** | 0 → **5** | 0 | 13 |
| BRONZE | 37 → **465** | 0 → **12** | 0 | 14 |
| IRON | 0 → **14** / **373*** | 0 → **2** | 0 | 10 |

\*Iron ≥1 cells: final extras report **373** distinct champion-position cells with sample≥1.

Lower-tier filtered views now exist with meaningful breadth; depth still well below ranking floor 30.

---

## Matchup pair-depth movement

Current-patch diagnostic only (no MatchupAggregate writer/API/UI):

| Floor | Pre-6E | Post-6E | Δ |
| ----- | ------ | ------- | - |
| ≥1 | 3998 | **4722** | +724 |
| ≥5 | 38 | **68** | +30 |
| ≥10 | 2 | **2** | 0 |
| ≥20 | 0 | **0** | 0 |
| ≥30 | 0 | **0** | 0 |
| Max pair games | 10 | **10** | 0 |

Directional movement is positive at low floors; counter-analysis still not display-ready (no pairs ≥20/30). Current-patch pairing skips remained **0**.

---

## Rank quality

| Metric | Final |
| ------ | ----- |
| health | **MATURE** |
| exactRankCoverage | **~99.6%** |
| rankResolutionCoverage | **100%** |
| PENDING | **0** |
| RESOLVED_UNRANKED | 59 |
| FAILED_RETRYABLE / PERMANENT | 0 / 0 |

Exact participant samples after wave: Silver **1622**, Bronze **1530**, Iron **731** (from 211 / 20 / 0).

Semantics preserved: ALL independent of resolution; exact = RESOLVED_RANKED only; UNKNOWN = RESOLVED_UNRANKED only.

---

## Aggregate correctness

Spot-check (420/na1):

| Source | Count |
| ------ | ----- |
| Eligible participants with position | 14000 |
| RESOLVED_RANKED | 13834 |
| RESOLVED_UNRANKED | 61 |
| PENDING (raw status count at spot-check) | 105* |

| Aggregate tier | sampleSizeSum |
| -------------- | ------------- |
| ALL | 13530 (directionally increased with match growth) |
| UNKNOWN | **3218** |
| SILVER / BRONZE / IRON | 3086 / 2940 / 1406 |

\*Rank-enrichment health (eligible ranked scope) reported PENDING **0** / MATURE at the same final window. Residual PENDING rows outside that health scope need ordinary catch-up vigilance — not converted to UNKNOWN.

### UNKNOWN audit (carried forward)

| Check | Value |
| ----- | ----- |
| RESOLVED_UNRANKED source | **61** |
| Expected UNKNOWN contributor mass | ~61 (order-of-magnitude) |
| Actual UNKNOWN aggregate sampleSum | **3218** |
| Orphan/stale UNKNOWN keys | **still elevated** (historical discrepancy) |

No Silver/Bronze/Iron-specific workaround and no destructive one-off repair performed this phase.

---

## Lower-tier data quality

Per-tier matches created since enroll-since (includes remakes):

| Tier | Matches | 10-participant | Position completeness | UNKNOWN positions | Pairing skips | Remakes | Unranked parts |
| ---- | ------- | -------------- | --------------------- | ----------------- | ------------- | ------- | -------------- |
| Silver | 471 | 100% | ~99.9% | 4 | **3** | 19 | 40 |
| Bronze | 311 | 100% | ~99.9% | 3 | **2** | 13 | 16 |
| Iron | 155 | 100% | ~99.8% | 3 | **2** | 7 | 5 |

Unlike the higher-tier current-patch audit (0 pairing skips), lower-tier ingestion introduces a small number of lane-pairing skips. Not catastrophic; relevant for future matchup writer design.

Build timelines present (`FETCHED`) on sampled preserved matches; ops data-quality timeline counters under-counted enum variants and should not be over-interpreted.

---

## Build preservation

Conditional smoke (4 matches/tier with exact tier participants):

| Tier | Sampled | Pipeline persisted (items+perks) | Conditional rate | Timeline events present |
| ---- | ------- | -------------------------------- | ---------------- | ----------------------- |
| Silver | 4 | 4 | **100%** | ITEM_* + SKILL_LEVEL_UP observed |
| Bronze | 4 | 4 | **100%** | same |
| Iron | 4 | 4 | **100%** | same |

No build-analytics implementation.

---

## Queue behavior

| Queue | Peak waiting/pending | Final |
| ----- | -------------------- | ----- |
| match-ingestion | ≤5 | 0 |
| participant-rank-enrichment | ≤45 | 0 |
| champion-aggregation | ≤2 | 0 |

No runaway growth; drained after catch-up.

---

## Representation (final LADDER roots by division)

| Tier | I | II | III | IV | Notes |
| ---- | - | -- | --- | -- | ----- |
| SILVER | 8 | 8 | 8 | 8 | exact |
| BRONZE | 8 | 8 | 8 | 8 | exact |
| IRON | 8 | 8 | 8 | **7** | 32 created; latest solo snapshot currently shows 31 IRON + snapshot gaps / possible rank movement |

Division diversity preserved; do not over-enroll Silver to compensate.

---

## Limitations

1. One shared 429 cooldown during late Iron required pause + resume (~5 roots). Not repeated thrash after drain.  
2. Champion-position ALL still has **0** cells ≥100.  
3. Matchup pair max remains **10**; ≥20/≥30 still zero — counters not yet viable for product display.  
4. Historical UNKNOWN aggregate sampleSum remains elevated vs RESOLVED_UNRANKED source (carry-forward).  
5. Lower tiers introduce small pairing-skip counts vs prior high-tier 0-skip sample.  
6. One Iron division cell currently shows 7 in snapshot rollup despite 8 creates (snapshot timing / rank movement).  
7. Continuous crawler intentionally **not** enabled.

---

## Recommendation

`READY_FOR_M12_V2_PHASE_7`

Phase 6E proved representative Silver/Bronze/Iron acquisition under Phase 6D.1 pacing, with material coverage and exact-sample gains, rank returning to MATURE, and queues draining. Phase 7 should only be planned after reviewing the complete Apex / High / Mid / Low representative population state.

### What passed

1. Silver/Bronze/Iron representation across divisions  
2. Meaningful new matches (+471)  
3. ALL champion-position depth improved  
4. Tier-specific low-rank aggregate coverage appeared  
5. Rank health MATURE after drain  
6. Queues bounded and drained  
7. Soft `enrichPending=0` idle regression absent  
8. Build preservation 100% on sampled lower-tier matches when source present  
9. Participant-rank semantics intact  
10. Matchup pair depth moved in the expected direction (low floors)

### Review note

Treat the single Iron shared-cooldown pause as an ops lesson for Phase 7 planning (enrichment backlog + long window near util ceiling), not as a reason to re-enable magic-55 soft gating.

---

## Files touched (this phase)

| Path | Role |
| ---- | ---- |
| `apps/api/src/features/collector/collector.config.ts` | allowlist High+Mid+Low |
| `apps/api/src/features/collector/collector-coverage.service.ts` | representative tiers include Low |
| `apps/api/src/features/collector/collector.args.test.ts` | accept SILVER; reject apex in representative |
| `apps/api/src/features/collector/collector.config.test.ts` | allowlist tests |
| `apps/api/src/features/collector/cli/ladder-seed.ts` | help example |
| `.env.example` | document Low opt-in |
| `apps/api/.local/m12v2-phase6e/**` | ops artifacts (local only) |
| `docs/superpowers/plans/2026-08-12-m12-v2-phase-6e-lower-tier-expansion-report.md` | this report |

**Not committed** (per instructions).
