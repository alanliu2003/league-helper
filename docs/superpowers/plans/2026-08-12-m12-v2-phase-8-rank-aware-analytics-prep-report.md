# M12-v2 Phase 8 — Rank-Aware Analytics Preparation

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (read-only diagnostic only; `league_helper` untouched)  
**Real `.env` files:** not modified  
**Riot / crawler / scheduler:** not used / not enabled  
**Ranking floor:** **30** (unchanged)  
**Frontend / matchups / AI:** not in scope  

**Artifacts:**

- `apps/api/.local/m12v2-phase8/segment-depth-diagnostic.mjs`
- `apps/api/.local/m12v2-phase8/segment-depth.json`
- Shared contracts: `packages/shared/src/rank-scope.ts`, `rank-aware-merge.ts`, `rank-aware-eligibility.ts`

---

## Executive summary

Phase 8 prepared League Helper’s **rank-aware analytics read contracts** without product UI work and without live population.

Canonical exact tiers and APEX/HIGH/MID/LOW segments already lived in `@league-helper/shared` and were **not** duplicated. Phase 8 added a discriminated **`RankScope`** contract, segment→exact-tier read strategy helpers, weighted merge helpers, product quality metadata (floor=30), and cache-token collision rules.

**Architecture readiness:** ready for later rank-aware product reads.  
**Statistical readiness:** not mature for rank-filtered rankings. Exact-tier cells on patch **16.15** still have **0** cells at ≥30. Segment merges help APEX modestly (**15** cells ≥30) but do not unlock mature product rankings.

### Phase 8 decisions

| Decision | Value |
| -------- | ----- |
| Rank segment strategy | **DERIVE_SEGMENTS_FROM_EXACT_TIERS** |
| UNKNOWN exposure | **HIDE_UNKNOWN_FROM_PRODUCT_UNTIL_RECONCILED** |
| API readiness | **RANK_AWARE_READ_CONTRACT_READY** |
| M12 decision | **READY_FOR_M12_V2_COMPLETION_REVIEW** |

Do **not** auto-mark M12 complete without explicit `APPROVE M12-V2 COMPLETE`.

---

## Existing analytics architecture

```text
MatchParticipant (source truth: rankResolutionStatus + rankTierAtIngestion)
  → champion aggregation materializes ChampionAggregate rows:
       rankTier ∈ { ALL, exact Riot tier, UNKNOWN }
  → public API equality-filters ChampionAggregate.rankTier via query `tier`
  → Redis response cache fingerprints include `tier`
  → web filter state uses `tier` (UNKNOWN hidden in UI selector)
```

Key surfaces already present:

| Surface | Status |
| ------- | ------ |
| `GET /api/champion-stats` + `/:championKey/stats` | Exists; `tier` = ALL / exact / UNKNOWN |
| `ChampionAggregate.rankTier` | Materialized dimension |
| Redis cache keys (`packages/shared/src/champion-stats-cache.ts`) | Include `tier` |
| Segment vocabulary (`rank-segments.ts`) | Exists for collector/ops |
| Segment product filter | **Not wired to HTTP yet** (prepared in Phase 8) |

Important: `tier=ALL` reads the **materialized ALL row**, not a runtime sum of exact tiers. That preserves locked ALL semantics (includes unresolved / permanent-unavailable samples).

---

## Canonical exact-tier vocabulary

Source of truth: `packages/shared/src/ranks.ts` → `RankTierSchema`

| Exact tiers |
| ----------- |
| CHALLENGER |
| GRANDMASTER |
| MASTER |
| DIAMOND |
| EMERALD |
| PLATINUM |
| GOLD |
| SILVER |
| BRONZE |
| IRON |

Plus aggregate sentinels:

| Sentinel | Meaning |
| -------- | ------- |
| `ALL` | All otherwise-eligible source-backed participants independent of rank-resolution state |
| `UNKNOWN` | `RESOLVED_UNRANKED` only |

