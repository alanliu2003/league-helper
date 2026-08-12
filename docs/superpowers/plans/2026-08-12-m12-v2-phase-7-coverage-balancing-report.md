# M12-v2 Phase 7 — Coverage Balancing / Hard-Cap Evidence Gates

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (verified before every DB-backed audit; `league_helper` untouched)  
**Real `.env` files:** not modified  
**Continuous crawler / scheduler:** not enabled  
**Hard caps:** not raised  
**Phase 8:** not started  

**Artifacts:**

- `apps/api/.local/m12v2-phase7/phase7-audit.json`
- `apps/api/.local/m12v2-phase7/phase7-coverage-patch.json`
- `apps/api/.local/m12v2-phase7/phase7-audit.mjs`
- `apps/api/.local/m12v2-phase7/phase7-coverage-patch.mjs`

Prior-wave evidence reused from Phase 6B / 6B.2 / 6C / 6D / 6D.1 / 6E reports + local artifacts. No new enrollment wave. No tiny refresh sample required.

Official rank health CLI (worker):

```text
eligibleRankedParticipants=13530
PENDING=0 FAILED_RETRYABLE=0 FAILED_PERMANENT=0
RESOLVED_RANKED=13471 RESOLVED_UNRANKED=59
rankResolutionCoverage=100.0%
exactRankCoverage=99.6%
health=MATURE
```

---

## Executive decision

Representative Challenger→Iron population acquisition is complete and operationally healthy under current caps. Product champion-position depth on current patch **16.15** still has **0** cells at ranking floor ≥100 (max sample **93**). Hard-cap raise gates that require true **Δ / day** evidence are **not** met from bounded waves alone.

| Decision | Value |
| -------- | ----- |
| Segment budgets | **REBALANCE_SEGMENT_BUDGETS** (within current caps; no raise) |
| Hard caps | **INSUFFICIENT_EVIDENCE_FOR_CAP_RAISE** |
| Phase | **READY_FOR_M12_V2_PHASE_8** |

Primary question answer: **B + D** — rebalance acquisition/refresh weight inside current caps; do **not** raise hard caps on this evidence package. Prefer **D** over “collect more evidence before changing anything” for caps specifically; segment rebalance recommendation does **not** require another large wave.

---

## Current population representation

### Tracked inventory (live)

| Source | Count |
| ------ | ----- |
| Total tracked players | **271** |
| LADDER | **270** |
| PRODUCT_SEARCH | **1** |
| MATCH_PARTICIPANT | **0** |
| Budget counters | tracked **271** / ladder **270** |

### LADDER roots by latest RANKED_SOLO_5x5 RankSnapshot

| Tier / division | Roots |
| --------------- | ----- |
| CHALLENGER | **28** |
| GRANDMASTER | **18** |
| MASTER | **8** |
| DIAMOND I–IV | 6 / 6 / 6 / **5** (**23**) |
| EMERALD I–IV | 6 / 6 / 6 / 6 (**24**) |
| PLATINUM I–IV | 6 / 6 / **12** / 8 (**32**) |
| GOLD I–IV | 10 / 10 / 10 / 10 (**40**) |
| SILVER I–IV | 8 / 8 / 8 / 8 (**32**) |
| BRONZE I–IV | 8 / 8 / 8 / 8 (**32**) |
| IRON I–IV | 8 / 8 / 8 / **7** (**31**) |
| MISSING_SNAPSHOT | **2** |
| **LADDER total** | **270** |

Segment root totals: Apex **54** · High (D/E/P) **79** · Gold **40** · Low (S/B/I) **95** · missing **2**.

### Refresh / activity signals (persisted proxies)

HOT/WARM/COLD at finalize also depends on per-run `enqueuedNewCount` (not persisted). Reported proxies:

| Signal | Observation |
| ------ | ----------- |
| Priority 100 (HOT config) | **216** LADDER |
| Priority 50 (WARM config) | **54** LADDER + 1 PRODUCT_SEARCH |
| `consecutiveZeroNewMatchRuns` ≥1 | Apex **35**/54 · High **11**/79 · Gold **7**/40 · Low **1**/95 |
| `consecutiveZeroNewMatchRuns` ≥3 (COLD threshold default) | **0** |
| Never refreshed | **1** (among missing-snapshot / other) |
| Refresh age | &lt;1h **21** · 1–6h **124** · 6–24h **45** · 24–72h **79** · &gt;72h **0** |

