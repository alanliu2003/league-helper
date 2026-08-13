# M14 Champion Build / Rune Analytics

**Date:** 2026-08-13  
**Branch:** `milestone-14-champion-builds-runes-skill-order` (from clean `master` @ `c71f392`, M13 merged)  
**Status:** implementation complete — stopped for review (not committed)

---

## Source-data audit

Corpus on working DB `league_helper_m12v2` (no Riot refetch):

| Scope | Count |
|---|---|
| Completed matches | 1454 |
| Queue 420 | 1419 |
| na1 | 1434 |
| Semantic current patch | **16.15** (do not sort patches lexicographically) |
| Rebuild scan (16.15 / na1 / 420 / completed / non-remake / norm v1) | **669 matches / 6690 participants** |

**Per-participant source today (`MatchParticipant`):**

| Field | Final state | Timeline needed |
|---|---|---|
| `itemIds[]` (item0–item6) | yes | no |
| `perkIds[]` / `statPerkIds[]` | yes | no |
| `primaryPerkStyleId` / `secondaryPerkStyleId` | yes (nullable on older rows) | no |
| `summonerSpell1Id` / `summonerSpell2Id` | yes | no |
| `skillOrder[]` | yes when preserved | `SKILL_LEVEL_UP` fallback |
| Purchase order / starting items / core completion order | no | `ITEM_PURCHASED` / `SOLD` / `UNDO` / `DESTROYED` |

`firstCompletedItem*` remains unused/null. Missing timeline is **not** an empty build.

16.15 q420 na1 non-remake participants (audit): 6690. Timeline item events on ~44%. Rebuild eligibility on the same scope:

| Category | Eligible participants |
|---|---|
| STARTING_ITEMS | 2933 |
| CORE_BUILD | 2886 (pre-correction; included 1-item/2-item games — see core-build semantic correction) |
| BOOTS | 5118 |
| RUNES | 6690 |
| SUMMONER_SPELLS | 6690 |
| SKILL_SEQUENCE | 6150 |
| SKILL_PRIORITY | see skill-priority rebuild below |

Summoner spell IDs were already persisted. Item/rune/spell **icons were not** synced before M14 (`ItemStaticData`/`RuneStaticData` empty of build metadata; no summoner-spell table). M14 added Data Dragon item `from`/`into`/`consumed`, `SummonerSpellStaticData`, and a bounded static sync (868 items / 62 runes / 34 spells on 16.15.1). No existing aggregate table for builds existed; champion ranking still uses `ChampionAggregate`.

Read-time reconstruction across `MatchTimelineEvent` for product pages would be expensive. **Materialized normalized aggregates** were chosen (see architecture).

---

## Eligibility model

Pure helpers in `@league-helper/match-analytics` (`assessBuildSourceEligibility`):

- `ITEM_FINAL_STATE_ELIGIBLE` — any `itemIds` > 0 (zeros are empty slots, not inventory)
- `ITEM_TIMELINE_ELIGIBLE` — at least one `ITEM_PURCHASED` with itemId > 0
- `RUNE_ELIGIBLE` — ≥4 positive perk IDs (styles optional)
- `SPELL_ELIGIBLE` — both summoner spell IDs > 0
- `SKILL_SEQUENCE_ELIGIBLE` — stored `skillOrder` slots 1–4 **or** `SKILL_LEVEL_UP` events
- `SKILL_PRIORITY_ELIGIBLE` — Q/W/E investment produces a strict total order of all three basics (rank-1 timing does not break ties)

Overall completeness: `BUILD_SOURCE_COMPLETE` vs `BUILD_SOURCE_PARTIAL`. A participant can be rune/spell eligible and timeline-ineligible. Missing timeline is never treated as an empty starting/core build.

---

## Chosen aggregate architecture

**B. Materialized normalized rows** (`ChampionBuildAggregate`), not a JSON blob and not per-request timeline reconstruction.

One row per:

`patch × platform × regionalRoute × queue × rankTier × position × champion × category × signature × versions`

Additive fields: `sampleSize`, `wins`, `eligibleGames`. Derived pick/win rates computed at read time. Never average percentages.

