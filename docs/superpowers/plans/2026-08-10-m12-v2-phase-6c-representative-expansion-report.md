# M12-v2 Phase 6C Report — Representative High/Mid Population Expansion

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (root / api / worker verified; `league_helper` untouched)  
**Real `.env` files:** not modified (process-env budget/concurrency overrides only)  
**Hard caps:** `COLLECTOR_LADDER_MAX_TOTAL` / `COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP` unchanged  
**Decision:** `PHASE_6C_REQUIRES_REVIEW`

Stopped for review. Continuous crawler / Gold / Silver–Iron / frontend / matchup work were **not** started.

---

## Baseline

Captured before enrollment (`apps/api/.local/m12v2-phase6c/baseline-*`).

| Metric | Value |
| ------ | ----- |
| DB | `league_helper_m12v2` |
| LADDER roots | 54 (Apex only: C20 / GM19 / M15) |
| High/Mid LADDER roots | **0** Diamond / Emerald / Platinum |
| Matches 420/na1 | 271 |
| Champion-position cells (ALL) | ≥1 **377**, ≥30 **6**, ≥100 **0** |
| Rank health | MATURE — exact **99.7%**, resolution **99.9%**, PENDING 3 |
| ALL aggregates | 602 rows / sampleSum 2700 |
| Queues | drained |
| Shared cooldown | inactive |

Participant exact samples already present from Apex-match peers (not High/Mid roots): Diamond 37 / Emerald 105 / Platinum 61.

---

## Dry run

Representative mode, `na1`, page 1, caps `MAX_NEW=6` / `MAX_SCANNED=20` across Diamond/Emerald/Platinum × divisions I–IV (12 cells).

| Result | Value |
| ------ | ----- |
| Cells OK | 12/12 |
| Fetched / cell | ~205 |
| Already tracked | **0** |
| Identity resolve needed (upper) | all scanned candidates |
| Planned creates | **72** (6 × 12) |
| Enrollment Riot calls upper | ~84 (12 ladder lists + ≤72 Account-v1) |
| Expected unique matches (6B.2 model) | ~338 |

Dry-run did not mutate DB / did not call Account-v1.

---

## Wave design

| Dimension | Choice |
| --------- | ------ |
| Goal | Representative champion-position coverage, not player-count vanity |
| Tiers | Diamond / Emerald / Platinum only |
| Divisions | I–IV (avoid single-division bias) |
| Creates | 6 per tier×division (target 20–30/tier) |
| Refresh | `maxMatches=5`, small batches (4 → 2 → 1), budget util 0.75 |
| Expansion | `COLLECTOR_EXPAND_FROM_PARTICIPANTS=false` |
| Hard caps | not increased |

Platinum III required a follow-up apply with higher scan ceiling after Account-v1 failures; page 2 blocked by `COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION=1`.

---

## Live execution

### Enrollment

| Tier | Created | Notes |
| ---- | ------- | ----- |
| Diamond | 24 | 6 × I–IV |
| Emerald | 24 | 6 × I–IV |
| Platinum | 32 | 16 + remainder (III/IV catch-up) |
| **Total** | **80** | identityResolved 80; 16 resolve failures during first Platinum III pass |

### Refresh

- All **80/80** roots reached `lastSuccessfulRefreshAt`
- Pacing lesson (same as 6B.2): batch-of-many hit `RIOT_REQUEST_BUDGET_DEFERRED` PARTIAL zeros; batch=1 + enrichment pressure waits succeeded cleanly
- Refresh wall-clock ≈ **57.8 min** (`07:57` → `08:55` UTC)

Artifacts: `apps/api/.local/m12v2-phase6c/apply-*`, `collector-*`, `eligible-*`, `final-summary.json`.

---

## Riot budget behavior

| Metric | Observation |
| ------ | ----------- |
| Shared cooldown | **0** activations during Phase 6C live wave |
| 429 thrash | **none** |
| Dominant failure mode on oversized batches | proactive `RIOT_REQUEST_BUDGET_DEFERRED` (PARTIAL, retryable) |
| Useful pattern | batch size 1 + wait until enrichment delayed ≤ ~10 |

Admits during refresh window (pre-refresh → post-refresh snapshot): **~1990** admitted, heavy enrichment share, deferred/delayed elevated by design (proactive pacing).

---

## Queue behavior

| Queue | During wave | Final (stop-for-review snapshot) |
| ----- | ----------- | -------------------------------- |
| match-ingestion | bounded; drained | waiting/active/delayed **0** |
| champion-aggregation | bounded; drained | **0** |
| participant-rank-enrichment | paced deferrals; catch-up backfill | **222 delayed** still draining |
| Shared cooldown | inactive | inactive |

Ingest/aggregation drained. Enrichment still has a deferred backlog — not thrashing, not growing unbounded.

---

## Match yield

| Metric | Value |
| ------ | ----- |
| Unique new matches (420/na1) | **+408** (271 → 679) |
| Roots refreshed | 80/80 |
| Unique matches / refreshed root | **~5.1** |
| Matches / hour (refresh wall-clock) | **~424** |
| Riot admits / new match (refresh window) | **~4.9** |
| Duplicate behavior | mixed; later batches often majority-fresh when paced |

Coverage velocity was useful on developer key without emergency cooldown floors.

---