Median refresh age by segment: Low ~**1.7h** · Gold ~**5.8h** · Apex ~**24.1h** · High ~**24.2h**.

**Root vs participant distinction:** root counts prove enrollment representation only. Sample mass for analytics is participant-rank attribution (next section), not root counts.

---

## Participant sample representation

Scope: `queueId=420`, `platformRoute=na1`, `COMPLETED`, `remake=false`.

| Tier / status | Absolute samples | % of exact-ranked mass |
| ------------- | ---------------- | ---------------------- |
| Challenger | 949 | 7.0% |
| Grandmaster | 1019 | 7.6% |
| Master | 1404 | 10.4% |
| **Apex subtotal** | **3372** | **25.0%** |
| Diamond | 993 | 7.4% |
| Emerald | 1504 | 11.2% |
| Platinum | 1934 | 14.4% |
| **High subtotal** | **4431** | **32.9%** |
| Gold | 1952 | 14.5% |
| Silver | 1543 | 11.5% |
| Bronze | 1470 | 10.9% |
| Iron | 703 | 5.2% |
| **Low subtotal** | **3716** | **27.6%** |
| **RESOLVED_RANKED total** | **13471** | 100% |
| RESOLVED_UNRANKED | 59 | n/a (not exact) |
| PENDING / FAILED_* | 0 / 0 | — |

### Over / under-representation (sample mass, not roots)

- **High** is the largest exact sample segment (~33%) despite fewer roots than Low — expected because High + Apex matches contribute mixed-tier co-participants.
- **Apex** remains large (~25%) relative to root share (54/270 ≈ 20%) — co-participant gravity from high-elo games; not treated as a reason to enroll more Apex roots.
- **Iron** is the thinnest exact tier (~5.2%) despite 31 roots — lower unique graph overlap into exact Iron labels.
- **Gold** (~14.5%) is healthy mid-band mass after Phase 6D.
- Do **not** compare root counts as if they were sample counts.

---

## Champion-position coverage

### Product scope (authoritative): patch **16.15**, ALL, positions TOP/JUNGLE/MIDDLE/BOTTOM/SUPPORT

Live DB verify:

| Floor | Cells |
| ----- | ----- |
| ≥1 | **484** |
| ≥5 | 264 |
| ≥10 | 208 |
| ≥20 | 130 |
| ≥30 | **78** |
| ≥50 | 24 |
| ≥75 | 5 |
| ≥100 | **0** |
| ≥150 | 0 |
| ≥200 | 0 |
| Max sample | **93** |

### By position (16.15 ALL)

| Position | ≥1 | ≥5 | ≥10 | ≥20 | ≥30 | ≥50 | ≥75 | ≥100 |
| -------- | -- | -- | --- | --- | --- | --- | --- | ---- |
| TOP | 113 | 55 | 46 | 28 | 16 | 2 | 0 | 0 |
| JUNGLE | 83 | 59 | 44 | 26 | 17 | 4 | 0 | 0 |
| MIDDLE | 107 | 56 | 43 | 25 | 13 | 5 | 1 | 0 |
| BOTTOM | 88 | 45 | 39 | 23 | 14 | 7 | 2 | 0 |
| SUPPORT | 93 | 49 | 36 | 28 | 18 | 6 | 2 | 0 |

### Metric note vs Phase 6E prose

Phase 6E reported ALL ≥1 **585** / ≥30 **78** / ≥100 **0**. Live:

- ≥30 / ≥100 match (**78** / **0**).
- ≥1 **484** on current patch alone.
- Cross-patch **unique** champion×position cells with any ALL sample ≈ **583** (aligns with Phase 6E’s ~585).

Phase 7 treats **current-patch floors** as product depth. Phase 6E ≥1=585 is retained as the cross-patch unique-breadth figure for velocity continuity.

### Exact-tier current-patch breadth (cells ≥1 / max sample; all ≥30 = 0)