Categories: `STARTING_ITEMS`, `CORE_BUILD`, `BOOTS`, `RUNES`, `SUMMONER_SPELLS`, `SKILL_SEQUENCE`, `SKILL_PRIORITY`.

Rank dimensions reuse M12: materialized `ALL` sentinel + exact tiers. Segment product reads **merge exact-tier rows** (`mergeBuildRowsBySignature` sums sample/wins; eligibleGames is the **sum of per-tier pools**, not per-signature double-count). Public `tier` query remains M12 `ALL | exact | UNKNOWN`. `UNKNOWN` is persisted but hidden from the product UI (`UNKNOWN_RANK_HIDDEN`). Ranking floor **30 is unchanged**.

Cache prefix `champ_builds:` is distinct from `champ_stats:`. Rank tokens `ALL` / `EXACT:GOLD` / `SEGMENT:HIGH` do not collide. Rebuild `INCR`s `champ_builds:gen:…`.

---

## Item reconstruction semantics

Timeline reconstruction (`reconstructItemInventory`) applies `ITEM_PURCHASED`, `ITEM_SOLD`, `ITEM_UNDO`, `ITEM_DESTROYED` in timestamp + `eventIndex` order. Undo reverses purchase/sell; destroyed/consumed items leave inventory. Tests cover purchase, sell, undo purchase, undo sell, destroy, duplicates.

**Starting items:** net purchases before **90_000 ms** (minions spawn ~65s + buffer). `DESTROYED` ignored so potions still count. Exclude trinkets and boots. Deterministic gold-desc / id sort. Documented cutoff — not a lane-departure heuristic.

**Core build:** first **three COMPLETED_MAJOR** items in reconstructed completion order. Completed = nonempty `from` + `goldTotal >= 2000` (Ornn `into` still completed). Boots, components, consumables, trinkets, and Lane/Jungle starters without a recipe are excluded. Participants with fewer than 3 completions are `CORE_BUILD_INELIGIBLE` — no 1-item or 2-item product signatures.

**Boots:** highest-gold Boots-tagged item from **final** `itemIds`. Not mixed into core slots.

**Final items:** `itemIds` with zeros removed; not presented as purchase order. Product UI emphasizes starting / core / boots rather than six final slots.

Empty item catalog → skip starting/core/boots (do not guess classification).

---

## Rune support

Persisted: `perkIds[]` (typically 6), `statPerkIds[]` (typically 3), optional primary/secondary style IDs.

Product view: keystone = first of four primary perk IDs; remaining primary + secondary; stat shards when present. Style tree names only when both style IDs exist. **Do not fabricate a rune page from style IDs alone.** Historical rows with perk IDs but null styles show “Perk selections (style trees not preserved)”.

---

## Summoner spell support

`summonerSpell1Id` / `summonerSpell2Id` already on participants. Unordered pairs canonicalized `min-max` so Flash+Teleport = Teleport+Flash. Static names/icons from `SummonerSpellStaticData` (Data Dragon `summoner.json`). No live API.

---

## Skill-order support

`SKILL_LEVEL_UP` / stored `skillOrder`: slot 1=Q, 2=W, 3=E, 4=R. Passive is never inferred. Malformed/missing events skipped. Reconstruction prefers the longer of timeline vs stored slots.

Two distinct products (not interchangeable):

- **Ability max priority** (`SKILL_PRIORITY`, headline): investment order of Q/W/E. Comparator: final rank, then earliest time reaching ranks 5→2. Rank-1 unlock timing does not dominate. Eligible only as one of six canonical permutations (`Q>W>E`, …). R ignored. Ambiguous short games are ineligible rather than partial `Q` / `Q>W` rows.
- **Leveling sequence** (`SKILL_SEQUENCE`, optional secondary): literal `E W Q W W R …`

UI copy: “Most common basic ability leveling priority.” Optional “Common leveling sequence …”.

See **Skill-order semantic correction** and **Skill-priority inference correction** below.

---

## Schema/migrations

`apps/api/prisma/migrations/20260813120000_m14_champion_build_aggregates/`:

- `ItemStaticData.fromItemIds` / `intoItemIds` / `consumed`
- `SummonerSpellStaticData`
- `ChampionBuildAggregate`

Applied to public + `league_helper_test` + `league_helper_worker_test`.

---

## Backfill