No competing 10-tier enum was found outside shared. Prisma stores strings validated at boundaries.

---

## Canonical segment vocabulary

Source of truth: `packages/shared/src/rank-segments.ts`

| Segment | Exact tiers |
| ------- | ----------- |
| **APEX** | CHALLENGER, GRANDMASTER, MASTER |
| **HIGH** | DIAMOND, EMERALD, PLATINUM |
| **MID** | GOLD |
| **LOW** | SILVER, BRONZE, IRON |

Collector allowlists import these arrays; Phase 8 does **not** introduce a second segment model.

Segments are **product/read constructs**. They are not participant statuses and must never include UNKNOWN / ALL / unresolved states.

---

## Rank-scope contract

New shared discriminated union: `RankScope` (`packages/shared/src/rank-scope.ts`)

```ts
{ kind: 'ALL' }
{ kind: 'UNKNOWN' }
{ kind: 'EXACT', tier: RankTier }
{ kind: 'SEGMENT', segment: RankSegmentId }
```

Helpers:

- `legacyTierFilterToRankScope(tier)` — maps existing public `tier` without semantic drift
- `exactTiersForRankScope(scope)` — segment/exact → tier list; ALL/UNKNOWN → `[]`
- `resolveRankScopeReadStrategy(scope)` — materialized sentinel vs exact vs segment-merge
- `serializeRankScopeCacheToken(scope)` — deterministic cache identity
- `assertProductRankScope` / `resolutionStatusAllowsExactOrSegmentProductScope` — reject PENDING / FAILED_* / unranked as exact/segment product scopes

Backward compatibility: keep query param `tier: ChampionStatsTierFilter` for current endpoints. Future segment support should add an explicit rank-scope field (or carefully versioned query) rather than overloading ambiguous strings like `HIGH` into `tier` without a kind discriminator.

Collision invariants enforced in tests:

- ALL ≠ UNKNOWN
- ALL ≠ HIGH
- HIGH ≠ DIAMOND
- EXACT GOLD ≠ SEGMENT MID (even though MID expands to GOLD only)

---

## ALL / UNKNOWN semantics

Locked (unchanged):

| Scope | Source rule |
| ----- | ----------- |
| ALL | All otherwise-eligible source-backed participants; rank resolution never gates inclusion |
| Exact tier | `RESOLVED_RANKED` only |
| UNKNOWN | `RESOLVED_UNRANKED` only |
| PENDING / FAILED_RETRYABLE / FAILED_PERMANENT | ALL-only; never silently UNKNOWN |

Rank means: **rank observed during the ingestion/enrichment cycle** — not match-start MMR, not root TrackedPlayer rank, not inferred opponent rank.

### UNKNOWN product exposure recommendation

**HIDE_UNKNOWN_FROM_PRODUCT_UNTIL_RECONCILED**

Rationale:

1. Semantic meaning is correct (`RESOLVED_UNRANKED` only).
2. Historical UNKNOWN **aggregate mass is inflated** vs source finalized unranked (see debt section).
3. Web already omits UNKNOWN from the primary selector; API still accepts it for diagnostics/URL parity.
4. Exposing UNKNOWN as a trustworthy champion filter would mislead users until reconciliation.

Not chosen: `READY_FOR_PRODUCT_UNKNOWN` (data untrustworthy).  
Diagnostic API acceptance may remain, but product UX must not promote UNKNOWN as a normal filter until reconciled.

---

## Segment derivation strategy

**Chosen: DERIVE_SEGMENTS_FROM_EXACT_TIERS**

| Option | Verdict |
| ------ | ------- |
| Persist segment aggregate rows | Rejected — duplicates storage, doubles convergence surface, risks ALL/exact/segment drift |
| Derive/read-merge exact tiers | **Accepted** — least duplicative; matches current exact materialization |
| Requires review | Not needed; query cost is trivial at current scale |

