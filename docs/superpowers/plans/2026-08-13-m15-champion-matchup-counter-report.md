# M15 Champion Matchups / Counter Analysis

**Date:** 2026-08-13  
**Branch:** `milestone-15-champion-matchups-counter-analysis` (from clean `master` @ M14 merge; not the old M14 branch)  
**Working DB:** `league_helper_m12v2` (`league_helper` archive untouched)  
**Status:** implementation complete — stopped for review (not committed)

No Riot population, crawler, or live refetch. No M16 work.

---

## Current source-data audit

Re-audit of `MatchParticipant` source truth (Phase 0, read-only) for **na1 / queue 420 / patch 16.15 / COMPLETED / non-remake**.

| Metric | M12 readiness audit | M15 re-audit (this branch) |
|---|---|---|
| Eligible matches | 435 | **669** |
| 10-player matches | 435 | **669** |
| Matches with all 5 valid lane pairs | 435 | **669** |
| Pairing skips (UNKNOWN / duplicate / missing / malformed / mirror) | 0 (higher-tier slice) | **0** |
| Undirected lane slots | — | **3345** |
| Directional observations | — | **6690** |
| Unique directional champion-vs-champion-position pairs | — | **4722** |
| `MatchupAggregate` rows before M15 | 0 | **0** (writer did not exist) |

Sample floors on unique directional ALL pairs (source-derived, before product display):

| Floor | Unique directional pairs |
|---|---|
| ≥1 | 4722 |
| ≥5 | 68 |
| ≥10 | **2** |
| ≥15 | 0 |
| ≥20 | 0 |
| ≥30 | 0 |
| ≥50 | 0 |
| ≥100 | 0 |
| **max sampleSize** | **10** |

Top volume pair: **Jhin ↔ Tristana BOTTOM, 10 games, 5–5 (50%)**. Ahri MIDDLE vs Syndra is **n=8** (below display floor). Gold/CS diffs at 10 are present on ~92% of directional observations; they are aggregated when present and never invented.

M13/M14-era collection increased match count (435 → 669) and max pair depth (9 → 10). Pairing quality stayed perfect on this current-patch ranked-solo slice. Pair **depth is still far below a ranking-style floor of 30**.

---

## Matchup semantics

One directional observation:

> Subject champion **C** in normalized position **P** played against opposing champion **O**, also in **P**, in one eligible match.

Example: Ahri MIDDLE vs Syndra MIDDLE. If Ahri wins:

- Ahri → Syndra: win = 1
- Syndra → Ahri: win = 0

Both directions are emitted **exactly once**. There is no undirected double-count and no second write of the same directional pair. Same-champion mirrors are skipped (`MatchupAggregate` CHECK `championId <> opponentChampionId`).

There are **no ALL-position matchup rows**. Lane is identity.

---

## Pairing rules

Shared pure helper: `findUniqueSamePositionOpponent` / `pairLaneOpponents` in `@league-helper/match-analytics`. Timeline metrics `findRoleOpponent` now wraps the same helper (raw `teamPosition` including `UTILITY`).

Reliable lanes:

- TOP ↔ TOP
- JUNGLE ↔ JUNGLE
- MIDDLE ↔ MIDDLE
- BOTTOM ↔ BOTTOM
- SUPPORT ↔ SUPPORT (raw `UTILITY` normalized first)

Require **exactly one** participant per team in that normalized position. Skip rather than guess:

| Case | Handling |
|---|---|
| UNKNOWN position | skip slot |
| Duplicate same-position occupants | skip slot |
| Missing opponent | skip slot |
| Malformed team composition | skip; no invented pairs |
| Same-champion mirror | skip |
| Remake / non-COMPLETED | match excluded by champion-aggregate eligibility |

Current-patch 16.15 / 420 / na1: **0 skips**, 669/669 matches with all five pairs.

---

## Rank semantics

Reuse M12 **subject participant** rank (`classifyParticipantRankForAggregates`). Never TrackedPlayer/root rank, acquisition segment, or opponent rank.

Ahri GOLD vs Syndra PLATINUM:

- Ahri → Syndra → `ALL` + `EXACT:GOLD`
- Syndra → Ahri → `ALL` + `EXACT:PLATINUM`

Unresolved subjects contribute to **ALL only** (not exact, not UNKNOWN). `RESOLVED_UNRANKED` contributes to ALL + UNKNOWN. UNKNOWN remains hidden from product UX (`UNKNOWN_RANK_HIDDEN`).

Persisted rank rows: `ALL`, exact tiers, `UNKNOWN`. **No** materialized APEX/HIGH/MID/LOW matchup rows. Segments are a **read-time merge** (`DERIVE_SEGMENTS_FROM_EXACT_TIERS`). ALL reads use materialized ALL rows because unresolved participants are included there.

---

## Aggregate architecture

Existing `MatchupAggregate` Prisma model was sufficient after adding:

- `aggregationVersion` (default `"1"`)
- `latestEligibleMatchAt`
- unique key `MatchupAggregate_dims_key` including `sourceNormalizationVersion` + `aggregationVersion`