| Tier | ≥1 | Max sample |
| ---- | -- | ---------- |
| Challenger | 234 | 18 |
| Grandmaster | 260 | 26 |
| Master | 306 | 24 |
| Diamond | 211 | 11 |
| Emerald | 246 | 13 |
| Platinum | 233 | 15 |
| Gold | 212 | 12 |
| Silver | 217 | 11 |
| Bronze | 190 | 14 |
| Iron | 128 | 7 |

Exact-tier views have breadth but remain far below ranking floor 30.

### Matchup diagnostic (16.15 only; no MatchupAggregate writer)

| Floor | Directional pairs |
| ----- | ----------------- |
| ≥1 | **4722** |
| ≥5 | **68** |
| ≥10 | **2** |
| ≥20 | **0** |
| ≥30 | **0** |
| Max pair games | **10** |

Matches with all five lane pairs: **669/669**; pairing skip slots: **0** on current-patch COMPLETED non-remake set.

---

## Coverage velocity

### Measured 24h / day gates

| Metric | Status |
| ------ | ------ |
| Δ champion-position cells ≥30 / day | **NOT_YET_OBSERVED_OVER_24H** |
| Δ current-patch matches / day | **NOT_YET_OBSERVED_OVER_24H** |
| Δ unique matches / day | **NOT_YET_OBSERVED_OVER_24H** |

No continuous 24h observation window was run. Phase 7 did not launch a wave to fabricate a daily metric.

### Bounded-wave velocity (measured; not a /day PASS)

| Wave | Roots | Wall | Δ unique matches (420/na1) | Matches/hour | Δ ≥30 (reported) | Δ ≥1 (reported series) |
| ---- | ----- | ---- | -------------------------- | ------------ | ---------------- | ---------------------- |
| 6C High D/E/P | 80 | ~57.8 min | **+408** (271→679) | ~**424** | 6→31 (**+25**) | 377→488 (**+111**) |
| 6D Gold | 40 | ~88.8 min | **+206** (679→885) | ~**125** (soft=55 idle) | 31→43 (**+12**) | 488→514 (**+26**) |
| 6D.1 Apex re-refresh | 25 | ~13.1 min | **+44** (885→929) | ~**202** | n/a (depth-focused ops) | n/a |
| 6E Silver | 32 | ~45.9 min | **+160** | ~**209** | — | — |
| 6E Bronze | 32 | ~44.9 min | **+156** | ~**209** | — | — |
| 6E Iron | 32 | ~61.5 min* | **+155** | ~**151*** | — | — |
| 6E total | 96 | ~2.5 h stages | **+471** (929→1400) | — | 56→78 (**+22**) | 519→585 (**+66**) |

\*Iron wall includes shared-cooldown pause.

### Clearly labelled projections (not observations)

If one naively annualizes Phase 6E Silver/Bronze ~209 matches/hour without idle/cooldown, that is **≠** a measured Δ/day. No such projection is used as a hard-cap PASS.

Approx wave-normalized ≥30 velocity (bounded only):

- 6C: +25 / ~0.96 h ≈ **26 cells/hour** of wall during fresh High enrollment  
- 6D: +12 / ~1.48 h ≈ **8 cells/hour**  
- 6E: +22 across ~2.5 h stages ≈ **9 cells/hour**

These show **diminishing ≥30 gains per wall-hour** as breadth fills — not a 24h gate pass.

---

## Unique-match yield by segment

| Segment | Evidence wave | Roots refreshed | Unique new matches | Dup rate | Unique/root | Wall | Unique/hour | Yield class |
| ------- | ------------- | --------------- | ------------------ | -------- | ----------- | ---- | ----------- | ----------- |
| Apex (re-refresh) | 6D.1 | 25 | +44 | **64.8%** | ~1.8 | 13.1 min | ~202 | **LOW** (marginal unique; high skip) |
| High D/E/P (fresh) | 6C | 80 | +408 | low (first-touch) | ~5.1 | 57.8 min | ~424 | **HIGH** |
| Gold (fresh, soft=55) | 6D | 40 | +185 focused / +206 DB | **15.9%** | ~4.6 | 88.8 min | ~125 | **MEDIUM** (yield ok; wall padded by soft idle) |
| Silver | 6E | 32 | +160 | **0%** | 5.0 | 45.9 min | ~209 | **HIGH** |
| Bronze | 6E | 32 | +156 | **0%** | 4.9 | 44.9 min | ~209 | **HIGH** |
| Iron | 6E | 32 | +155 | **3.1%** | 4.8 | 61.5 min* | ~151* | **HIGH** (fresh); wall includes CD pause |