CLI only, persisted source, **no Riot calls**:

```
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --dry-run
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --confirm
```

Supports `--batch-size`, `--offset`, `--categories`, `--champion`. Mutating apply requires `--confirm` or `AGGREGATES_REBUILD_BUILDS_CONFIRM=YES`. Delete-many then createMany for the scoped patch/platform/queue/version (idempotent). `--categories SKILL_PRIORITY,SKILL_SEQUENCE` rebuilds skill rows only (also deletes leftover `SKILL_MAX_ORDER` rows). `--categories CORE_BUILD` rebuilds three-item cores only and leaves starting items, boots, runes, spells, and skill rows in place.

Confirmed run: 669 matches, 6690 participants, catalog 868, **62605** aggregate rows, cache generation incremented.

Static sync (Data Dragon CDN, not Riot):

```
pnpm champions:sync-build-static -- --version 16.15.1
```

Does not steal `Patch.isActive`.

---

## API

`GET /api/champions/:championKey/builds` (registered **before** `:championKey`).

Query: same champion-stats filters plus **required** `position`. `tier` UNKNOWN → empty `UNKNOWN_RANK_HIDDEN`.

Response sections: `startingItems`, `coreBuilds`, `boots`, `runes`, `summonerSpells`, `skillOrder`, plus `eligibility` counts, disclaimer, rank-tier semantics, sample scope. Rows include static id/name/iconUrl, sampleSize, pickRate, wins, winRate (null below 5 games), lowSample, sampleBand.

Frontend never sees DB signatures.

---

## Cache

- Generation: `champ_builds:gen:{scope}`
- Payload: `champ_builds:champion:{generation}:{scope}:{champion,position,rankScopeToken}`
- TTL: existing `CHAMPION_STATS_CACHE_TTL_SECONDS`
- Write uses `setIfBuildGenerationCurrent` so a rebuild mid-compute skips stale writes

`CHAMPION_BUILD_AGGREGATION_VERSION` (default `1`) is independent of champion ranking `CHAMPION_AGGREGATION_VERSION`.

---

## Frontend

Lightweight **Overview | Builds & Runes** tabs on `/champions/:championKey`. No champion-page redesign. M13 ability row stays on the hero.

Builds tab requires a position. Sections: starting items, core (item → item → item), boots, runes, summoner spells, skill order. Sequences wrap/`overflow-x-auto`. Sample counts are always shown. Win % omitted below 5 games. If any row is ≥5, rows below 5 are hidden; otherwise sparse rows show with a limited-sample banner.

---

## Sample-depth findings

Display policy (not ranking 30): exploratory **5** / credible **10** / strong **20**. Win rate hidden below 5.

**ALL-rank signatures**, patch 16.15 / na1 / queue 420, after rebuild:

| Category | ≥1 | ≥5 | ≥10 | ≥20 | ≥30 | max | median |
|---|---|---|---|---|---|---|---|
| Starting items | 773 | 185 | 84 | 19 | 6 | 38 | 2 |
| Core builds | 2190 | 36 | 1 | 0 | 0 | 11 | 1 |
| Boots | 1086 | 313 | 162 | 47 | 13 | 48 | 2 |
| Runes | 4542 | 159 | 23 | 4 | 0 | 25 | 1 |
| Spell pairs | 1010 | 317 | 205 | 99 | 53 | 74 | 2 |
| Skill max order | 921 | 313 | 197 | 87 | 40 | 75 | 2 |
| Literal skill sequence | 4300 | 121 | 6 | 0 | 0 | 16 | 1 |

Honest read: with ~1400 collected matches (~669 current-patch ranked solo na1), **spells, boots, starting items, and ability max order are already useful at the exploratory/credible band**. **Core item combinations and full rune pages / literal sequences are still sparse** — the UI must keep sample counts visible and must not present 1-game 100% as a recommendation. The dataset is not a mature global build meta.

---

## Tests

Source/reconstruction (match-analytics): final-item and timeline eligibility, purchase/sell/undo/destroy, boots vs completed vs component, spell canonicalization, skill sequence + max order, missing timeline/runes, partial eligibility, additive merge, sample policy.

Aggregate: accumulation + idempotent rebuild (delete+insert), rank ALL vs exact, segment pool merge without averaging percentages.