Dimensions: patch, platform, regionalRoute, queueId, rankTier, position, championId, opponentChampionId, versions.

Additive metrics: `sampleSize`, `wins`, optional gold/CS difference totals + sample counters. Derived at read: losses, winRate, Wilson interval, matchup confidence band.

Lane-diff metrics: aggregated **only when source values exist**. Nulls are not invented. After backfill, 4438/4722 ALL rows have GD@10 and CSD@10 samples.

Writer is **source-derived recompute** (scratch map → `deleteMany` + `createMany`), not unbounded `+=`.

---

## Rebuild/backfill

CLI: `pnpm aggregates:rebuild-champion-matchups`

Filters: `--patch` `--platform` `--queue` plus optional `--champion` (subject) `--position`. Supports `--dry-run`, `--confirm` / `AGGREGATES_REBUILD_MATCHUPS_CONFIRM=YES`, `--batch-size`, `--offset`, version flags. No Riot calls. Does not delete `MatchParticipant` rows. Deletes stale aggregate keys in the requested scope, then inserts recomputed rows.

**Current-patch backfill (16.15 / na1 / 420):**

| | Before | After |
|---|---|---|
| `MatchupAggregate` rows | 0 | **10907** |
| Directional source observations | 6690 | 6690 |
| ALL-row `sum(sampleSize)` | — | **6690** (reconciles) |
| ALL-row `sum(wins)` | — | **3345** (half; one win per undirected slot) |
| Unique ALL directional pairs | — | **4722** |
| Cache generation INCR | — | 1 |

Dry-run reported the same pairing/depth with 0 writes. Apply: `upsertsApplied=10907`, `deletionsApplied=0`, skips all 0.

ALL rows by position: TOP 1040 / JUNGLE 990 / MIDDLE 984 / BOTTOM 844 / SUPPORT 864; each position `sum(sampleSize)=1338` (669 matches × 2 directions).

---

## Incremental aggregation

**Option C (smallest clean architecture):** after a successful champion-aggregation job (`outcome === completed`), call `recalculateMatchupsForMatch` in the same lifecycle.

- No new queue.
- Affected pair identities from the ingested match (plus any existing rank rows for those identities).
- Full source scan of that patch/platform/queue, then delete+insert **only those identities**.
- Idempotent and retry-safe. Uses `CHAMPION_MATCHUP_AGGREGATION_VERSION` (independent of champion ranking aggregation version).

---

## Confidence/display policy

Aggregation **persists all n≥1**. Product display is separate. Low-sample rows are not deleted.

**Display floor = 10.** Not ranking floor 30 (too sparse). Not lowered after seeing only 2 pairs at n=10.

| n | Band | Product |
|---|---|---|
| &lt;10 | INSUFFICIENT | hidden |
| 10–19 | LOW / limited sample | shown if Strong/Weak; muted, no strength colors |
| 20–29 | MEDIUM | shown |
| 30+ | HIGH | shown |

Ranking: eligible rows (`sampleSize >= 10`) then **Wilson lower bound**, not raw winRate. 1–0 cannot outrank a large eligible sample. Neutral **50% is neither** Strong nor Weak. If both lists are empty, the API returns `NO_ELIGIBLE_MATCHUPS` (even 50% pairs are not presented as counters).

Strong Against: subject winRate **&gt; 0.5**. Weak Against: subject winRate **&lt; 0.5**. Labels are not inverted.

---

## API

`GET /api/champions/:championKey/matchups`

Query: `platform`, `queueId`, `tier`, `position` (required), `patch`, optional `rankScope` (`ALL` / `EXACT:GOLD` / `SEGMENT:HIGH`). Invalid position or rankScope → validation failure. UNKNOWN → `UNKNOWN_RANK_HIDDEN`.

Response: `strongAgainst` / `weakAgainst` rows with opponent key/name/icon URL, position, sampleSize, wins, losses, winRate, Wilson, sampleConfidence, lowSample, optional lane diffs. Metadata: champion filters, displayFloor, rankingPolicy `WILSON_LOWER_BOUND`, totalEligiblePairs, totalSourcePairs. No PUUID or player identity.

SEGMENT:HIGH merges DIAMOND+EMERALD+PLATINUM by opponent (sum sampleSize/wins; never average rates).

---

## Cache

Keys: `champ_matchups:gen:` / `champ_matchups:champion:` with generation scope (including **matchup** aggregation version), championKey, position, `rankScopeToken`, displayFloor.

Tokens prevent ALL vs EXACT, EXACT:GOLD vs SEGMENT:MID, HIGH vs DIAMOND collisions (`serializeRankScopeCacheToken` / `parseRankScopeCacheToken`).

---

## Frontend

Existing champion page tabs: Overview | Builds & Runes | **Matchups**. No hero/abilities/builds redesign.

Matchups panel:

- Weak Against then Strong Against
- Portrait, name, position, win rate, games, Limited sample / confidence
- Opponent `NuxtLink` to `/champions/:opponentChampionKey` preserving platform/queue/tier/position/patch
- Numeric IDs not shown
- Empty: “Not enough matchup data yet for reliable counter analysis in this filter.”
- Position required (same pattern as Builds)
- Dark cards, champion portraits, restrained accents; card rows (not a wide table)

---

## Current matchup depth

After rebuild, ALL unique directional pairs:

| ≥1 | ≥5 | ≥10 | ≥15 | ≥20 | ≥30 | ≥50 |
|---|---|---|---|---|---|---|
| 4722 | 68 | 2 | 0 | 0 | 0 | 0 |

| Product question | Result |
|---|---|
| Eligible product Strong/Weak rows at floor 10 | **0** (the only n=10 pair is Jhin↔Tristana BOTTOM 5–5) |
| Champions with ≥1 visible Strong/Weak | **0** |
| Champions with empty Matchups state | essentially all (173 have ≥1 stored pair; none have a directional counter that is both ≥10 and ≠50%) |
| Deepest pair | Jhin ↔ Tristana BOTTOM n=10 |
| ≥10 by position | BOTTOM 2; other roles 0 |

**M15 produces a functional Matchups tab with honest empty states today.** It does not produce a populated counter page. Floor 10 was not lowered.

---

## Data quality

Current-patch 16.15 / 420 / na1:

| Check | Result |
|---|---|
| Pairing skips | **0** all reasons |
| UNKNOWN positions | 0 in this slice |
| Duplicate positions | 0 |
| Missing opponent | 0 |
| Same-champion mirrors | 0 |
| Remakes | excluded from eligibility |
| Lower-tier data | previously introduced small skips in older audits; **this current-patch corpus is clean** |
| ALL sample reconciliation | 6690 = 6690 directional observations |

Do not treat this as “all League matches.” Collected-sample disclaimer remains on the response.

---

## Tests

Pairing, directional win/loss, no double-count, remake exclusion, subject-rank only, ALL vs exact vs unresolved, segment merge (sum not average), idempotent rebuild, stale-row deletion, no source deletion, incremental identity recompute, API Strong/Weak, floor hide, 50% not a counter, UNKNOWN hide, invalid position/rankScope schemas, frontend Weak/Strong/icons/links/empty, e2e Ahri eligible lists + Annie empty + opponent click → Syndra, 390/1024/1440 overflow.

Commands:

```
pnpm --filter @league-helper/shared test
pnpm --filter @league-helper/match-analytics test
pnpm --filter @league-helper/api test
pnpm --filter @league-helper/worker test
pnpm --filter @league-helper/web test
pnpm --filter @league-helper/web exec playwright test e2e/champions.e2e.ts
```

Rebuild / verify:

```
pnpm db:migrate:deploy
pnpm aggregates:rebuild-champion-matchups -- --dry-run --patch 16.15 --platform na1 --queue 420
pnpm aggregates:rebuild-champion-matchups -- --confirm --patch 16.15 --platform na1 --queue 420
```

---

## Visual validation

Playwright (mocked, local-only):

- Ahri Matchups: Syndra Weak Against (40%), Tristana Strong Against (70%), icons, Limited sample, click Syndra → `/champions/Syndra?…position=MIDDLE`
- Annie: honest empty copy
- 390 / 1024 / 1440: opponent name, win rate, games readable; no horizontal overflow
- Overview / Builds & Runes / abilities still present

Live local DB (no Riot): Ahri, Aatrox, Jinx, Thresh, and every other champion currently show the empty-state copy at floor 10. That is correct, not a UI bug. Screenshots were not committed.

---

## Known limitations

1. **Pair depth is still too thin for product counters.** Max n=10; only one undirected pair reaches the display floor, and it is even.
2. Display floor 10 is an honesty choice, not a populated-page choice.
3. Lane-diff averages are optional and missing when timeline diffs were never stored.
4. Frontend rank filter is still legacy `tier` (ALL / exact). `rankScope` SEGMENT tokens work on the API; no new segment picker was added.
5. Incremental matchup recompute scans the patch/platform/queue for affected identities (bounded by current corpus size; 669 matches today).
6. Mainland CN / Tencent / live-game advice remain out of scope.

---

## Deferred work

- Population depth for matchup pairs (not champion-targeted crawling; not this milestone)
- Showing even 50% pairs in a neutral “even matchups” list
- Optional lane-diff columns in the UI (API already exposes them when present)
- Dedicated matchup queue (not needed at current volume)
- Production deploy
- M16

---

## Files (created or modified)

Created: match-analytics `src/matchups/*`; shared `champion-matchups.ts`; Prisma migration `20260813180000_m15_matchup_aggregate_versioning`; worker `rebuild-champion-matchups` CLI + `champion-matchup-aggregation/rebuild-core.ts`; API matchup service/mapper/read repository; web `ChampionMatchupsPanel.vue`; this report.

Modified: Prisma `MatchupAggregate`; champion aggregation processor (incremental hook); timeline-metrics pairing; champion APIs/cache/config; champion detail tabs/page; e2e mocks and tests; env examples.