Riot admits/new-match: Phase 6C reported ~**4.9** Riot calls/new match. Phase 6D.1 admits were enrichment-heavy on duplicate Apex refresh (not a fresh-yield comparator).

Yield class reflects **acquisition efficiency**, not player skill value.

---

## Statistical depth movement

| Checkpoint | Matches 420/na1 | ≥1 (series) | ≥30 | ≥100 | Matchup ≥1 / ≥5 / ≥10 / ≥20 / ≥30 |
| ---------- | --------------- | ----------- | --- | ---- | --------------------------------- |
| Pre-6C | 271 | 377 | 6 | 0 | (earlier audit denser later) |
| Post-6C | 679 | 488 | 31 | 0 | — |
| Post-6D | 885 | 514 | 43 | 0 | 3740 / 28 / 2 / 0 / 0 |
| Pre-6E | 929 | 519 | 56 | 0 | 3998 / 38 / 2 / 0 / 0 |
| Post-6E / Phase 7 live | **1400** | **585** cross-patch unique / **484** current-patch | **78** | **0** | **4722 / 68 / 2 / 0 / 0** |

### Breadth vs depth

- Early waves (6B→6C) mainly bought **breadth** (≥1) and the first useful ≥30 band.
- Later waves (6D→6E) still add ≥1 cells, but **≥30 growth slowed** and **≥100 never appeared**.
- Matchups gained low-floor pairs; **no** pairs reached ≥20/≥30.

**Answer:** additional broad random enrollment is approaching **diminishing returns** for display-floor depth. Further population growth without a depth strategy (targeted refresh of existing diverse roots, longer history per root, or accepting longer calendar time) is unlikely to unlock ≥100 cells efficiently.

---

## Refresh efficiency

| Segment | Median age since success | Zero-new streak ≥1 | Notes |
| ------- | ------------------------ | ------------------ | ----- |
| Low | ~1.7 h | 1/95 | Fresh 6E cohort; still HOT-priority heavy |
| Gold | ~5.8 h | 7/40 | Some WARM after first touch |
| Apex | ~24 h | 35/54 | Re-refresh already showed **64.8%** duplicates in 6D.1 |
| High | ~24 h | 11/79 | Aging toward WARM; still useful if not over-polled |

### Observed eligibility starvation (carry-forward ops lesson)

Phase 6D: already-refreshed Gold roots became due again on ~60m HOT cadence and could starve remaining unrefreshed cohort roots until re-parked. **No production policy change in Phase 7.** Future continuous mode should prefer cohort-complete fairness over raw HOT priority when running focused waves.

Apex is the clearest “refreshed too frequently relative to unique yield” segment under current intervals.

---

## Worker throughput

From Phase 6C–6E bounded waves:

| Queue | Peak waiting/pending (observed) | Convergence |
| ----- | ------------------------------- | ----------- |
| match-ingestion | ≤19 (6B.2 Stage A CD window); typical later ≤5 | Drained after waves |
| participant-rank-enrichment | ≤45 (6E Bronze); 6C mid-wave deferred hundreds then recovered | Drained; MATURE restored |
| champion-aggregation | ≤2 typical | Drained |

- Unbounded growth: **not observed** in successful paced waves.
- Catch-up: 6C enrichment lagged match flood (temporary YELLOW) then recovered via bounded backfill + drain; 6E Iron required ~13 min cooldown+enrich drain before resume.
- Acquisition can briefly outrun enrichment under batch pressure; Phase 6D.1 softGate=71 + enrich-aware soft wait kept collector from magic-55 idle while preserving drain behavior.

**Classification:** **PRESSURED_BUT_CONVERGENT** during waves → **HEALTHY** at Phase 7 idle (queues drained in 6E final state; no live acquisition running for this audit).

---

## Queue/backpressure health