Tradeoffs accepted:

- Segment reads cost 1 query with `rankTier IN (...)` (1–3 tiers) + O(tiers) in-memory additive merge.
- Cache keys use segment identity (`SEGMENT:HIGH`), invalidated when generation bumps after exact-tier recalculation.
- MID currently equals GOLD numerically but remains a distinct product scope token.

Do **not** create new persisted aggregate dimensions for segments in M12.

---

## Aggregate merge semantics

Pure helpers: `packages/shared/src/rank-aware-merge.ts`

### Safe to sum (additive persisted fields)

- `sampleSize`, `wins`
- `totalKills`, `totalDeaths`, `totalAssists`
- `totalCs`, `totalGameSeconds`
- `totalDamageToChampions`, `totalVisionScore`
- Optional timeline totals + their sample counters (`totalGoldDifferenceAt10` / `goldDifferenceAt10Samples`, same for 15 / CS deltas) via null-aware combine

### Must recompute from numerators/denominators (never average rates)

| Derived metric | Formula basis |
| -------------- | ------------- |
| winRate | `wins / sampleSize` |
| aggregateKdaRatio | from summed K/D/A (+ existing zero-death rules) |
| averageCs/Damage/Vision per minute | totals / (`totalGameSeconds` / 60) |
| averageGold/Cs diffs | optional total / corresponding samples |
| Wilson interval / sampleConfidence | recompute from merged wins/sampleSize |

### Not safely mergeable from response DTOs alone

Precomputed percentages / intervals on API responses must **not** be averaged across tiers. Merge **persisted additive totals**, then derive.

`latestEligibleMatchAt` / `calculatedAt`: take max / freshness rules at read-service layer (not averaged).

---

## Cache-key design

Current keys already include:

- generation scope: sourceNormalizationVersion, aggregationVersion, platform, patch, queueId
- table/champion fingerprints: position, **tier**, sort, pagination, minimumSample, includeInsufficient

Phase 8 rule for future segment-aware reads:

| Scope | Cache token |
| ----- | ----------- |
| ALL | `ALL` |
| UNKNOWN | `UNKNOWN` |
| Exact GOLD | `EXACT:GOLD` (or legacy `GOLD` while only exact/ALL/UNKNOWN are live) |
| Segment HIGH | `SEGMENT:HIGH` |

**Chosen token style:** kind identity (`SEGMENT:HIGH`), not expanded sorted exact-tier lists.

Why not expanded tiers?

- Prevents EXACT:GOLD colliding with a hypothetical custom `{GOLD}` merge when product kind differs from SEGMENT:MID.
- Segment vocabulary is closed and stable.

Invalidation: existing generation bump on champion aggregation already covers exact-tier changes; derived segment cache entries sharing that generation invalidate together. No separate segment generation store required.

---

## Sample / eligibility metadata

New shared product meta: `RankAwareProductQualityMeta`

| Field | Meaning |
| ----- | ------- |
| `sampleSize` | Merged or row sample size |
| `rankingEligible` | `sampleSize >= rankingFloor` |
| `rankingFloor` | **30** (literal) |
| `rankScope` | Discriminated RankScope |
| `lowSample` | `!rankingEligible` |
| `patch` | Optional patch label |

Ranking floor remains **30**. Do not lower it because exact/segment depth is thin.

---

## Operational-health vs product-quality boundary

| Product statistic quality (may accompany stats responses) | Pipeline operational health (ops endpoints / enrichment health CLI) |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| sampleSize | PENDING / FAILED_RETRYABLE counts |
| lowSample / rankingEligible / rankingFloor | exactRankCoverage / rankResolutionCoverage |
| rankScope | FAILED_PERMANENT diagnostics |
| patch / freshness already on envelope | RANK_COVERAGE_UNHEALTHY warnings |