API: empty champion, UNKNOWN hidden, static identity/icons, GOLD exact filters. Ranking floor 30 still enforced on the stats table in the same integration file.

Frontend: starting/core/boots/runes/spells/skill, low-data, loading/error, tabs + keyboard.

E2E (mocked): Ahri (mid), Aatrox (top), Jinx (ADC), Thresh (support); low-sample and empty; 390 / 1024 / 1440 no horizontal overflow. Existing Overview + M13 ability e2e still pass.

---

## Skill-order semantic correction

**Previous bug.** The Builds & Runes headline used first-learned / early-level order. Two backend causes, not a Vue-only issue:

1. `deriveAbilityMaxOrder` fell back to first occurrence / investment when Q/W/E had not all reached rank 5, so `E → W → Q` at levels 1–3 was labeled as max order.
2. Reconstruction preferred stored `skillOrder` even when it was a truncated first-learned prefix, starving timeline `SKILL_LEVEL_UP` reconstruction.

Example: Sylas commonly starts `E → W → Q` but maxes **W then E then Q**. The UI showed `E > W > Q`.

**Max-order definition.** Order in which the three basic abilities first reach rank 5. R is ignored (ultimate ranks are gated separately). Signature example: `W>E>Q`. Partial games contribute only abilities that actually hit rank 5 (`W` is valid; remaining order is not invented from first-learned). Missing / malformed `SKILL_LEVEL_UP` events → not max-order eligible.

**Eligibility denominator.** `SKILL_MAX_ORDER` pickRate uses the max-order-eligible participant pool only. `SKILL_SEQUENCE` has its own pool. Pools are not mixed. API `skillOrderEligibleGames` is the max-order pool.

**Distinction from level sequence.** Literal leveling (`E W Q W W R …`) remains `SKILL_SEQUENCE` and is attached to the top max-order row as `levelSequence` (optional secondary copy). It does not derive `maxOrder`. DTO field renamed from `sequence` to `levelSequence`.

**Rebuild.** Skill categories only, persisted source, no Riot:

```
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --categories SKILL_PRIORITY,SKILL_SEQUENCE --confirm
```

Delete+insert scoped to those categories; starting items, core, boots, runes, and spells are left in place.

Confirmed skill-only rebuild (16.15 / na1 / 420): 669 matches, 6690 participants, catalog 868.

| | Count |
|---|---|
| SKILL_SEQUENCE eligible participants | 6150 |
| SKILL_MAX_ORDER eligible participants | 5951 |
| Skill rows written | 23200 |
| Skill rows deleted (first apply) | 21412 (previous semantics) |
| Second apply | 23200 deleted / 23200 upserted (idempotent) |
| BOOTS / RUNES / STARTING_ITEMS after skill rebuild | 6744 / 15837 / 4468 (untouched) |

**Regression tests.** Deterministic Sylas-like slot list `3,2,1,2,2,4,2,3,2,3,4,3,3,1,1,4,1,1` → maxOrder `W>E>Q`, firstLearned `E>W>Q`. Also Q>W>E, W-max despite E-first, partial first-max only, missing events, malformed slots, R ignored, timeline vs truncated stored order, independent denominators, category-filtered rebuild, mapper/UI headline vs secondary sequence.

**Local validation (16.15 / na1 / 420, ALL rank).** This corpus does not contain a large E-start Sylas sample — Sylas mid/jungle here typically **learns Q first**. The live analogue of “learned first ≠ maxed first” is **Ahri mid**:

| Champion | Role | Headline max order | Most common leveling sequence start | Notes |
|---|---|---|---|---|
| Ahri (103) | MIDDLE | **Q > W** (n=44 / elig 68) | **W Q E …** (elig 70) | W is learned first; Q is maxed first. Old headline was `W>Q>E` from first-learned fallback. |
| Sylas (131) | MIDDLE | **Q > W** (n=10 / elig 14) | **Q E W …** (elig 15) | First-learned Q>E>W is not the max-order headline. Full `Q>W>E` only when E actually hits rank 5 (n=2). |
| Jinx (222) | BOTTOM | **Q > W** (n=33 / elig 48) | **Q W E …** (elig 50) | ADC Q max; E often not rank 5. Old headline invented `Q>W>E`. |
| Aatrox (266) | TOP | **Q > E** (n=16 / elig 27) | **Q E W …** (elig 28) | W often unmaxed. |
| Thresh (412) | SUPPORT | **Q** (n=29 / elig 61) | **Q E W …** (elig 69) | Short support games: only Q max is known. Old headline invented `Q>E>W`. |

