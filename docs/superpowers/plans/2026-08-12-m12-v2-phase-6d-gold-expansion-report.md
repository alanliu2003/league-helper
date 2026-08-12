# M12-v2 Phase 6D Report — Gold Representative Expansion

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (root / api / worker verified; `league_helper` untouched)  
**Real `.env` files:** not modified (process-env budget/concurrency overrides only)  
**Hard caps:** unchanged  
**Decision:** `READY_FOR_M12_V2_PHASE_6E`

Stopped for review. Silver / Bronze / Iron / continuous crawler / frontend / matchup / build-analytics work were **not** started.

Post-wave tuning flag (do **not** apply mid-wave; already preserved unchanged):  
`SOFT_LONG_WINDOW_OVERLY_CONSERVATIVE`

---

## Preconditions

| Check | Result |
| ----- | ------ |
| DB | `league_helper_m12v2` |
| participant-rank-enrichment | drained |
| match-ingestion | drained |
| champion-aggregation | drained |
| PENDING | 0 |
| exactRankCoverage | 99.8% |
| rankResolutionCoverage | 100% |
| shared cooldown | inactive |
| worker dist | budget + timeline-build preservation present |

---

## Baseline

| Metric | Value |
| ------ | ----- |
| LADDER roots | 134 (C24 / GM20 / M10 / D23 / E24 / P32 / Gold **0** / 1 missing snapshot) |
| Matches 420/na1 | **679** |
| Current patch 16.15 COMPLETED | 440 |
| Champion-position ALL | ≥1 **488**, ≥30 **31**, ≥100 **0** |
| Exact participant samples | Apex 2883 / D 1002 / E 1376 / P 1153 / Gold **229** |
| Rank health | MATURE — exact 99.8%, resolution 100%, PENDING 0 |
| Matchup pair depth (16.15) | ≥1 **3392**, ≥5 **18**, ≥10 **0**, max **9** |

Artifacts: `apps/api/.local/m12v2-phase6d/baseline-*`.

---

## Gold dry run

Representative mode, `na1`, page 1, caps `MAX_NEW=10` / `MAX_SCANNED=30`, Gold I–IV.

| Division | Fetched | Already tracked | Identity resolve needed | Est. Riot cost | Potential roots |
| -------- | ------- | --------------- | ----------------------- | -------------- | --------------- |
| GOLD I | 205 | 0 | 30 | 11 | 10 |
| GOLD II | 205 | 0 | 30 | 11 | 10 |
| GOLD III | 205 | 0 | 30 | 11 | 10 |
| GOLD IV | 205 | 0 | 30 | 11 | 10 |
| **Total** | 820 | 0 | 120 | 44 | **40** |

No DB mutation / no Account-v1.

---

## Wave design

| Dimension | Choice |
| --------- | ------ |
| Goal | Prove Gold adds useful depth under the same safe operating model |
| Tier | GOLD only |
| Divisions | I–IV (equal diversity) |
| Creates | **10 per division** (target 32–48) → **40** |
| Refresh | `maxMatches=5`, batch=1, concurrency=1, util 0.75 |
| Expansion | `COLLECTOR_EXPAND_FROM_PARTICIPANTS=false` |
| Hard caps | not increased |
| Soft/hard pressure | enrich soft/hard 40/120; long-window soft/hard **55/85** (unchanged mid-wave) |

---

## Enrollment

| Division | Created | Identity resolved | Identity failures |
| -------- | ------- | ----------------- | ----------------- |
| GOLD I | 10 | 10 | 0 |
| GOLD II | 10 | 10 | 0 |
| GOLD III | 10 | 10 | 0 |
| GOLD IV | 10 | 10 | 0 |
| **Total** | **40** | **40** | **0** |

Provider ladder list calls: 4. Stopped each cell at `create_cap`. Retries: none required.

---

## Refresh

Focused Gold refresh (`collector-batches-v3`):