Do **not** attach global coverage histograms to every champion-stats response. Keep ops health on enrichment/status surfaces already established in Phases 3–4.

---

## Public API readiness

| Surface | Classification | Notes |
| ------- | -------------- | ----- |
| Champion stats endpoints + `tier` | **EXISTS_AND_READY** | ALL / exact / UNKNOWN |
| Response DTOs / envelope | **EXISTS_AND_READY** | `dimensions.rankTier`, semantics string |
| Segment HTTP filter | **MISSING** (prepared) | Shared RankScope ready; endpoint wiring is post-M12 |
| Segment merge in repository/service | **MISSING** (prepared) | Helpers ready; not wired |
| Cache key tier slot | **MINOR_EXTENSION** | Documented token convention; generation invalidation OK |
| Web rank selector for segments | **MISSING** | Explicitly deferred |
| UNKNOWN trustworthy product filter | **NEEDS_REDESIGN** of data first | Hide until UNKNOWN reconciliation |

Overall Phase 8 contract decision: **RANK_AWARE_READ_CONTRACT_READY**

---

## Shared schema/type changes

Added (no DB migration):

| File | Purpose |
| ---- | ------- |
| `packages/shared/src/rank-scope.ts` | RankScope union, read strategy, cache tokens, legacy mapping |
| `packages/shared/src/rank-aware-merge.ts` | Additive merge + weighted winRate |
| `packages/shared/src/rank-aware-eligibility.ts` | Product quality meta + floor 30 |
| Tests for the above + cache collision case | Contract matrix |
| Re-exports in `packages/shared/src/index.ts` | Public shared surface |

Unchanged on purpose:

- Prisma schema / migrations
- Live champion-stats controllers/services
- Frontend
- Ranking floor
- Collector population path

---

## Segment sample-depth diagnostic

Read-only against `league_helper_m12v2`, patch **16.15**, queue **420**, platform **na1**, positions TOP/JUNGLE/MIDDLE/BOTTOM/SUPPORT.

Segment depths are **derived** by summing exact-tier `ChampionAggregate.sampleSize` per champion×position. No segment rows persisted.

### ALL reference (materialized)

| ≥1 | ≥10 | ≥20 | ≥30 | ≥50 | ≥100 | max |
| -- | --- | --- | --- | --- | ---- | --- |
| 484 | 208 | 130 | **78** | 24 | **0** | 93 |

### Exact-tier (materialized)

All exact tiers: **0** cells at ≥30 (matches Phase 7). Breadth exists; ranking-floor depth does not.

### Derived segments

| Segment | ≥1 | ≥10 | ≥20 | ≥30 | ≥50 | ≥100 | max |
| ------- | -- | --- | --- | --- | --- | ---- | --- |
| APEX | 392 | 112 | 40 | **15** | 1 | 0 | 51 |
| HIGH | 338 | 61 | 9 | **1** | 0 | 0 | 32 |
| MID | 212 | 4 | 0 | **0** | 0 | 0 | 12 |
| LOW | 288 | 30 | 7 | **0** | 0 | 0 | 28 |

### Honest readiness reading

- **Architecture:** segment derivation is useful and cheap.
- **Statistics:** even merged segments are **not** mature product ranking views under floor 30 (APEX has only 15 eligible cells; HIGH/MID/LOW essentially none).
- Do **not** lower the floor to invent maturity.
- Segment filters may become useful **earlier than exact-tier filters** for exploratory depth, but not as mature ranked leaderboards yet.

---

## Query/cache cost

At current scale (patch 16.15 exact rows ≈ **2237** for five positions):

- One segment read ≈ **1** Prisma `findMany` with `rankTier IN (1..3 values)` filtered by platform/queue/patch/position(+champion)
- Merge cost: O(rows) additive field sums in memory — negligible
- Cache: store normalized segment response under `SEGMENT:*` token; invalidate via existing generation bump