Partial signatures (`Q`, `Q>W`) are honest. Sequence pick-pool remains larger than max-order where games end before a basic hits rank 5.

---

## Skill-priority inference correction

**Cause of partial rows.** Requiring a basic to physically reach rank 5 produced product headlines such as `Q` and `Q > W` because many matches end before the second/third basic is maxed. That is completion-order, not maxing **priority**.

**New inference.** `SKILL_PRIORITY` answers “in what order is the player prioritizing Q/W/E for maxing?” Comparator:

1. Final rank reached
2. Earliest event reaching rank 5, then 4, then 3, then 2

Rank-1 unlock timing does **not** break ties. First-learned order never determines priority. R is excluded from priority (still present in `levelSequence`). Eligible output is exactly one of six canonical signatures: `Q>W>E`, `Q>E>W`, `W>Q>E`, `W>E>Q`, `E>Q>W`, `E>W>Q`.

Examples: W5/E3/Q1 after starting `E W Q …` → `W>E>Q`. Q4/W3/E1 with nobody at 5 → `Q>W>E`.

**Ambiguity.** If any pair cannot be ordered (e.g. Q=2, W=1, E=1, or all rank 1), the participant is `SKILL_PRIORITY` ineligible. Do not invent a permutation and do not persist partial `Q` / `Q>W` product rows.

**Denominator.** Pick rate uses `SKILL_PRIORITY_ELIGIBLE` only; not the sequence pool. Rebuild with `--categories SKILL_PRIORITY,SKILL_SEQUENCE` also deletes leftover `SKILL_MAX_ORDER` rows.

Confirmed skill-only rebuild (16.15 / na1 / 420): 669 matches, 6690 participants.

| | Count |
|---|---|
| SKILL_SEQUENCE eligible | 6150 |
| SKILL_PRIORITY eligible (complete 3-ability) | 6057 |
| Ambiguous / priority-ineligible among sequence-eligible | 93 |
| Previous SKILL_MAX_ORDER eligible (rank-5 completion) | 5951 |
| Skill rows deleted (first apply, old partial max-order + sequences) | 23200 |
| Skill rows written | 20801 |
| Second apply | 20801 deleted / 20801 upserted (idempotent) |
| Leftover `SKILL_MAX_ORDER` rows | 0 |
| Distinct priority signatures | exactly the six canonical permutations |
| Partial `Q` / `Q>W` product signatures | none |
| BOOTS after skill rebuild | 6744 (untouched) |

**Live champion headlines (ALL rank):**

| Champion | Role | Priority headline | Sequence start | Notes |
|---|---|---|---|---|
| Ahri | MIDDLE | **Q > W > E** (n=57 / elig 68) | **W Q E …** (elig 70) | W learned first; Q prioritized. No more `Q>W` partial. |
| Sylas | MIDDLE | **Q > W > E** (n=14 / elig 14) | **Q E W …** (elig 15) | First-learned Q>E>W is not the headline. |
| Jinx | BOTTOM | **Q > W > E** (n=47 / elig 48) | **Q W E …** | Complete ADC Q max priority. |
| Aatrox | TOP | **Q > E > W** (n=27 / elig 27) | **Q E W …** | Complete, including unmaxed W as third. |
| Thresh | SUPPORT | **Q > E > W** (n=44 / elig 66) | **Q E W …** | Was `Q` under rank-5 completion; now a full permutation. |

This corpus still has little E-start Sylas; the live “learned first ≠ priority” case is Ahri mid. The deterministic E-start / W-priority fixture remains in unit tests.

---

## Core-build semantic correction

**Previous partial-sequence bug.** Product Core Build mixed 1-item and 2-item sequences with complete 3-item builds. `deriveCoreBuildItemIds` returned whatever completed majors it found (length 1–3) and `contributions.ts` emitted `CORE_BUILD` whenever `core.length > 0`. The mapper and UI passed those rows through. That made short games look like ranked “core builds.”