| Metric | Value |
| ------ | ----- |
| Roots refreshed | **40 / 40** |
| Wall clock | **88.83 min** (`01:55` → `03:23` UTC) |
| Sec / successfully refreshed root | **~121 s** (collector success events; includes soft waits) |
| Discovered / skipped complete / enqueued | 220 / 35 / 185 |
| Duplicate rate | **15.9%** |
| Players failed | 0 (focused v3) |
| Shared cooldown hits during loop | **0** |

Ops notes (not architecture changes):

1. Initial attempt briefly claimed older HOT priority-100 roots; fixed by parking non-wave roots and prioritizing Gold cohort.
2. Near the end, already-refreshed Gold roots became due again (~60m cadence) and starved the last unrefreshed root until refreshed Gold roots were re-parked.

---

## Riot budget behavior

| Metric | Observation |
| ------ | ----------- |
| Shared cooldown activations | **0** |
| `cooldownBlocked` | **0** |
| Hard long-window waits | **0** |
| Soft wait ticks | **264** (~3960 s estimated @ 15s) |
| Soft waits with `enrichPending=0` | **184 / 264 (70%)** |
| Long-window during soft waits | min 56 / p50 70 / mean 67.5 / max 75 |
| Long-window bucket distribution | 55–59: 80; 60–64: 8; 65–69: 7; 70–74: 93; 75: 76 |
| Admits (focused window metrics) | match 431 / refresh 94 / enrichment 1735 / identity 2 |
| Delayed / deferred | 2309 / 984 (proactive pacing) |
| 429 thrash | **none** |

### Throughput finding (post-6D tuning only)

`SOFT_LONG_WINDOW_OVERLY_CONSERVATIVE`

Collector often waited on `longWin > 55` while enrichment backlog was **0** and longWin remained below hard (85) / near util cap (~75). Mid-wave thresholds were **not** changed.

Compare Phase 6C (~80 roots / ~57.8 min / ~43 s/root / ~424 matches/hour): Phase 6D focused refresh was healthy but ~3× slower per root primarily due to soft long-window idle time (~74% of wall).

---

## Match yield

| Metric | Value |
| ------ | ----- |
| Matches 420/na1 before → after | **679 → 885** (**+206**) |
| Focused v3 new matches | **+185** (700 → 885) |
| New matches / refreshed root | **~4.6** (185/40) |
| Matches / hour (focused wall) | **~125** |
| Phase 6B.2 Stage B | ~326 / hour |
| Phase 6C | ~424 / hour |

Gold yield is meaningful but throughput-limited by soft long-window waits, not by Riot 429 floors.

---

## Champion coverage

Champion-position cells (`rankTier=ALL`, 420/na1):

| Threshold | Baseline | After | Δ |
| --------- | -------- | ----- | - |
| ≥1 | 488 | **514** | **+26** |
| ≥30 | 31 | **43** | **+12** |
| ≥100 | 0 | **0** | 0 |

≥100 cells still absent. Gold deepened the useful ≥30 band further; no fabricated success requirement.

---

## Gold representation

| Layer | Result |
| ----- | ------ |
| LADDER roots by latest solo tier | **GOLD = 40** |
| By division | GOLD I/II/III/IV = **10 / 10 / 10 / 10** |
| Exact participant Gold samples | 229 → **1256** |
| Acquisition root rank vs participant rank | Kept distinct; champion stats remain participant-rank authoritative |

---

## Rank quality

| Metric | Baseline | Final |
| ------ | -------- | ----- |
| health | MATURE | **MATURE** |
| exactRankCoverage | 99.8% | **99.8%** |
| rankResolutionCoverage | 100% | **100%** |
| PENDING (health eligible set) | 0 | **0** |
| RESOLVED_UNRANKED | 13 | **20** |

Slow refresh allowed enrichment to keep up asynchronously; no PENDING→UNKNOWN conversion observed on the health eligible set.

