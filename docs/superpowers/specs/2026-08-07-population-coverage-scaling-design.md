# Milestone 11 Design: Population Acquisition / Coverage Scaling

**Date:** 2026-08-07
**Status:** implementation validated through Phase 6 (A1 live proof); A2 deferred; commit pending user ask
**Amendments:** (A) representative-tier acquisition required before full M11 product completion; (B) shared cross-process Riot 429 cooldown required before Phase 5 live scaling

**Branch:** `milestone-11-population-coverage-scaling`
**Base:** `f2dd61e` (merge of PR #4 — Milestone 10 Champion Page UI)
**Depends on:** Milestone 9 Task 4 population expansion (`91a019f` / `45fec54`)
**Plan:** `docs/superpowers/plans/2026-08-07-population-coverage-scaling.md`

### Implementation status (2026-08-10)

| Phase | Status |
| ----- | ------ |
| 0 Design | ✅ |
| 1 Ladder provider | ✅ |
| 2 Ladder enrollment / caps / CLI | ✅ |
| 3 Refresh policy (HOT/WARM/COLD) | ✅ |
| 3A Shared Riot cooldown | ✅ |
| 4 Coverage CLI | ✅ |
| 5 Controlled A1 live run | ✅ (A2 deferred — auth ops gate) |
| 6 Validation / regression / commit gate | ✅ validation; commit not created |

**A1 outcome:** tracked 5→30 (25 LADDER depth-0 roots); na1 q420 coverage ≥1 **19→161**; classic-zero **154→51**; current-patch matches **2→31**. Ranking floor remains **30**.

**Honest remaining limitation:** No champion-position bucket reached ranking floor ≥30 yet; requires continuous population growth.

**Follow-ups (next ops / milestone, not Phase 6 blockers):** restore Riot API key health; drain/retry auth-failed ingest jobs; complete RankSnapshot refresh for LADDER roots missing snapshots (23/25); bounded A2 Diamond→Gold when auth is healthy.

---

## 1. Goal and non-goals

### Goal

Grow League Helper from a tiny seed-based tracked population toward **representative ranked Solo/Duo coverage** that makes public champion statistics materially useful — while **preserving Task 4 safety controls** as the execution substrate.

Milestone 11 answers:

> What is the safest practical path from our current tiny tracked population to tens of thousands of useful ranked matches?

### Critical framing

Success is **not** “collect every Riot match.”

Success is a **scalable, bounded, rate-limit-aware acquisition architecture** that:

- enrolls a much larger active ranked population
- ingests distinct queue-420 matches efficiently (global dedup)
- densifies current-patch champion-position buckets
- remains restart-safe under concurrency, 429s, and crashes

### Non-goals (explicit)

- Champion matchup / counter aggregation UI
- Strong Against / Weak Against frontend
- Champion or player page redesign
- Mainland China / Tencent / WeGame support
- Exhaustive all-region crawl
- Data warehouse migration / sharding
- Monetization / AI summaries
- Lowering `CHAMPION_AGGREGATION_MIN_SAMPLE` (ranking floor stays 30)
- Replacing Task 4 safety machinery
- Public collector/scheduler REST or Nuxt admin UI

### Next milestone boundary

After Milestone 11 coverage scaling:

**Champion Matchups / Counters** — `MatchupAggregate` writer, public DTO, Nest read API, Strong/Weak Against UI, honest sample-size handling.

Do not implement that work here.

---

## 2. Current architecture (inspected)

```text
Acquisition / enrollment (Nest API / CLIs)
  ADMIN_SEED / PRODUCT_SEARCH / BOOTSTRAP
    → CollectorEnrollmentService (TrackedPlayer, depth 0)
  MATCH_PARTICIPANT (worker post-COMPLETED, Task 4)
    → fixed participant window → quota TX → TrackedPlayer

Collection (Nest CLIs; not auto-started by API/worker)
  collector:run / collector:scheduler
    → PopulationCollectorService.runOnce
    → claim TrackedPlayer wave (leases)
    → discover match IDs (queue filter) + soft ranks
    → enqueue INGEST_MATCH (sourceCollectorRunId when scheduled/manual collector)

Ingestion (apps/worker)
  match-ingestion → fetch match (+ optional timeline)
    → persist Match/Participant (unique provider+externalMatchId)
    → enqueueAggregationSafe
    → expandMatchParticipantsSafe (optional)

Aggregation (apps/worker)
  champion-aggregation → ChampionAggregate dimension rows
```

### Task 4 remains the execution/safety substrate

Milestone 11 **selects and prioritizes populations**. Task 4 **executes and bounds** them.

Preserve without replacement:

| Invariant | Mechanism |
| --------- | --------- |
| Bounded execution | `runOnce` batch/concurrency/match-id/enqueue caps |
| Global autonomous expansion budget | `CollectorPopulationBudget` atomic reservation |
| Per-run / per-source quotas | `CollectorRun` + `CollectorRunSourceQuota` |
| Owner-safe singleton scheduler lease | `CollectorSchedulerState` TTL lease |
| Lease TTL safety | `leaseMs > ceil(batch/concurrency)*playerTimeout + safety` |
| Winner-only BullMQ backpressure | pending `waiting+active+delayed` vs threshold |
| Provider 429 cooldown | **M11 target:** shared cross-process `cooldownUntil` (Retry-After-aware); today is scheduler-local only |
| Deterministic participant expansion | immutable sort + fixed window |
| Race-safe reservations | single TX: budget increments + TrackedPlayer insert |
| Deduped tracked enrollment | `TrackedPlayer.playerAccountId` unique |
| Deduped match ingestion | `Match(provider, externalMatchId)` unique + job idempotency |
| No recursive immediate crawl | expansion enrolls only; later `runOnce` waves collect |
| Explicit `enrollmentSource` immutability | first source preserved |
| Explicit `discoveryDepth` | min-on-rediscovery; roots propose 0 |
| Scheduler not auto-started | only `collector:scheduler` CLI |

---

## 3. Current coverage baseline (local DB, read-only, 2026-08-07)

Measured against local PostgreSQL (`league_helper`). No mutations.

| Metric | Value |
| ------ | ----- |
| Tracked players | **5** |
| By enrollmentSource | ADMIN_SEED 2, MATCH_PARTICIPANT 3 |
| By discoveryDepth | depth 0: 2; depth 1: 3 |
| By platform | **na1: 5** |
| Autonomous budget used | 3 / configured cap (default 500) |
| Player / PlayerAccount rows | 15 / 15 |
| Distinct matches (COMPLETED) | 106 |
| Queue 420 matches | 56 |
| Queue 440 matches | 13 |
| Queue 420 by platform | na1 35, kr 20, null 1 |
| Current active Data Dragon patch (`Patch.isActive`) | **16.15.1** |
| Current-patch (gameVersion `16.15.*`) queue-420 matches | **22** total; **na1 only 2** |
| Participant rows | 1134 |
| ChampionAggregate rows | 2061 (queue 420: 1069) |
| Collapsed champion×position (q420, all patches) sample≥1 / ≥30 / ≥100 | **362 / 1 / 0** |
| Exact aggregate rows (q420) sample≥1 / ≥30 / ≥100 | **1069 / 0 / 0** |
| Current-patch collapsed champion×position (q420, patch 16.15) ≥1 / ≥30 / ≥100 | **200 / 0 / 0** |
| na1 current-patch exact position (rankTier=ALL) ≥1 / ≥30 / ≥100 | **19 / 0 / 0** |
| Classic champions with zero q420 position data on patch 16.15 | **102 / ~173** |
| Sample-size distribution (exact q420 rows) | 1–2: 958; 3–9: 108; 10–29: 3; ≥30: 0 |
| Stale ACTIVE players (no success in 24h or never) | 2 |

### Patch semantics note (audit correction)

Phase 0 baseline used Data Dragon `Patch.isActive` + `Match.gameVersion` prefix for “current patch.”

Product champion-stats / existing `CollectorCoverageService` resolve “latest” via **`resolveLatestSemanticPatch`** over distinct `ChampionAggregate.patch` for platform+queue+versions (not `Patch.isActive`), and match coverage should prefer **`Match.normalizedPatch`**.

M11 coverage CLI and Phase 5 before/after metrics must use the **same** semantic-patch + `rankTier='ALL'` + exact-position shape as `CollectorCoverageService` / ranking reads — re-baseline with that path in Phase 4/5 rather than treating the Phase 0 DD-active numbers as the sole gate.

### Top-of-list observation

Largest current buckets are still tiny (sampleSize ~6–14), often on `kr` despite tracked roots being `na1`. Public champion pages correctly show sparse/no-data states. **This is a population coverage problem, not a UI problem.**

### Product metric (primary)

> How many public champion-position buckets have statistically useful sample sizes (≥30, ideally ≥100) on the current patch for queue 420?

Baseline answer: **≈0** for useful (≥30) current-patch buckets.

### Representation-health metric (added by design review)

Primary density metrics alone must not allow M11 to “pass” on Master+-only bias.

Distribution-health review check (not proportional demographics):

> No single apex tier should account for essentially the entire new population unless the live key/data source prevents broader acquisition.

See §17 for CLI fields and §19 for success criteria.

---

## 4. Bottlenecks

Ordered by impact:

1. **Population size** — 5 tracked players cannot produce representative champion coverage.
2. **Acquisition source gap** — no ladder/league enumeration in provider; growth depends on manual seed + shallow participant expansion.
3. **Current-patch scarcity** — only 2 na1 queue-420 matches on patch 16.15; historical patches dominate row counts without ranking utility.
4. **Refresh cadence economics** — default `COLLECTOR_MIN_REFRESH_INTERVAL_MS` = 6h; even a large TrackedPlayer set only yields `batch` discoveries per wave × schedule interval.
5. **API budget contention** — reactive per-process 429 handling only; scheduler-local cooldown; no shared cross-process cooldown yet (M11 must add shared cooldown before live scaling).
6. **Expansion defaults off / shallow** — `COLLECTOR_EXPAND_FROM_PARTICIPANTS=false` by default; max depth 1; 3 participants/match — correct for safety, insufficient alone for scale.
7. **No activity-tier refresh** — claim order is `priority DESC, nextEligibleAt ASC, lastSuccessfulRefreshAt ASC`; no hot/warm/cold differentiation beyond backoff after failures.
8. **Advisory request estimate unused** — `COLLECTOR_ESTIMATED_REQUESTS_PER_ENQUEUED_MATCH` is loaded but not an admission stop gate.
9. **Nest enrollment race surface** — `TrackedPlayerRepository.upsertEnrollment` is read-then-insert; unique constraint is the backstop. Ladder enrollment at scale must use a **reservation TX** pattern (like Task 4 expansion), not rely on the weaker Nest path alone.

---

## 5. Riot / provider capability matrix

Inspected: `packages/server-riot` (`RiotGameDataProvider`, schemas, client), `packages/shared/src/provider.ts`.

| Capability | In repo today? | Path / method | Population discovery use today |
| ---------- | -------------- | ------------- | ------------------------------ |
| Account by Riot ID | Yes | `GET /riot/account/v1/accounts/by-riot-id/...` via `resolvePlayer` | Search / bootstrap resolve |
| Account by PUUID | **No** (Phase 1 deferred) | Official: `GET /riot/account/v1/accounts/by-puuid/{puuid}` | **Phase 2 prerequisite** if enrollment requires Riot ID fields (ladder DTOs lack them) |
| Summoner by PUUID | Yes | `GET /lol/summoner/v4/summoners/by-puuid/...` via `resolvePlayer` | Search / bootstrap |
| Ranked entries by PUUID | Yes | `GET /lol/league/v4/entries/by-puuid/...` via `getRankedEntries` | Soft refresh on collector; product profile |
| Match ID list by PUUID | Yes | `GET /lol/match/v5/matches/by-puuid/.../ids` via `getRecentMatchIds` | Primary discovery for tracked players |
| Match detail | Yes | `GET /lol/match/v5/matches/{id}` via `getMatch` | Worker ingest |
| Match timeline | Yes | `.../timeline` via `getTimeline` | Worker ingest (configurable) |
| Champion mastery | Yes | mastery-v4 by PUUID via `getChampionMastery` | Product search/refresh; **not** collector discovery path |
| Challenger league by queue | **Yes (Phase 1)** | `GET /lol/league/v4/challengerleagues/by-queue/{queue}` via `getChallengerLeague` | Ladder A1 roots |
| Grandmaster league by queue | **Yes (Phase 1)** | `GET /lol/league/v4/grandmasterleagues/by-queue/{queue}` via `getGrandmasterLeague` | Ladder A1 roots |
| Master league by queue | **Yes (Phase 1)** | `GET /lol/league/v4/masterleagues/by-queue/{queue}` via `getMasterLeague` | Ladder A1 (capped later) |
| Paginated league entries by tier/division | **Yes (Phase 1)** | `GET /lol/league/v4/entries/{queue}/{tier}/{division}?page=` via `getLeagueEntriesByTierDivision` | Ladder A2 Diamond→Gold (bounded pages) |
| Player discovery by ranked ladder | **Yes (Phase 1 provider)** | Normalized `LadderCandidate` (apex + representative) | Enrollment is Phase 2 |

### Phase 1 verified contracts (official Riot developer portal `league-v4`)

Verified against https://developer.riotgames.com/apis#league-v4 / api-details (2026-08-10). Platform routing (e.g. `na1.api.riotgames.com`).

**A — Apex league-list**

| Endpoint | Method | Response |
| -------- | ------ | -------- |
| `/lol/league/v4/challengerleagues/by-queue/{queue}` | GET | `LeagueListDTO` |
| `/lol/league/v4/grandmasterleagues/by-queue/{queue}` | GET | `LeagueListDTO` |
| `/lol/league/v4/masterleagues/by-queue/{queue}` | GET | `LeagueListDTO` |

- Queue path values: `RANKED_SOLO_5x5`, `RANKED_FLEX_SR`, `RANKED_FLEX_TT` (M11 uses **`RANKED_SOLO_5x5`** ↔ match queueId **420** via explicit mapper only)
- `LeagueListDTO`: `leagueId`, `entries` (`LeagueItemDTO[]`), `tier`, `name`, `queue`
- `LeagueItemDTO` identity: **`puuid` present**; **no** `riotIdGameName` / `riotIdTagLine`; **no** `summonerId` on current documented DTO
- Pagination: **none** (full apex list per call)

**B — Paginated tier/division entries**

| Endpoint | Method | Response |
| -------- | ------ | -------- |
| `/lol/league/v4/entries/{queue}/{tier}/{division}` | GET | `LeagueEntryDTO[]` |

- Query: `page` optional, **defaults to 1, starts at 1**
- Tier path values: `DIAMOND`, `EMERALD`, `PLATINUM`, `GOLD`, `SILVER`, `BRONZE`, `IRON` (apex tiers are **not** on this endpoint)
- Division: `I`, `II`, `III`, `IV`
- `LeagueEntryDTO` identity: **`puuid` present**; **no** Riot ID fields; **no** `summonerId` on current documented DTO
- Page size: **not documented** by Riot (variable). Operational exhaustion signal: **empty array**
- Provider implements **one page per call** — no unbounded page loops

### Phase 1 review question — ANSWERED

> Can Riot league-v4 provide canonical PUUID-based candidates for both apex ladders and bounded lower-tier pages without expensive identity-resolution N+1 calls?

**YES for PUUID canonical identity.** Both apex `LeagueItemDTO` and paginated `LeagueEntryDTO` include `puuid` directly. No per-player identity lookup is required to form a PUUID-based `LadderCandidate`.

**NO for Riot ID completeness.** Official league-v4 DTOs do not include `riotIdGameName` / `riotIdTagLine` (and Riot’s summoner-name FAQ historically stated no plan to add Riot ID fields on League endpoints). `PlayerAccount` persistence requires `currentGameName` / `currentTagLine`, so Phase 2 enrollment needs a **bounded** `accounts/by-puuid` resolve (or skip-incomplete) policy — **not** implemented in Phase 1 provider mapping.

### Provider acquisition cost (list/page only; excludes later match collection)

| Source | Requests | Candidates / request | Identity completeness | Extra identity calls in Phase 1? | Bounded suitability |
| ------ | -------- | -------------------- | --------------------- | -------------------------------- | ------------------- |
| Challenger | 1 | Variable (undocumented; full apex list) | PUUID yes; Riot ID no | 0 | Excellent for A1 |
| Grandmaster | 1 | Variable (undocumented; full apex list) | PUUID yes; Riot ID no | 0 | Excellent for A1 |
| Master | 1 | Variable (often large; undocumented) | PUUID yes; Riot ID no | 0 | Use under caps |
| Diamond / Emerald / Platinum / Gold page | 1 / page | Variable (page size undocumented) | PUUID yes; Riot ID no | 0 | Excellent for bounded A2 |

Rough list-fetch cost for ~100 PUUID candidates (excluding Phase 2 Riot ID resolve and all match ingest): typically **1 apex list call** (when the list has ≥100 entries) or **ceil(100 / pageSize)** representative page calls — pageSize unknown, so treat as **O(pages)** with operator page caps.

---

## 6. Acquisition strategies evaluated

| Strategy | Verdict | Rationale |
| -------- | ------- | --------- |
| **A1. Apex ladder seeding** | **Primary proof path** | Challenger + Grandmaster prove pipeline safely; Master later under caps |
| **A2. Representative tier seeding** | **Required before M11 completion** (if Riot contract supports) | Bounded/paged Diamond / Emerald / Platinum / Gold prevents Master+-only bias; expansion cannot fix tier mix |
| **B. Participant graph expansion** | **Secondary amplifier only** | Task 4 fixed window; good breadth around existing roots; **must not** be relied on for tier representation (high-MMR roots → high-MMR neighbors) |
| **C. Under-covered bucket targeting** | **Deferred** | Champion/position unknown before match fetch; predictive targeting is weak |
| **D. Activity/staleness refresh** | **Required (Phase 3)** | Prefer players producing new unique matches |
| **E. Regional rollout** | **Required (Phase A = na1)** | Avoid multi-platform stampede before observability exists |

### Selected approach (staged)

```text
PRIMARY ROOT ACQUISITION (LADDER, depth 0)
  Phase A1 — prove acquisition (na1, queue 420)
    Challenger + Grandmaster
  Phase A2 — broaden representation (same platform/queue; after A1 healthy)
    bounded/paged samples from Diamond, Emerald, Platinum, Gold
    (lower than Gold deferred unless cheap/useful)
    Master only under explicit caps — not the sole population

SECONDARY AMPLIFIER
  MATCH_PARTICIPANT expansion (Task 4 fixed window)
    breadth around enrolled roots — NOT responsible for tier mix

SHARED SAFETY
  race-safe LADDER enrollment + total hard caps
  shared Riot 429 cooldown (before Phase 5 live scaling)
  scheduler backpressure + hot/warm/cold refresh
  coverage CLI (density + representation health)
```

**Milestone 11 must not end with apex-ladder acquisition alone** when league-v4 paginated tier entries are available.

---

## 7. Recommended acquisition architecture

### Direct answer to the design question

**Safest practical path:**

1. **Primary root source A1:** apex ladder lists (Challenger + Grandmaster) on **na1** queue 420 — prove enrollment → collector → ingest safely.
2. **Primary root source A2:** bounded/paged representative-tier candidates (Diamond, Emerald, Platinum, Gold) via league-v4 paginated entries **after** A1 is healthy — required before M11 completion if Riot contract supports PUUID candidates.
3. **Secondary amplifier:** Task 4 participant expansion (shallow fixed window) for graph breadth — **not** a substitute for A2.
4. **Enrollment rate:** small paced waves (tens–low hundreds of new `TrackedPlayer` creates per ladder run), never bulk-flooding match queues.
5. **Refresh policy:** activity tiers via `priority` + `nextEligibleAt` (hot sooner, cold much later).
6. **Regional scope:** **na1 only** until coverage report shows healthy ≥30 bucket growth **and** representation health is not apex-only.
7. **Rate-limit constraints:** **shared cross-process cooldown** (Retry-After-aware) + winner-only scheduler backpressure + modest worker concurrency; all Riot consumers honor the same cooldown.
8. **Downstream queue limits:** keep `COLLECTOR_MAX_PENDING_INGESTION_JOBS`; ladder enrollment must not bypass it when triggering collection.

### Component sketch

```text
LadderSource (new, Nest CLI)
  → Riot apex league-list OR paginated tier/division entries
  → normalize to common LadderCandidate shape
  → candidate identities (puuid + platform + riotId when available)
  → race-safe LADDER enrollment TX (ladder + total caps)
  → TrackedPlayer (enrollmentSource=LADDER, discoveryDepth=0)
  → existing PopulationCollectorService.runOnce / scheduler
  → match-ingestion + aggregation + optional expansion
```

**Hard rule:** Ladder seeder enrolls candidates into the tracked population. It does **not** directly enqueue thousands of match jobs outside Task 3/4 budgets.

**Hard rule:** Participant expansion must not be treated as the tier-representation strategy.

---

## 8. Population source model

Existing enum:

```text
ADMIN_SEED | PRODUCT_SEARCH | BOOTSTRAP | MATCH_PARTICIPANT
```

### Add

```text
LADDER
```

| Source | Depth on create | Consumes MATCH_PARTICIPANT autonomous budget? | Notes |
| ------ | --------------- | --------------------------------------------- | ----- |
| ADMIN_SEED | 0 | No | Operator |
| PRODUCT_SEARCH | 0 | No | Product |
| BOOTSTRAP | 0 | No | Ops CLI |
| **LADDER** | **0** | **No** | New acquisition root; uses **ladder enrollment budget** + **global hard tracked ceiling** |
| MATCH_PARTICIPANT | parent+1 | Yes | Task 4 unchanged |

### Immutability

Preserve first `enrollmentSource`. Re-discovery as ladder/search/participant may only `min(discoveryDepth)` and refresh routes — never rewrite source.

### Global hard ceiling (new)

Introduce a **hard total TrackedPlayer safety ceiling** (config + hard max), separate from MATCH_PARTICIPANT autonomous budget.

Rationale: ladder roots + seeds can exceed the autonomous participant budget by design today; at scale there must still be a configured absolute ceiling.

Suggested defaults (validation targets, not magic):

| Knob | Initial default | Hard max |
| ---- | --------------- | -------- |
| `COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP` | 5000 | 50000 |
| `COLLECTOR_LADDER_MAX_NEW_PER_RUN` | 100 | 1000 |
| `COLLECTOR_LADDER_MAX_TOTAL` | 3000 | 20000 |

Exact numbers finalized in Phase 2 after cost-model dry-run against the live key class.

---

## 9. Ladder seeder design

### Modes

| Mode | Source | When |
| ---- | ------ | ---- |
| Apex | Challenger / Grandmaster (/ Master under caps) league-list | Phase A1 first; pipeline proof |
| Representative tier | Paginated entries for Diamond / Emerald / Platinum / Gold (divisions + pages bounded) | Phase A2 after A1 healthy; **required before M11 completion if contract supports** |

Both modes normalize into one **`LadderCandidate`** shape (puuid, platform, optional riotId, observed tier/division, source kind).

### Flow

1. Operator runs `pnpm collector:ladder-seed` with platform + queue + mode/tiers (and for A2: divisions, page bounds, max-new).
2. Provider fetches either apex league-list **or** bounded tier/division pages for `RANKED_SOLO_5x5` (queue 420).
3. Normalize entries → `LadderCandidate[]` (require PUUID; require gameName/tagLine **or** resolve path if DTO incomplete — prefer no N+1; if resolve required, budget it explicitly).
4. For each candidate up to per-run cap:
   - upsert `PlayerAccount` when identity complete
   - enroll `TrackedPlayer` with `LADDER`, depth 0, platform allowlist check via **race-safe reservation TX** (ladder counter + total hard-cap + unique `playerAccountId`; rollback on conflict — do **not** use plain Nest read-then-insert as the sole guard)
   - stop on total/ladder caps
5. Optionally set elevated `priority` for freshly ladder-seeded players so the next collector waves prefer them.
6. Do **not** call match-id discovery inside the seeder loop beyond what enrollment requires.

### Representative-tier bounds (A2)

- Per-run page/candidate caps (config hard maxes).
- Explicit tier allowlist: Diamond, Emerald, Platinum, Gold (below Gold deferred).
- Do **not** require equal samples per tier.
- Do **not** exhaustively crawl every division page.
- Do **not** enable Master-at-scale + broad lower-tier paging + multi-region in one step.

### Identity completeness policy

- If ladder/entry DTO includes PUUID + riotId fields → Account-v1-free upsert (same as Task 4 participants).
- If riotId missing → **skip or bounded resolve** (config); never unbounded Account-v1 N+1 across large Master or multi-page tier crawls.
- Provider today has **no** `accounts/by-puuid`; if rows are PUUID-only, Phase 1 must decide: skip, bounded summoner/account resolve path (external-docs-confirmed), or defer that mode.
- Incomplete identities are counted and reported; not silently dropped without metrics.

### Partial page / failure semantics

- Partial ladder/page fetch → enroll what was successfully parsed; report incomplete; restart-safe (idempotent enroll).
- 429 → stop seeder; publish **shared** provider cooldown; do not retry-storm.
- 403/404 → fail that tier/page with clear code; do not mark whole platform dead without evidence.

---

## 10. Participant expansion recommendation

Keep Task 4 semantics exactly:

- Fixed window: filter stable identity → sort `externalAccountId ASC`, `participantId ASC` → take N
- Default N=3; hard max 9
- Depth default 1; hard max 3
- No recursive immediate collection

### Milestone 11 tuning policy

| Stage | Expansion | Window | Depth | Notes |
| ----- | --------- | ------ | ----- | ----- |
| After ladder Phase 1 | Enable | 3 | 1 | Validate quota/dedup under more roots |
| If ≥30 buckets stall | Consider 5 | 1 | Cost ~1.67× candidates/match; still non-recursive |
| Avoid by default | 9 | ≥2 | High collision with ladder roots; explosion risk if caps raised carelessly |

**Do not remove depth limits.** Prefer more ladder roots (including representative-tier roots) over deeper crawl.

**Do not use expansion for tier representation.** Apex roots mostly yield high-MMR neighbors; Diamond→Gold mix must come from A2 ladder acquisition.

Growth factor intuition (bounded, not exponential):

- Each completed q420 match can enroll ≤N new players once (window lifetime).
- Those players collect only on later bounded waves.
- With global/run/source caps, growth is linear in completed attributed matches until caps bind.

---

## 11. Refresh / prioritization recommendation

Do **not** build a champion-aware predictive optimizer in this milestone.

### Simple activity tiers (via existing fields)

| Tier | Signal | Policy |
| ---- | ------ | ------ |
| Hot | Last successful discovery enqueued ≥1 new match | Higher `priority`; shorter `nextEligibleAt` |
| Warm | Recent success but 0 new enqueues (all deduped) | Default priority; normal refresh interval |
| Cold | Several consecutive zero-new-match successes | Lower priority; much longer `nextEligibleAt` |
| Failed | Discovery failures / 429 | Existing exponential backoff |

Implementation sketch: extend collector finalize path to adjust `priority` / `nextEligibleAt` from enqueue result counts — no new ML, no champion targeting.

### Patch awareness

- Scheduled collector continues queue **420** filter.
- Prefer recent match pages (already “recent IDs”); avoid deep historical pagination in this milestone.
- Do not delete historical matches/aggregates.
- Coverage reports split **current patch** vs all patches.

### Queue scope

- Primary: **420 Ranked Solo/Duo**
- Flex 440: secondary / out of success criteria for M11 (may exist in DB; ignore for targets)

---

## 12. Regional rollout

| Phase | Scope |
| ----- | ----- |
| **A (M11 default)** | `na1` only (`COLLECTOR_PLATFORM_ALLOWLIST=na1`) |
| B (later) | Additional platforms in same regional route (e.g. americas) |
| C (later) | Broader regions with per-platform caps |

Do not design “all regions at once” as the first execution step.

---

## 13. Rate-limit / API cost model

### CURRENT (today)

- Provider parses Riot rate-limit headers but does **not** proactive-pace.
- 429 → throw; worker delays that job; collector stops claiming in-run; scheduler sets **local** `CollectorSchedulerState.cooldownUntil` using configured floor.
- Scheduler cooldown **does not currently use observed Retry-After**.
- No cross-process shared cooldown; no proactive shared token bucket.
- Concurrent consumers (ladder seeder / collector / worker / product search) can independently stress the same key.

### M11 TARGET (required before Phase 5 live scaling)

Shared cross-process **429 cooldown coordination** — not a full distributed token bucket.

| Requirement | Rule |
| ----------- | ---- |
| Publishers | Any Riot consumer that observes 429 (ladder seeder, population collector/scheduler, match-ingestion worker at minimum) |
| Signal | Persist shared `cooldownUntil` (prefer existing Redis if natural; else DB singleton) |
| Duration | `max(configuredMinimumCooldown, observedRetryAfter)` when Retry-After present; else configured minimum |
| Monotonicity | Concurrent updates must **not shorten** an existing later `cooldownUntil` |
| Consumers | Ladder seeder, collector scheduler / `runOnce` admission, and worker (compatible pause/delay) check shared cooldown before starting new Riot acquisition/discovery/ingest work where practical |
| Integration | Scheduler-local cooldown integrates with / defers to the shared signal — must not compete or ignore it |
| Anti-stampede | One consumer’s 429 suppresses new work from the others until expiry |

Do **not** build a full proactive token-bucket rate allocator in M11 unless the repo already has a natural implementation.

### FUTURE POSSIBLE (out of M11 success criteria)

- Proactive token bucket / centralized rate allocator using `x-*-rate-limit-count` headroom
- Per-method budgets and global RPS shaping

M11 does **not** claim to solve every rate-limit problem.

### Shared cooldown architecture (locked for plan Phase 3A)

```text
Riot 429 observed
  → parse Retry-After (seconds, capped sensibly)
  → sharedCooldownUntil = now + max(floorMs, retryAfterMs)
  → write with monotonic max(existing, new)
  → local consumer stops / delays

Any Riot consumer before new work
  → read shared cooldownUntil
  → if now < cooldownUntil → skip/delay (no Riot call)
  → else proceed under existing backpressure/budgets
```

### Cost per newly enrolled tracked player (collector path)

Assuming already-resolved `PlayerAccount` (ladder/participant):

| Step | Calls |
| ---- | ----- |
| Soft ranks (`getRankedEntries`) | 1 |
| Match IDs page(s) | `ceil(matchesPerPlayer / 100)` ≈ **1** for 20 |
| Match detail + timeline per **new** match | ≈ **2 × uniqueNewMatches** |

Product search path adds resolve (2) + mastery (1) — **not** required for ladder→collector path if identity complete.

### Dedup effect (dominant savings)

10 ladder players in the same games share matches. Match ingestion cost is **global**:

```text
unique_match_cost ≈ 2 × distinct_new_match_ids
not 2 × players × matches_per_player
```

Dominating cost at scale: **match + timeline fetches**, not ladder list calls.

### Rough realism under personal-key-style limits

Repo tests exemplify headers like `20:1,100:120` — **not an authoritative product limit table**. Treat as planning assumption until ops documents the key class.

If ~100 app requests / 120s and timelines enabled:

- Sustainable unique match ingest ≈ **~25–40 matches / 2 min** when dedicated (optimistic)
- With discovery + product traffic: plan **~500–1500 unique q420 matches / day** as a cautious local/dev pace
- **Tens of thousands** of distinct ranked matches is a multi-day/week goal under personal keys; feasible faster with production keys and disciplined concurrency

### Milestone validation target (architecture-scale, not OP.GG-scale)

| Target | Initial M11 validation band |
| ------ | --------------------------- |
| Tracked players (na1) | 1,000–3,000 |
| Distinct q420 matches (all patches) | 5,000–15,000 |
| Distinct q420 current-patch matches | 2,000–8,000 |
| Champion×position (q420, current patch, collapsed) sample≥30 | materially ≫ 0 (aim dozens→hundreds) |
| Exact ≥100 buckets | stretch; not required for M11 pass |

Hardcode nothing without measuring actual Retry-After / throughput in Phase 5.

### Shared API budget requirements (design)

1. Implement shared cooldown (Phase 3A) before any Phase 5 live population scaling.
2. Propagate Retry-After with configured floor and monotonic extension (§13 M11 TARGET).
3. Keep winner-only BullMQ backpressure; optionally pause ladder enrollment when pending ingest > threshold.
4. Consider enforcing advisory `estimatedRequestsPerEnqueuedMatch` as a soft stop in scheduled runs.
5. Do **not** add a second uncoordinated high-concurrency Riot consumer.
6. Do **not** treat per-job worker delay alone as sufficient shared coordination.

---

## 14. Deduplication / idempotency analysis

### Matches — prerequisite trust (currently strong)

| Check | Status |
| ----- | ------ |
| Unique `Match(provider, externalMatchId)` | Yes |
| Durable job idempotency key | Yes |
| Enqueue skips COMPLETED linked matches | Yes |
| Worker `already_complete` short-circuit | Yes (with PUUID repair exception) |
| Timeline gated / idempotent persist path | Yes (existing worker) |
| Aggregation double-count | Aggregation versions + processing markers; not incremented by duplicate COMPLETED short-circuit |

**Prerequisite verdict:** match idempotency appears trustworthy enough to scale enrollment. Phase 1 should add a focused regression test around multi-player discovery of the same match ID under concurrency before raising caps.

### Players

| Check | Status |
| ----- | ------ |
| Canonical tracked identity | `TrackedPlayer.playerAccountId` unique → `PlayerAccount(provider, externalAccountId)` |
| Ladder duplicate enroll | Must use race-safe ladder reservation TX + unique `playerAccountId` |
| Participant re-enroll | already_tracked + depth min; no quota |
| Search/bootstrap re-enroll | source immutable; depth min to 0 |
| Platform allowlist | Expansion + collector respect allowlist |

**Risks:**

- Ladder DTO without PUUID → resolve-by-name duplicates; require PUUID or canonical resolve before create.
- Nest `upsertEnrollment` read-then-insert is weaker under concurrency than worker expansion reservation; **ladder creates must not inherit that gap**.
- `sourceCollectorRunId` is not part of match idempotency keys — first attribution sticks; acceptable for M11 if expansion remains globally capped when un-attributed.

### Aggregation

Duplicate match jobs must not double-count samples. Existing COMPLETED short-circuit + aggregation processing uniqueness are the guardrails; include an explicit multi-discovery integration assertion in M11 tests.

---

## 15. Database scale analysis

### Expected growth (Phase A validation band)

| Table | Now (local) | At ~3k tracked / ~10k matches (order-of-magnitude) |
| ----- | ----------- | -------------------------------------------------- |
| TrackedPlayer | 5 | ~3k |
| PlayerAccount / Player | 15 | ~3k–10k (participants create accounts too) |
| Match | 106 | ~10k |
| MatchParticipant | ~1.1k | ~100k |
| Timeline payloads | per-match | largest blob growth |
| ChampionAggregate | ~2k | tens–hundreds of thousands of dimension rows (patch×platform×queue×tier×position×champion×versions) |
| Collector audit / quotas | small | grows with runs; ephemeral quotas CASCADE |

### Indexes already helpful

- `Match(provider, externalMatchId)` unique
- `TrackedPlayer` claim eligibility composite index
- `TrackedPlayer(discoveryDepth)`, `(platformRoute, status)`
- `ChampionAggregate` champion/patch/queue indexes
- `PlayerAccount(provider, externalAccountId)` unique

### Risks before scaling

1. **Coverage report queries** scanning `ChampionAggregate` without patch+queue+platform+version filters — always constrain; prefer `rankTier='ALL'` + exact positions for product-shaped metrics.
2. **Timeline / rawPayload storage** dominates disk — keep timeline fetch enabled only if product needs it; budget cost ×2.
3. **CollectorRunSourceQuota** growth — CASCADE cleanup OK; monitor table size under frequent runs.
4. **Status/audit CLIs that load all COMPLETED matches into memory** — fine at hundreds; painful at 10k+; coverage queries must stay aggregate SQL, not full-table hydrate.
5. No sharding needed for M11 targets.

Existing Match indexes already include `(platformRoute, queueId, gameCreation)` and `(normalizedPatch, queueId)`. Prefer `normalizedPatch` for current-patch match counts. Add indexes only if EXPLAIN shows pain (e.g. `sampleSize` filters after wide scans).

---

## 16. Failure / recovery semantics

| Failure | Behavior |
| ------- | -------- |
| Riot 429 | Publish shared `cooldownUntil = now + max(floor, Retry-After)`; stop seeder/collector new work; worker delays/respects shared signal; scheduler integrates with shared cooldown |
| Riot 403/404 | Permanent/skip for that resource; count; continue others when safe |
| Transient network / 5xx | Existing limited retries |
| Invalid player identity | Skip enroll; metric |
| Inactive / removed player | Collector failure backoff → cold |
| Duplicate match | Harmless idempotent complete |
| Worker crash | BullMQ retry + durable job state |
| Scheduler crash | Lease expiry → another owner |
| Stale lease | TTL invariant covers worst-case runOnce |
| Partial ladder page | Enroll parsed subset; report; rerun idempotent |
| DB reservation race | TX rollback; already_tracked path |

Population scaling must remain **restart-safe** and **idempotent**.

---

## 17. Coverage observability

**Already exists:** `CollectorCoverageService` (`apps/api/src/features/collector/collector-coverage.service.ts`), wired into collector status/run paths, plus worker ops CLIs `pnpm aggregates:status-champions` and `pnpm aggregates:audit-rank-coverage`.

M11 work is to **extend** that service / add a focused `collector:coverage` CLI — not invent a parallel coverage stack.

Report additions at minimum:

**Density (primary product)**

- tracked players by source / platform / depth / status (incl. `LADDER`)
- autonomous + ladder + total hard-cap usage
- distinct matches; q420; current-patch q420 via `normalizedPatch` + `resolveLatestSemanticPatch` (global + per platform)
- participant observations
- ChampionAggregate sample distribution
- champion×position counts ≥1 / ≥30 / ≥100 using **product shape**: `rankTier='ALL'`, exact positions, current semantic patch, platform+queue+versions
- classic champions with zero current-patch q420 position data
- stale player counts by activity tier (after Phase 3)
- recent collector throughput (matches enqueued / distinct completed)
- skippedAlreadyComplete / dedup avoidance rate when available from run counters

**Representation health (required review fields where feasible)**

- tracked `LADDER` roots by observed/enrolled rank tier (apex vs Diamond/Emerald/Platinum/Gold)
- recently observed ranked participants by tier (from rank-at-ingestion / snapshots where available)
- current-patch q420 matches / participant observations by tier where data supports it
- champion×position coverage by tier where aggregate shape supports exact `rankTier` rows (not only `ALL`)
- explicit review flag/text: whether new population is essentially apex-only

Do **not** require perfectly proportional Riot ladder demographics. This is a distribution-health check.

Prefer CLI/admin — **not** public UI.

---

## 18. Safety invariants (locked)

1. Task 4 substrate remains; no recursive immediate crawl.
2. Hard caps always exist (total tracked, ladder, participant autonomous, per-run, per-source, per-match window).
3. Scheduler never auto-starts from API/worker boot.
4. Ladder seeder never bypasses ingestion backpressure when it triggers collection.
5. Ranking floor unchanged (30).
6. Queue metrics remain queue-specific (420 primary).
7. First enrollmentSource immutable.
8. No CN platforms.
9. No second ingestion pipeline.

---

## 19. Success criteria

### Architecture

- Apex + (when contract allows) representative-tier LADDER acquisition exists and enrolls through safe paths
- Common `LadderCandidate` normalization for both apex lists and paginated tier pages
- Task 4 bounds still enforced; expansion not used as tier-representation strategy
- **Shared cross-process 429 cooldown** implemented/tested before live scaling
- Backpressure coherent across acquisition + ingest

### Data (na1, queue 420, vs Phase 0 baseline)

- Tracked players: 5 → **≥1000** (validation band)
- Current-patch q420 matches: 2 → **≥2000** (validation band; adjust if key class cannot sustain)
- Collapsed champion×position ≥30 on current patch: 0 → **material increase** (target ≥50 as review gate; stretch ≥200)

### Representation health

- After A2 (or documented contract blocker): new LADDER roots / observations are **not** essentially Challenger/GM/Master-only
- Coverage report shows Diamond/Emerald/Platinum/Gold presence among roots or recent observations where feasible
- Equal per-tier counts **not** required

### Reliability

- No duplicate Match rows for same provider+externalMatchId
- No runaway participant graph (caps bind)
- Scheduler overlap safe
- Backpressure skips under saturated ingest
- Shared 429 cooldown prevents multi-consumer stampede

### Product

- Current champion pages show materially more non-empty / ranked-eligible stats for common champions/positions on na1 current patch

### Live-run gate (Phase 5 blocked unless)

- Shared cooldown task implemented and tested
- Ladder enrollment hard caps work
- Total tracked hard cap works
- Ingestion backpressure works
- Coverage CLI works (density + representation-health fields)
- Apex ladder dry-run is sane

Then: A1 live → healthy → bounded A2 (Diamond→Gold). Do **not** enable Master-at-large-scale + broad lower-tier paging + multiple regions at once.

---

## 20. Rejected alternatives

| Alternative | Why rejected |
| ----------- | ------------ |
| Exhaustive global match crawl | Unbounded cost; contradicts honesty/analytics rules |
| Replace Task 4 with new crawler | Throws away race-safe quotas/leases |
| Champion-targeted acquisition first | Cannot know contribution pre-fetch; optimizer theater |
| **Apex-only M11 completion** | Participant expansion cannot diversify tiers; Master+-bias fails representation health |
| Relying on expansion for Diamond→Gold mix | High-MMR roots → high-MMR neighbors |
| Immediate depth→3 and window→9 | Explosion risk before ladder roots + observability |
| All regions in Phase A | Multiplies cost/failure surface |
| Seeder directly floods match queue | Bypasses collector budgets/backpressure |
| Lower ranking floor to “look denser” | Hides sparsity; product dishonesty |
| Flex 440 mixed into 420 targets | Incompatible queues |
| Public crawl UI | Out of scope; ops CLI only |
| Full proactive token-bucket in M11 | Out of scope unless already natural; shared 429 cooldown is the M11 bar |

---

## 21. Phased implementation (summary)

| Phase | Intent |
| ----- | ------ |
| 0 | Audit + baseline + design + plan (**approved — amended**) |
| 1 | Provider: apex league-list **and** paginated tier/division entries (if docs confirm); common candidate shape; answer PUUID N+1 question |
| 2 | `LADDER` enrollment + budgets/ceilings + seeder CLI (apex first; architecture supports bounded lower-tier pages) |
| 3 | Refresh prioritization (hot/warm/cold) |
| **3A** | **Shared Riot cooldown / Retry-After coordination (required before Phase 5)** |
| 4 | Coverage observability (density + representation health) |
| 5 | Controlled real-data na1 run: A1 apex proof ✅ → bounded A2 Diamond→Gold (deferred) |
| 6 | Coverage validation, regressions ✅; commit (when asked) |

Detailed tasks live in the plan document.

---

## 22. Open questions

### Resolved in Phase 1 (external Riot contract)

1. **Apex league-list DTO identity:** `puuid` yes; Riot ID fields **absent** on current official DTO.
2. **Paginated league-entry contract:** `GET /lol/league/v4/entries/{queue}/{tier}/{division}?page=` — Diamond→Gold pages include `puuid` without N+1; Riot ID still absent.
3. **PUUID N+1 for candidate formation:** **not required** — both families supply `puuid`.
4. **`accounts/by-puuid` in Phase 1:** **not added** — not needed for ladder candidate normalization; **required as Phase 2 enrollment prerequisite** (or skip-incomplete) because `PlayerAccount` needs gameName/tagLine.

### Still open (later phases)

1. **Live key class / documented Riot app limits** for this environment (personal vs production)? Needed to finalize numeric daily targets.
2. **Phase 2 Riot ID policy:** bounded `accounts/by-puuid` resolve vs skip-incomplete (and per-run resolve cap).
3. **Timeline fetch at scale:** keep enabled or temporarily disable during population ramp?
4. **Existing `kr` matches in local DB** — retain (yes) but exclude from na1 success metrics (yes). Any platformRoute null cleanup needed?
5. **`LADDER` priority boost** vs product-search roots? Recommendation: yes, configurable.
6. **Master list size / A2 page budgets:** finalize numeric per-run caps after dry-runs.
7. **Phase 0 vs product baseline drift:** re-run coverage via `CollectorCoverageService` / semantic patch before Phase 5 success.

---

## 23. Recommendation

**Phase 6 validation complete (2026-08-10).** Architecture + A1 live proof are validated; regressions green; stop for review before commit.

Do **not** start continuous crawling or A2 until Riot API key auth is restored and failed ingest jobs are handled. Full product representation health (Diamond→Gold) remains an A2 follow-up — do not document A1-only density as ranking-floor success.

Historical design-gate note (Phase 0): amendments A (representative tiers) and B (shared cooldown) remain locked.