Before CORE_BUILD-only rebuild (16.15 / na1 / 420):

| Signature length | Rows |
|---|---|
| 1 item | 848 |
| 2 items | 1981 |
| 3 items | 4693 |
| Total | 7522 |

Examples: Aatrox top headed by `6610` (one item); Thresh support headed by `3190>3109` (two items); Ahri mid mixed `3118>4645` with 3-item rows. Pick-rate `eligibleGames` included those partial games (Ahri mid 37, Jinx 32, Aatrox 13, Thresh 23).

**Exact 3-item definition.** Primary `CORE_BUILD` is the first three qualifying completed major non-boot items in **completion order** from reconstructed timeline state (`ITEM_PURCHASED` / `SOLD` / `UNDO` / `DESTROYED`). Not final-inventory slot order. Not padded. Not inferred from leftover components.

Example: Luden's / Malignance → Shadowflame → Rabadon's → `[itemA, itemB, itemC]`.

**Qualifying item.** `classifyItem === COMPLETED_MAJOR`: nonempty `from` and `goldTotal >= 2000`. Ornn `into` still completed. Excluded: boots, trinkets, consumables/elixirs (`Consumable` tag or `consumed`), components, Lane/Jungle starters with no recipe. No champion-specific item lists.

**Eligibility / denominator.** `CORE_BUILD_ELIGIBLE` only when reconstructed completions `>= 3`. Use the first 3; 4+ still eligible. 1 or 2 completions → ineligible, no product row. Pick rate uses the core-build-eligible pool only (same pattern as skill-priority), not all champion games and not all timeline-eligible games.

Undo reverses a completion. Sell does **not** (the item was completed). A component purchase plus upgrade is one completion, not two. Duplicate completed items are allowed only when actually purchased twice.

**Rebuild (CORE_BUILD only, persisted timelines, no Riot):**

```
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --categories CORE_BUILD --confirm
```

| | Count |
|---|---|
| Matches scanned | 669 |
| Match-eligible participants | 6690 |
| Build-source / item-timeline eligible | 2960 |
| Core-build eligible (≥3 majors) | 1798 |
| Ineligible because <3 major items | 1162 |
| Rows deleted (first apply, including partials) | 7522 |
| Rows written | 4690 |
| Second apply | 4690 deleted / 4690 upserted (idempotent) |
| 1-item / 2-item product rows after | **0 / 0** |
| All product `CORE_BUILD` `entityIds.length` | **3** |
| Rows containing a Boots-tagged item | **0** |
| STARTING_ITEMS / BOOTS / RUNES / SPELLS / SKILL_PRIORITY / SKILL_SEQUENCE | 4468 / 6744 / 15837 / 6622 / 5420 / 15381 (untouched) |

**Sample-depth effect (ALL rank signatures):**

| | Before (mixed lengths) | After (3-item only) |
|---|---|---|
| Distinct signatures | 2190 | 1368 |
| ≥1 game | 2190 | 1368 |
| ≥5 | 36 | 28 |
| ≥10 | 1 | 1 |
| ≥20 | 0 | 0 |
| ≥30 | 0 | 0 |
| Max `eligibleGames` on an ALL-rank row | 46 | 36 |

Tightening eligibility shrinks the denominator and removes partial headlines. This corpus still rarely repeats the same 3-item path; almost no signature reaches 10 games. First-item / two-item-core product sections were **not** implemented — they would need separate categories later.

**API invariant.** `ChampionCoreBuildSchema.items` is `.length(3)`. `mapCoreBuilds` drops legacy rows unless `entityIds.length === 3` and all ids `> 0`. Malformed partials never reach the frontend.

**UI.** Core Build renders `[item 1] → [item 2] → [item 3]` only (`completeCoreBuilds` filters `items.length === 3`). Empty copy: “Not enough games reached a complete 3-item core build for this filter.” No fallback to 1-item / 2-item cards. Boots stay in their own section.

**Live champion cores (ALL rank, 16.15 / na1 / 420):**