Broader spotcheck still sees some PENDING rows outside the health eligible definition (105) — flagged under aggregate correctness, not converted.

---

## Aggregate correctness

| Check | Result |
| ----- | ------ |
| ALL sampleSum | 6610 → **8570** (no decrease) |
| ALL rows | 1674 → **2140** |
| Exact GOLD rows/sampleSum | rose with RESOLVED_RANKED (1458 rows / 2414 samples) |
| UNKNOWN rows/sampleSum | still elevated vs `RESOLVED_UNRANKED≈21` (**carryover review item from 6C**) |
| Historical UNKNOWN repair | **not** performed (no Gold-specific one-off) |

---

## Matchup pair-depth movement

Read-only diagnostic only (no MatchupAggregate writer/API/UI).

| Floor | Previous audit | After Gold | Δ |
| ----- | -------------- | ---------- | - |
| ≥1 | 3392 | **3740** | **+348** |
| ≥5 | 18 | **28** | **+10** |
| ≥10 | 0 | **2** | **+2** |
| ≥20 | 0 | 0 | 0 |
| ≥30 | 0 | 0 | 0 |
| max pair games | 9 | **10** | +1 |

Population growth moved counter depth in the right direction; first ≥10 pairs appeared. Still far from displayable floors for most pairs.

---

## Build preservation smoke

Sample of 8 newly ingested matches since enrollment:

| Result | Value |
| ------ | ----- |
| Strict okCount | **7 / 8** |
| Items / perk styles | present when source supplied |
| Timeline events | ITEM_PURCHASED / DESTROYED / SOLD / UNDO / SKILL_LEVEL_UP on ok samples |
| Fail mode in sample | 1 timeline `FAILED` (source unavailable path) |

Preservation path remains active. Conditional: source-available fields persist; one sampled match lacked timeline fetch.

---

## Queue behavior

| Queue | Peak (focused wave) | Final |
| ----- | ------------------- | ----- |
| match-ingestion | waiting/active/delayed ≤1 | **0** |
| participant-rank-enrichment | pending peak **36** | **0** |
| champion-aggregation | ≤1 | **0** |
| Shared cooldown | inactive | inactive |

No uncontrolled growth; all drained.

---

## Limitations

1. Soft long-window threshold **55** dominated idle time; flag `SOFT_LONG_WINDOW_OVERLY_CONSERVATIVE` for **post–Phase 6D** tuning only (candidate: raise soft toward util cap ~70–75; keep hard/cooldown).
2. Matches/hour (~125) far below Phase 6C (~424) under current soft gate — not a 429 failure.
3. ≥100 champion-position cells still **0**.
4. UNKNOWN aggregate inflation vs RESOLVED_UNRANKED remains a carryover review item (no rewrite this phase).
5. Ops parking of non-wave / already-refreshed roots was required so Gold cohort could claim under priority-DESC eligibility.

---

## Recommendation

`READY_FOR_M12_V2_PHASE_6E`

Phase 6E = later Silver / Bronze / Iron representative expansion.

**Do not start automatically.** Before 6E, review whether to retune soft long-window after this evidence.

### What passed

- Gold I–IV representation (10 each)
- +206 unique matches; coverage ≥1/+26 and ≥30/+12
- Rank health returned/stayed MATURE with PENDING≈0 on health set
- Queues bounded and drained; **0** shared cooldowns
- Build preservation active (7/8 smoke)
- Matchup pair depth improved, including first ≥10 pairs
- Hard caps / crawler / lower tiers untouched

---

## Artifacts

- `apps/api/.local/m12v2-phase6d/**`
- Key summaries: `dry-run-summary.json`, `apply-summary.json`, `collector-batches-v3-summary.json`, `throughput-v3-final.json`, `throughput-finding-midwave.md`, `longwin-distribution.json`, `final-wave-metrics.json`, `final-extras.json`, `final-rank-health.json`, `final-build-smoke.json`, `final-aggregate-spotcheck.json`