## Coverage improvement

Champion-position cells (`rankTier=ALL`, 420/na1):

| Threshold | Baseline | After | Δ |
| --------- | -------- | ----- | - |
| ≥1 | 377 | **488** | **+111** |
| ≥30 | 6 | **31** | **+25** |
| ≥100 | 0 | **0** | 0 |

Segment representation (LADDER roots by latest solo tier):

| Segment | Baseline roots | After |
| ------- | -------------- | ----- |
| Apex C/GM/M | 54 | still present (~54) |
| Diamond | 0 | **23** |
| Emerald | 0 | **24** |
| Platinum | 0 | **32** |

Exact participant samples also rose sharply (Diamond 37→463, Emerald 105→685, Platinum 61→570 at wave-end metrics).

≥100 cells remain empty — High/Mid expansion improved the useful ≥30 band but did not yet create ≥100 cells.

---

## Rank quality

**Stop-for-review snapshot (now):**

| Metric | Value |
| ------ | ----- |
| health | **MATURE** |
| exactRankCoverage | **90.8%** |
| rankResolutionCoverage | **91.0%** |
| PENDING | **595** (down from ~2140 mid-catch-up) |
| RESOLVED_UNRANKED | 13–14 |
| FAILED_* dump | not observed |

Post-ingest, enrichment lagged the match flood (coverage temporarily fell to YELLOW ~67–79%). Bounded `aggregates:backfill-participant-ranks` + worker drain recovered to MATURE ≥90%.

PENDING is **not yet near zero**; enrichment still has ~222 delayed jobs. No evidence of PENDING→UNKNOWN conversion in resolution status counts (`RESOLVED_UNRANKED` stayed ~13–14).

---

## Aggregate correctness

| Check | Result |
| ----- | ------ |
| ALL sampleSum | 2700 → **6610** (no decrease) |
| ALL rows | 602 → **1674** |
| Exact tiers | Diamond/Emerald/Platinum rows + sampleSums rose with RESOLVED_RANKED |
| UNKNOWN rows/sampleSum | elevated vs RESOLVED_UNRANKED count (**review item**) |
| Historical UNKNOWN repair | **not** performed |

Code/tests assert PENDING feeds ALL only and never UNKNOWN. The UNKNOWN sampleSum vs `RESOLVED_UNRANKED≈14` mismatch is flagged for review without repair in this phase.

---

## Build preservation smoke

Sample of 8 newly ingested matches (`phase6b2-build-preservation-smoke`):

| Result | Value |
| ------ | ----- |
| Strict okCount | **3 / 8** |
| Event types present | ITEM_PURCHASED / DESTROYED / SOLD / UNDO / SKILL_LEVEL_UP |
| Timeline FETCHED with events | present on ok samples |
| Fail modes in sample | null perk styles and/or 0 timeline events on first participant row |

Preservation path remains active (items/perks/timeline events exist in aggregate counts), but the strict per-match smoke is **not cleanly 8/8**. Treat as review/follow-up, not a blocker to stop the wave.

---

## Representation analysis

What improved:

- High/Mid is no longer an empty LADDER segment
- Divisions I–IV enrolled for Diamond/Emerald/Platinum
- ≥30 champion-position cells improved 5× (6 → 31)
- Exact Diamond/Emerald/Platinum participant samples and aggregate rows expanded materially

What remains sparse:

- ≥100 cells still **0**
- One LADDER root still `MISSING_SNAPSHOT`
- Apex still large in absolute sample mass (expected; High/Mid is additive, not a replacement)
- Gold/Silver/Bronze/Iron intentionally untouched

Population is no longer high-elo-only at the tracked-root layer.

---

## Limitations

1. PENDING still hundreds while enrichment deferred backlog drains — MATURE ≥90% already restored, but not “PENDING near zero”.
2. UNKNOWN aggregate sampleSum remains suspiciously high vs `RESOLVED_UNRANKED`; needs dedicated audit (no historical UNKNOWN rewrite in 6C).
3. ≥100 coverage unchanged.
4. Platinum overshot 20–30 slightly (32) due to identity-failure retry remainder.
5. Build-preservation strict smoke 3/8 — path active, sample quality uneven.
6. Large collector batches remain brittle under long-window budget deferrals; batch=1 is the reliable operator pattern on developer key.

---

## Decision

`PHASE_6C_REQUIRES_REVIEW`

### Why not auto-advance to 6D

- Rank health is MATURE ≥90%, but PENDING is still material and enrichment is still draining.
- UNKNOWN aggregate inflation needs human review before declaring aggregate semantics fully clean.
- ≥100 coverage did not move.

### What already passed

- High/Mid representation created (D/E/P roots)
- +408 unique matches, ~424 matches/hour, ~4.9 Riot calls/new match
- ≥1 / ≥30 coverage improved
- No shared-cooldown thrash
- Hard caps unchanged
- Queues not runaway

**Do not begin** continuous crawler, Gold expansion, Silver/Bronze/Iron, cap increases, frontend, or matchup work until review sign-off.

---

## Artifacts

- `apps/api/.local/m12v2-phase6c/**`
- Key summaries: `baseline-wave-metrics.json`, `dry-run-summary.json`, `apply-enrollment-totals.json`, `final-summary.json`, `now-rank.json`, `now-wave-metrics.json`