| Champion | Role | Eligible 3-item games | Top 3-item core | Notes |
|---|---|---|---|---|
| Ahri | MIDDLE | 23 (was 37 incl. partials) | Malignance → Shadowflame → Zhonya's Hourglass / Rabadon's (n=4 each) | No more 2-item `3118>4645` rows. |
| Jinx | BOTTOM | 25 (was 32) | Hexoptics C44 → Phantom Dancer → Infinity Edge (n=7) | 2-item ADC prefixes removed. |
| Aatrox | TOP | 6 (was 13) | Six distinct 3-item paths at n=1 | Former headline `6610` (Sundered Sky only) is gone. |
| Thresh | SUPPORT | 14 (was 23) | Locket → Knight's Vow → Bandlepipes / Frozen Heart (n=2) | Former `3190` / `3190>3109` partials gone. |

**Tests.** 1-item / 2-item ineligible; 3-item `[A,B,C]`; 4-item first three; boots between core purchases ignored; components ignored; component+upgrade is one completion; undo not counted; sell keeps prior completion; duplicate completed item when purchased twice; mapper drops partial legacy signatures; Zod rejects `items.length !== 3`; Vue never renders <3 core items and shows the 3-item empty copy; CORE_BUILD-only rebuild is idempotent and does not delete boots/skills/starting items.

---

## Visual validation

- Overview tab: primary stats / performance / breakdown unchanged.
- Builds & Runes tab: sectioned icons + pick % + games; core arrows wrap/scroll.
- Ability bar (M13) still on the hero above tabs.
- Viewports 1440 / 1024 / 390 covered by Playwright (no committed screenshots).

Live DB was validated via rebuild counts + sample-depth SQL, not a production screenshot pass.

---

## Known limitations

- Historical pre-preservation matches remain ineligible for timeline categories.
- ~44% of current-patch participants have item-purchase timelines; starting/core follow that ceiling.
- Core-build signatures are high-cardinality / low-repeat; after the 3-item eligibility cut, 28 ALL-rank signatures reach 5 games and 1 reaches 10. Do not fall back to partial sequences to fill the page.
- Games that end before a third completed major item are omitted from Core Build (empty section / low-data copy), not shown as 1-item or 2-item cores.
- Public `tier` query does not yet accept `HIGH`/`APEX` as a segment token; merge helper is ready when rank scope is `SEGMENT`.
- Style IDs missing on some older rows → perk IDs shown without tree names.
- Item catalog required for starting/core/boots; sync 16.15.1 before rebuild.
- Rebuild batch default 2000; 669 matches fit one batch. Resume via `--offset`.
- No live match refetch; no OP.GG/U.GG; no invented recommendations.
- Games whose Q/W/E investment is ambiguous are omitted from skill-priority (empty section), not shown as partial `Q` / `Q>W` rows.

---

## Deferred work

- M15+ matchups / AI coaching / population expansion / crawler enablement / production infra.
- Optional public segment query (`SEGMENT:HIGH`) if product wants it in the tier control.
- Optional full six-slot final-item sets if sample depth grows.
- Sync build static for additional Data Dragon patches (16.16.1 exists, not used for this corpus).
- Incremental (non-CLI) build aggregation on match ingest.
- Optional separate First Item / Two-Item Core products if sample depth justifies them. Do not mix those lengths back into the main 3-item Core Build ranking.

---

## How to verify

```
pnpm db:generate
pnpm db:migrate:deploy
pnpm champions:sync-build-static -- --version 16.15.1
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --dry-run
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --categories SKILL_PRIORITY,SKILL_SEQUENCE --confirm
pnpm aggregates:rebuild-champion-builds -- --patch 16.15 --platform na1 --queue 420 --categories CORE_BUILD --confirm
pnpm --filter @league-helper/shared test
pnpm --filter @league-helper/match-analytics test
pnpm --filter @league-helper/api test
pnpm --filter @league-helper/worker test
pnpm --filter @league-helper/web test
pnpm --filter @league-helper/web test:e2e -- e2e/champions.e2e.ts -g "Builds"
```

Open `/champions/Sylas?platform=na1&queue=420&patch=16.15&position=MIDDLE` → Builds & Runes Skill order should be ability max order, not first-learned.

Open `/champions/Ahri?platform=na1&queue=420&patch=16.15&position=MIDDLE` → Core build rows must show exactly three item icons; no 1-item or 2-item cards.