**Denormalize segment aggregates? No.** Runtime merge is operationally trivial.

---

## UNKNOWN correctness dependency

Live read-only measurement (420 / na1):

| Signal | Value |
| ------ | ----- |
| Source `RESOLVED_UNRANKED` (COMPLETED, remake=false) | **59** |
| UNKNOWN aggregate `sampleSizeSum` all-patch | **3218** |
| UNKNOWN aggregate rows all-patch | **2494** |
| UNKNOWN `sampleSizeSum` current patch 16.15 | **997** |

Phase 7 previously cited ~1781 all-patch UNKNOWN mass; live Phase 8 measurement is **higher**. Either way, source finalized unranked (**59**) ≪ UNKNOWN aggregate mass.

**Boundary (unchanged):**

- Do not repair via ad hoc SQL in Phase 8
- Do not reinterpret unresolved as UNKNOWN
- Do not delete participant rows for convenience
- UNKNOWN filter must not be treated as trustworthy product data
- ALL + exact-tier semantics remain usable
- Separate source-derived UNKNOWN reconciliation task is required **after** M12 (or as an explicit follow-up before product UNKNOWN)

---

## Future product read path

```text
HTTP request
  → validate RankScope (or map legacy tier → RankScope)
  → resolveRankScopeReadStrategy
      ALL/UNKNOWN → read materialized sentinel rows
      EXACT → read that rankTier row
      SEGMENT → fetch exact-tier rows for segment tiers
  → mergeChampionAggregateTotals (segment only)
  → derive rates / Wilson / confidence from additive totals
  → attach RankAwareProductQualityMeta (floor 30)
  → cache with serializeRankScopeCacheToken
  → return shared DTO
```

No frontend implementation in Phase 8.

---

## Deferred work

Post-M12 / later milestones (not Phase 8):

1. Wire `RankScope` / segment filter into champion-stats HTTP + repository merge path
2. Champion-page rank segment selector UI (exact + segment)
3. Cache fingerprint migration to always use rank-scope tokens for new scopes
4. Matchup rank filters / MatchupAggregate writer
5. Build analytics rank filters
6. Strong/Weak UI
7. AI summaries conditioned on rank scope
8. UNKNOWN aggregate reconciliation against `RESOLVED_UNRANKED` sources
9. Continuous crawler / scheduler enablement (ops track; still disabled)
10. Hard-cap raises (still insufficient evidence per Phase 7)

---

## M12 completion readiness

Phase 8 success criteria:

| # | Criterion | Status |
| - | --------- | ------ |
| 1 | Canonical non-duplicative tier/segment vocabulary | **PASS** |
| 2 | Explicit rank-scope semantics | **PASS** |
| 3 | ALL / UNKNOWN meanings preserved | **PASS** |
| 4 | Segment merge strategy defined | **PASS** (`DERIVE_SEGMENTS_FROM_EXACT_TIERS`) |
| 5 | Cache-key implications defined | **PASS** |
| 6 | Weighted aggregate semantics correct + tested | **PASS** |
| 7 | Sample-floor metadata contract defined (30) | **PASS** |
| 8 | Exact/segment statistical readiness measured honestly | **PASS** |
| 9 | UNKNOWN inflation not hidden | **PASS** |
| 10 | No frontend/matchup scope creep | **PASS** |
| 11 | No live Riot acquisition | **PASS** |

**M12 decision:** `READY_FOR_M12_V2_COMPLETION_REVIEW`

Stopped for review. Awaiting explicit milestone-close approval before any completion commit/docs claiming M12 finished.

---

## Verification commands run

```text
pnpm --filter @league-helper/shared test
pnpm --filter @league-helper/shared typecheck
pnpm --filter @league-helper/shared lint
pnpm --filter @league-helper/shared build
node --env-file=.env .local/m12v2-phase8/segment-depth-diagnostic.mjs   # from apps/api
```

Shared package: **201** tests passed.