| Check | Result |
| ----- | ------ |
| Runaway ingest/enrich/agg | Not observed under paced batch=1 model |
| Phase 6D.1 pressure tuning | Remains effective (6E: soft enrichPending=0 ≈0; no magic-55 regression) |
| Shared cooldown interaction | One Iron pause; clean resume; no thrash |
| Overall | **PRESSURED_BUT_CONVERGENT** under load; idle healthy |

---

## Riot rate-limit health

| Signal | Evidence |
| ------ | -------- |
| Authoritative admission | `RiotRequestBudgetStore` util **0.75** |
| Soft long gate | **71** (util 75 − margin 4); hard heuristic **85** |
| Proactive deferrals | Normal / expected (6C–6E) |
| Soft waits | Dominated 6D (over-conservative 55); fixed in 6D.1; 6E clean |
| Hard waits | **0** in 6D / 6D.1 / 6E |
| Shared cooldown | **1** isolated (6E Iron); recovered ~13–14 min; **no post-resume re-429 thrash** |
| 429 thrash | **None** after coordinator + correct worker dist |

**Classification:** **NEAR_CURRENT_SAFE_LIMIT**

Do **not** revert softGate=71 solely because of one isolated Iron cooldown. Headroom above soft is small (71→75 util ceiling); raising acquisition intensity further without longer calendar pacing increases cooldown probability.

---

## Rank-quality health

| Metric | Live value | Gate |
| ------ | ---------- | ---- |
| exactRankCoverage | **99.6%** | Prefer ≥80% — **PASS**; ≫60% RED floor |
| rankResolutionCoverage | **100%** | Mature ≥90% — **PASS** |
| PENDING | **0** | PASS |
| FAILED_RETRYABLE | **0** | PASS |
| FAILED_PERMANENT | **0** | PASS |
| RESOLVED_RANKED | **13471** | — |
| RESOLVED_UNRANKED | **59** | — |
| health | **MATURE** | PASS |

Semantics spot-check: ALL independent; exact = RESOLVED_RANKED only; UNKNOWN source path = RESOLVED_UNRANKED only (historical aggregate inflation is separate debt).

---

## Storage growth

| Item | Live value |
| ---- | ---------- |
| DB size (`league_helper_m12v2`) | **~247.4 MiB** (259,382,295 bytes) |
| Match rows (all queues) | 1,454 |
| Match 420/na1 | 1,400 |
| Approx bytes / match (whole DB / matches) | ~**178 KiB** |
| MatchTimelineEvent rows | 458,706 |
| Timeline events / match | ~**315** |

### Major tables (total relation size)

| Table | ~Total bytes | Live tuples | Notes |
| ----- | ------------ | ----------- | ----- |
| MatchTimelineEvent | **~189 MiB** | 458,706 | **Dominant**; indexes (~119 MiB) &gt; heap (~70 MiB) |
| MatchParticipant | ~18.7 MiB | 14,654 | |
| ChampionAggregate | ~11.8 MiB | 19,906 | |
| ParticipantRankObservation | ~7.7 MiB | 10,974 | |
| Match | ~1.0 MiB | 1,454 | |
| MatchTimeline | ~0.9 MiB | 1,454 | |

### Clearly labelled projections (not observed)

Using ~178 KiB/match whole-DB average:

| Extra matches | Rough added size |
| ------------- | ---------------- |
| +10k | ~**1.7 GiB** |
| +100k | ~**17 GiB** |
| +1M | ~**170 GiB** |

Timeline-event growth dominates. Index-heavy `MatchTimelineEvent` is the first scaling concern for continuous ops; **no schema optimization in this audit**.

**Storage gate at current scale:** **acceptable**. At +100k/+1M projections, timeline storage becomes a planning input before any large cap raise.

Phase 6 wave growth (matches 271→1400) is the observed acquisition expansion; absolute DB bytes before 6C were not re-measured here.

---

## Current hard-cap inventory

Documented defaults (`.env.example` / config; real env not edited by agent). Usage from DB budget counters.

