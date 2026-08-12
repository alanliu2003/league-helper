# M12-v2 Phase 6B Report — Bounded Representative Population Wave (Apex)

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2`  
**Decision:** `PHASE_6B_REQUIRES_REVIEW`

---

## Scope note

Operator-approved Phase 6B for this session is the **first bounded Apex LADDER wave** (Challenger / Grandmaster / Master), continuing the Phase 6A finding that LADDER roots were absent.

This is **not** the plan-document §14 Diamond/Emerald/Platinum wave, **not** the continuous crawler, and **not** a lower-tier expansion.

| Guard | Result |
| ----- | ------ |
| Active DB | `league_helper_m12v2` only (root / api / worker verified; old `league_helper` untouched) |
| Real `.env` files | **not modified** (process-env overrides only for create/scan ceilings) |
| Caps / crawler / lower tiers | untouched |
| Final Master root wait | **stopped** by operator (1/15 LADDER root still missing RankSnapshot) |

---

## Baseline (pre-wave)

| Metric | Value |
| ------ | ----- |
| TrackedPlayer | `PRODUCT_SEARCH:1`, `LADDER:0` |
| LADDER roots by latest Solo tier | none |
| Matches queue 420 / na1 | **23** |
| Current-patch normalized matches (coverage) | **3** |
| Champion-position keys (coverage, patch 16.15) `≥1` / `≥30` / `≥100` | **28 / 0 / 0** |
| Participant `RESOLVED_RANKED` Apex (420/na1) | C **15**, GM **9**, Master **7** |
| ChampionAggregate exact Apex rows | C **28**, GM **18**, Master **14**, ALL **180** |
| Aggregate exact-rank coverage (`aggregates:audit-rank-coverage`) | **97.7%** |
| Rank-quality gate | healthy / MATURE (Phase 6A) |

Artifacts: `apps/api/.local/m12v2-phase6b/baseline-*`.

---

## Dry-run

```text
pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers "CHALLENGER,GRANDMASTER,MASTER" --dry-run --json
```

| Metric | Value |
| ------ | ----- |
| Candidates by tier | Challenger **302**, Grandmaster **717**, Master **10000** |
| `apexCandidates` / `fetched` | **11019** |
| League-v4 list calls | **3** (HTTP 200) |
| `created` | **0** |
| Scan window | scanned **200** → `stoppedReason=scan_ceiling` |
| `wouldNeedIdentityResolve` (scan window) | **199** |
| Estimated if combined apply under scan 200 | ~199 Account-v1 + 3 list ≈ **202** Riot calls (and would starve GM/Master) |

---

## Budget decision

Operating mode: **developer-key** (`100:120`, `20:1` from Phase 1 probe).

| Knob | Choice | Why |
| ---- | ------ | --- |
| Strategy | **3 separate per-tier applies** | Combined candidate order is Challenger-first; Master list (~10k) must not dominate create slots |
| Create budget | **5 / tier** (15 total) | Representation proof, not volume |
| Scan ceiling override | **8 / tier** | Process env only; stop after create cap |
| Caps | unchanged | `COLLECTOR_LADDER_MAX_*` defaults left in files |
| Refresh plan | batch ≤15, `maxMatches=5`, enqueue ≤40 then ≤20 | Bound match fan-out under developer-key |

Estimated enrollment cost (actual ≈ estimate):

| Call class | Estimate | Observed |
| ---------- | -------- | -------- |
| League-v4 apex lists | 3 | 3 |
| Account-v1 identity resolve | ~15 | **14** (`identityResolved` 4+5+5) |
| Enrollment total | ~18 | **17** Riot calls; **0** 429 |

---

## Live enrollment results

| Tier | Created | Identity resolved | Already tracked | Stopped |
| ---- | ------- | ----------------- | --------------- | ------- |
| Challenger | **5** | 4 | 0 | `create_cap` |
| Grandmaster | **5** | 5 | 0 | `create_cap` |
| Master | **5** | 5 | 0 | `create_cap` |
| **Total** | **15** | **14** | **0** | — |

TrackedPlayer after enroll: `LADDER:15`, `PRODUCT_SEARCH:1`. No RankSnapshots yet (expected until refresh).

---

## Refresh / match / enrichment validation

### Collector runs (apply)

| Run | When (UTC) | Claimed / succeeded | Match IDs discovered | Enqueued | Skipped complete | Status |
| --- | ---------- | ------------------- | -------------------- | -------- | ---------------- | ------ |
| 1 | 03:13:34 | 10 / 10 | 48 | **40** | 8 | `PARTIAL` (`budgetExhausted`) |
| 2 | 03:29:23 | 0 / 0 | 0 | 0 | 0 | `COMPLETED` (shared cooldown preflight — no claim) |
| 3 | 03:44:53 | 5 / 5 | 21 | **20** | 1 | `PARTIAL` (`budgetExhausted`) |
| 4 | 03:45:3x | 0 / 0 | 0 | 0 | 0 | `COMPLETED` (cooldown again / no claim) |

Window totals at freeze (`final-obs`, since enroll): playersSucceeded **15** attempts across runs that claimed; matchIdsDiscovered **69**; matchesEnqueued **60**; `rateLimitStops` **0** on collector (429 surfaced as **shared cooldown**, not per-run rateLimitStops).

### Roots refreshed by latest Solo RankSnapshot

| Tier | LADDER roots | Notes |
| ---- | ------------ | ----- |
| Challenger | **5** | all Challenger enrollments refreshed |
| Grandmaster | **5** | all GM enrollments refreshed |
| Master | **4** | 4/5 Master roots refreshed |
| Missing snapshot | **1** | final Master root; **not waited** per operator stop |
| **Refreshed** | **14 / 15** | Apex representation proven without the last root |

Coverage CLI ladder-by-tier at freeze: Challenger **5**, Grandmaster **5**, Master **4**, missing snapshot **1**.

### Match yield

| Scope | Baseline | Freeze | Δ |
| ----- | -------- | ------ | - |
| Matches queue 420 / na1 (wave metrics) | 23 | **75** | **+52** |
| Current-patch normalized (coverage) | 3 | **55** | **+52** |
| All matches in obs window `createdInWindow` | — | **52** | — |
| Unique match yield / refreshed player (collector window helper) | — | **~4** | run budgets were `maxMatches=5` |

---

## Shared 429 cooldown — operational finding

Plan/design success criteria include **“No cooldown thrashing”** (plan Phase 7 evidence package; design continuous-ops health). Repeated full-floor cooldowns under a tiny bounded wave are **not** defined as acceptable.

### Cooldown timeline (15-minute floor)

| # | Approx start (UTC) | Until (UTC) | Waited? | Useful work completed **before** this cooldown |
| - | ------------------ | ----------- | ------- | ---------------------------------------------- |
| **1** | ~03:13:57 | 03:28:57 | **Yes** (~15 min) | Enrollment 15/15; collector run 1: 10 roots refreshed (C5+GM4), 40 matches enqueued, first ingest burst underway |
| **2** | ~03:29:14 | 03:44:14 | **Yes** (~15 min) | Post-CD1 enrichment/ingest catch-up raised match totals (obs ~55→75) and Apex participant/aggregate rows; run 2 correctly no-claimed under cooldown |
| **3** | ~03:45:08 | ~04:00:08 | **No** (operator stop) | Collector run 3: +5 roots (GM1+Master4), +20 enqueued; Apex LADDER RankSnapshots reached 5/5/4 |

**Evaluation counts**

| Metric | Value |
| ------ | ----- |
| Shared cooldown activations observed | **3** |
| Full floors waited through | **2** |
| Waited cooldown wall time | **~30 minutes** |
| Estimated lost wall time (waited) | **~30 minutes** productive stall; gap CD1→CD2 was only ~17s → immediate re-trigger (**thrash**) |
| At report freeze | 3rd cooldown still active; **no further live Riot work** |

### Unique matches per cooldown cycle (approx)

| Cycle | Evidence | Unique / new matches (approx) |
| ----- | -------- | ----------------------------- |
| Burst → CD1 | Run 1 enqueue 40; wave 420 matches 23→40 by post-refresh metrics; obs `createdInWindow` 17 @ 03:24 | **~17–32** completing through CD1 window |
| CD1 clear → CD2 | Obs matches 55→75 while enrichment resumed then re-cooled | **~20** additional completions |
| CD2 clear → CD3 (run 3) | Enqueue 20; obs `createdInWindow` →52; coverage current-patch →55 | **~15–20** additional (ingest still draining under CD3 at freeze) |

### Peak enrichment backlog / queue boundedness

| Signal | Peak observed | Freeze |
| ------ | ------------- | ------ |
| `participant-rank-enrichment` delayed | **31** (`mid2-obs`) | 24 |
| `match-ingestion` delayed | **23** (`post-refresh-obs`) | 8 |
| Waiting/active (ingest + enrichment + agg) | stayed near **0** waiting/active | delayed-only backlog |
| Queues unbounded growth? | **No** — delayed jobs re-wake under cooldown; depths stayed tens, not thousands | bounded |
| Collector `rateLimitStops` | 0 | cooldown preflight blocked claims instead |

Shared cooldown **worked** (no Riot storm while cooling). The failure mode is **burstiness**: acquisition + softSync + match-id discovery + match detail/timeline + co-participant League-v4 enrichment collide under developer-key, producing back-to-back 15-minute floors.

---

## Coverage / rank changes

### Champion coverage (coverage CLI, na1 / patch 16.15)

| Threshold | Baseline | Freeze |
| --------- | -------- | ------ |
| champion-position `≥1` | 28 | **218** |
| `≥30` | 0 | **0** |
| `≥100` | 0 | **0** |

Wave-metrics ALL-tier champion-position keys (all patches): 131 → **248** (`≥1`); still 0 at 30/100.

### Participant observations (RESOLVED_RANKED, 420/na1)

| Tier | Baseline | Freeze |
| ---- | -------- | ------ |
| Challenger | 15 | **222** |
| Grandmaster | 9 | **183** |
| Master | 7 | **121** |

### ChampionAggregate exact rows (420/na1)

| Tier | Baseline | Freeze |
| ---- | -------- | ------ |
| Challenger | 28 | **201** |
| Grandmaster | 18 | **211** |
| Master | 14 | **184** |
| ALL | 180 | **370** |

Exact Apex dimensions remain **distinct** (no Challenger collapse).

### Rank coverage

| Source | Baseline | Mid-wave (pending spike) | Freeze |
| ------ | -------- | ------------------------ | ------ |
| `aggregates:audit-rank-coverage` known% | **97.7%** | — | **96.1%** (711/740) |
| Obs `exactRankCoverage` | — | ~93.6% with pending 18–32 | **96.1%** |
| Obs `rankResolutionCoverage` | — | ~94.4–94.9% | **96.8%** |

Transient dip during pending enrichment under cooldown is expected; freeze remains above preferred ≥80% and above hard block ≤60%.

---

## Cost / Riot fan-out (measurable + estimated)

| Phase | Measurable | Est. fan-out notes |
| ----- | ---------- | ------------------ |
| Dry-run | 3 league-v4 lists | lists only |
| Enroll apply | 3 lists + 14 Account-v1 | ~17 calls; 0×429 |
| Refresh run 1 | softSync League-v4 + match-v5 ids for 10 players; enqueue 40 | ~2 League-v4 + ~1–2 match-id calls/player observed in logs; then ≤40 match detail (+ timeline) via worker |
| Refresh run 3 | 5 players; enqueue 20 | same pattern, smaller |
| Enrichment | League-v4 by PUUID per unresolved co-participant | dominant 429 source after ingest; deferred with `SHARED_COOLDOWN_ACTIVE`, `riotCalled=false` |

Enrollment alone is cheap. **Ingest + co-participant enrichment** is the burst that exhausts developer-key budget.

---

## Risks

1. **Cooldown thrashing under developer-key** — two full floors waited (~30 min) plus a third at freeze after a small Master refresh; not sustainable for continuous crawling.
2. **Request fan-out amplification** — each enrolled root → softSync + match ids + N match details/timelines + up to ~9 co-participant rank lookups.
3. **No sticky acquisition tier on TrackedPlayer** — root tier observability still depends on RankSnapshot after refresh (1 Master still missing at freeze).
4. **Combined multi-tier ladder-seed remains unsafe** without per-tier budgets (Master volume).
5. Plan §14 D/E/P waves would be **larger** than this Apex probe — unsafe until pacing/budget coordination exists.

---

## What was proven

1. LADDER enrollment works for Challenger, Grandmaster, and Master with explicit per-tier budgets.
2. Apex LADDER representation after refresh: **5 / 5 / 4** (plus 1 Master enrolled but not refreshed).
3. Refresh creates RankSnapshots; ingestion + enrichment populate distinct Apex participant and aggregate dimensions.
4. Champion coverage `≥1` improved sharply on current patch; `≥30` / `≥100` remain zero (sample depth still low).
5. Shared cooldown correctly stops further Riot calls — but the **wave shape is too bursty**.

---

## Files created / used

### New (this phase)

- `apps/api/scripts/phase6b-wave-metrics.mjs` — read-only DB metrics (`league_helper_m12v2` guard)
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-6b-representative-wave-report.md` — this report
- Local artifacts under `apps/api/.local/m12v2-phase6b/` (dry-run, applies, collector runs, baselines, finals)

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Cap increases, continuous crawler, lower-tier acquisition, Phase 6C
- Old DB `league_helper`
- Git commit

---

## Recommendation (next step — not started)

**Introduce proactive Riot request pacing / budget coordination before larger representative population waves.**

Suggested direction (design only until approved):

- Cross-queue request budget (collector refresh, match ingestion, participant-rank enrichment) under a shared developer-key envelope
- Pace enrichment behind ingest (smaller waves, longer spacing, or explicit token bucket) so a 15-minute floor is rare, not the default cycle
- Keep per-tier enrollment budgets; do not raise caps until cooldown thrash is gone

Do **not** start Phase 6C / D/E/P waves until pacing review lands.

---

## Decision

**`PHASE_6B_REQUIRES_REVIEW`**

Rationale:

- Apex LADDER enrollment + representation goals largely succeeded (5/5/4 refreshed; strong match/coverage deltas; rank dimensions intact).
- Spec/plan explicitly requires **no cooldown thrashing**; this bounded wave produced **repeated shared 429 floors** (~30 minutes waited, immediate CD1→CD2 re-trigger, third cooldown at freeze).
- Therefore the wave is **not** an automatic green light for larger population waves.

Stop state: no further live Riot acquisition/refresh for this wave; final Master root left unrefreshed by design of this stop.