| Cap / bound | Current value | Usage | Binding? |
| ----------- | ------------- | ----- | -------- |
| `COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP` | **5000** | 271 | **NOT_BINDING** |
| `COLLECTOR_LADDER_MAX_TOTAL` | **3000** | 270 | **NOT_BINDING** |
| `COLLECTOR_LADDER_MAX_NEW_PER_RUN` | **100** | wave creates 6–10/cell ≪ | **NOT_BINDING** (per-run) |
| `COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION` | **1** | blocked Platinum page-2 in 6C | **CURRENTLY_BINDING** for deep ladder pages |
| `COLLECTOR_LADDER_MAX_CANDIDATES_SCANNED` | **500** | scan ceilings used in waves | situational |
| `COLLECTOR_LADDER_TIERS` / representative allowlist | Apex + High+Mid default; Low via `--tiers` | Low enrolled in 6E | allowlist policy, not numeric hard cap |
| `COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS` | **500** | expansion **disabled** (`EXPAND_FROM_PARTICIPANTS=false`); enrolled 0 | **NOT_BINDING** (feature off) |
| Refresh batch / schedule bounds | operator paced batch=1 | — | ops bounds, not global hard cap |
| Scheduler | `COLLECTOR_SCHEDULER_ENABLED=false` (example / ops) | last trigger 2026-08-11; lease null | disabled |
| Global autonomous MATCH_PARTICIPANT budget | 0 enrolled | expansion off | **NOT_BINDING** |

**Are hard caps limiting us today?** **No.** Headroom: ~**4.7k** total tracked, ~**2.7k** ladder. Binding constraints in practice were **page=1**, **per-wave create caps**, **Riot util 0.75**, and **enrichment backpressure** — not the 5000/3000 ceilings.

---

## Segment balancing analysis

Optimize for representative coverage, unique-match yield, statistical depth, and rank-filtered usefulness — **not** equal root counts; avoid high-elo-only bias.

| Segment | Roots | Exact sample % | Fresh unique yield | Depth contribution | Recommendation |
| ------- | ----- | -------------- | ------------------ | ------------------ | -------------- |
| Apex | 54 | 25% | LOW on re-refresh | Strong co-participant gravity already | **LESS new Apex enrollment**; longer refresh interval |
| High | 79 | 33% | HIGH when fresh | Best historical ≥30 mover (6C) | **KEEP / slight MORE refresh** of existing; optional small top-ups only if depth stalls |
| Gold | 40 | 14.5% | MEDIUM–HIGH when not soft-idled | Useful mid-band | **KEEP**; prefer refresh over large new enrollment |
| Low | 95 | 27.6% | HIGH first-touch | Unlocked low-tier views; exact depth still thin | **KEEP representation**; do not chase equal Iron sample % via huge enrollment |

**Future acquisition budget posture:** **REBALANCE_SEGMENT_BUDGETS** within current caps:

1. Stop Apex-heavy enrollment; Apex sample mass is already large.  
2. Prefer refreshing the existing Challenger→Iron population with cohort-fair scheduling.  
3. If any new LADDER creates are needed later, bias High/Gold (depth) and maintain Low presence — not more Apex.  
4. Do **not** raise caps to “fix” ≥100 absence; depth is a sample-concentration problem first.

---

## Hard-cap evidence package

| Evidence item | Observed evidence | PASS / FAIL / INSUFFICIENT | Notes |
| ------------- | ----------------- | -------------------------- | ----- |
| 1. Rank-quality still healthy | exact 99.6%, resolution 100%, MATURE, PENDING 0 | **PASS** | Verified live CLI + audit |
| 2. Δ ≥30 / day | Bounded-wave Δ only (e.g. 6E +22) | **INSUFFICIENT_24H_EVIDENCE** | `NOT_YET_OBSERVED_OVER_24H` |
| 3. Δ current-patch matches / day | Bounded-wave Δ only | **INSUFFICIENT_24H_EVIDENCE** | Same |
| 4. Δ unique matches / day | Bounded-wave Δ only | **INSUFFICIENT_24H_EVIDENCE** | Same |
| 5. Stable worker throughput | Peaks bounded; drain after waves | **PASS** | PRESSURED_BUT_CONVERGENT → idle healthy |
| 6. No cooldown thrashing | One isolated Iron CD; clean resume | **PASS** | NEAR_CURRENT_SAFE_LIMIT; not thrash |
| 7. Storage growth acceptable | ~247 MiB now; timeline-heavy | **PASS** (current scale) | Projections flag timeline before large raise |
| 8. Queue/backpressure healthy | No runaway; 6D.1 tuning effective | **PASS** | |

**Package verdict:** required /day velocity trio is **INSUFFICIENT**. Cap raise is **not** justified by this Phase 7 package.

---

## Continuous-operation readiness

| Control | Status |
| ------- | ------ |
| Scheduler disabled by default | Yes (`COLLECTOR_SCHEDULER_ENABLED=false` in examples; not enabled this phase) |
| PG singleton lease | Present (`CollectorSchedulerState`); currently unowned |
| Shared Riot budget | Present; util 0.75 authoritative |
| Shared cooldown | Present; mandatory; proven recover |
| Queue backpressure | Proven convergent under paced waves |
| Refresh eligibility HOT/WARM/COLD | Present; cohort-starvation lesson documented |
| Deduplication | Present (skip complete matches) |
| Bounded execution | Wave create/page/scan caps + collector bounds |
| Hard caps | Present; currently headroom |
| Rank enrichment convergence | MATURE; PENDING 0 |

**Classification:** **CONTINUOUS_OPS_READY_WITH_CURRENT_CAPS**

Ready for a **future** bounded continuous observation mode under current caps after explicit human enablement. **Not enabled** in Phase 7. Prefer segment-rebalanced refresh weights before any continuous enable. Page=1 and Riot util remain practical limiters.

---

## Known correctness debt

### Historical UNKNOWN aggregate inflation

| Check | Live value |
| ----- | ---------- |
| Eligible RESOLVED_UNRANKED source contributors (420/na1 eligible) | **59** |
| UNKNOWN aggregate sampleSizeSum (all patches, positioned) | **1781** |
| UNKNOWN aggregate sampleSizeSum (16.15) | **602** |
| Discrepancy (all-patch) | **~1722** excess sample mass vs source count |

Discrepancy **persists** (improved vs Phase 6E’s reported 3218 vs ~61, but still far from 1:1). No silent repair performed.

**Impact on Phase 7:** does **not** block segment/cap decisions or Phase 8 docs prep. It **does** mean UNKNOWN / unranked filtered views are not trustworthy until a separately reviewed correctness task rebuilds or reconciles UNKNOWN aggregates from source. Exact-tier and ALL product metrics remain usable; do not reinterpret UNKNOWN as unresolved.

Recommend: separate reviewed correctness task (rebuild UNKNOWN from RESOLVED_UNRANKED only; never convert PENDING→UNKNOWN; never delete MatchParticipants).

---

## Recommendation

1. **Keep hard caps** (5000 / 3000). They are not binding; /day velocity evidence is missing.  
2. **Rebalance within caps:** less Apex enrollment pressure; refresh-first across existing Challenger→Iron; cohort-fair eligibility for focused waves.  
3. Treat ≥100 absence as a **depth** problem, not a cap problem.  
4. Keep softGate=71 / util 0.75 / shared cooldown.  
5. Do not enable continuous crawler until human approval; system is ready under current caps.  
6. Park UNKNOWN inflation as correctness debt; do not scope-expand here.  
7. Enter Phase 8 (rank-aware analytics prep docs only) independently of any deferred cap increase.

---

## Phase 8 readiness

Authoritative next phase: **Phase 8 — Rank-aware analytics preparation** (shared segment vocabulary, read/merge design, cache-key implications, metrics/docs only).

| Gate | Status |
| ---- | ------ |
| Representative Challenger→Iron population | Yes |
| Rank pipeline MATURE | Yes |
| Hard-cap raise required before Phase 8? | **No** |
| Evidence package sufficient to enter Phase 8? | **Yes** |

**Phase decision:** `READY_FOR_M12_V2_PHASE_8`

Phase 8 was **not** started.

---

## Final decisions

### 1. Segment budget decision

**REBALANCE_SEGMENT_BUDGETS**

### 2. Hard-cap decision

**INSUFFICIENT_EVIDENCE_FOR_CAP_RAISE**

### 3. Phase decision

**READY_FOR_M12_V2_PHASE_8**

---

**STOP FOR REVIEW.** Do not raise caps. Do not enable continuous crawler. Do not begin Phase 8 until explicit approval.
