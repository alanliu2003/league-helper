# Milestone 11 — Population Coverage Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale ranked Solo/Duo population acquisition (na1-first) via apex + representative-tier ladder seeding, shared Riot 429 cooldown, safe enrollment ceilings, activity-aware refresh, and coverage observability — without replacing Task 4 safety controls or building matchup UI.

**Architecture:** Add Riot provider methods for apex league-lists **and** paginated tier/division entries (if Riot contract confirms), normalize both to `LadderCandidate`, and enroll via a bounded Nest CLI seeder (`enrollmentSource=LADDER`, depth 0) under ladder/total caps. Existing `PopulationCollectorService.runOnce` + scheduler + match-ingestion + optional Task 4 expansion remain the only match-acquisition path. Add shared cross-process cooldown, hot/warm/cold refresh, and extend `CollectorCoverageService` for density + representation health. Validate with controlled live na1 runs: A1 apex proof → A2 Diamond→Gold.

**Tech Stack:** TypeScript, Nest CLI application context, Prisma/PostgreSQL, Redis/BullMQ, Zod, Vitest, existing `@league-helper/server-riot` provider

**Spec:** `docs/superpowers/specs/2026-08-07-population-coverage-scaling-design.md` (**approved — amended after design review**)

**Base commit:** `f2dd61e` (Milestone 10 merged)

**Plan decisions (locked from Phase 0 design + review amendments):**

1. Task 4 safety substrate is preserved, not replaced.
2. Primary acquisition = LADDER roots: **A1 apex** (Challenger+GM) then **A2 representative tiers** (Diamond→Gold); expansion = secondary amplifier only (not tier representation).
3. Phase A regional scope = **na1**; queue success metrics = **420** only.
4. Add `TrackedPlayerEnrollmentSource.LADDER` (immutable first-source rules unchanged).
5. Ladder enrollment does **not** consume `CollectorPopulationBudget` (MATCH_PARTICIPANT-only); uses ladder + total hard caps.
6. Ladder seeder enrolls players; does not bypass collector budgets to flood ingest.
7. Ranking floor stays 30.
8. Matchup/counter UI is out of scope.
9. **Shared cross-process Riot 429 cooldown is required before Phase 5 live scaling** (Phase 3A).
10. M11 must not complete as apex-only when paginated league entries are available.
11. Do **not** commit unless the user explicitly asks.
12. Stop for review after Phase 1, 2, 3, 3A, 4, and before/after Phase 5 live run.

---



## File structure



### Create

```text
packages/server-riot/src/
  riot-league-ladder.ts                    # path builders + mapping helpers (optional split)
  riot-league-ladder.test.ts
  # or methods directly on riot-game-data.provider.ts + focused tests

apps/api/prisma/migrations/<timestamp>_milestone_11_ladder_enrollment/
  migration.sql                            # enum value LADDER + optional budget tables/columns

apps/api/src/features/collector/
  ladder/
    ladder-candidate.ts                    # common LadderCandidate shape (apex + tier pages)
    ladder-seed.config.ts
    ladder-seed.service.ts
    ladder-seed.service.test.ts
    ladder-enrollment.budget.ts            # race-safe ladder/total cap reservations
    ladder-enrollment.budget.test.ts
    cli/ladder-seed.ts
  cli/coverage.ts                          # focused coverage CLI; may thin-wrap status
  collector-refresh-policy.ts              # hot/warm/cold nextEligibleAt/priority
  collector-refresh-policy.test.ts
  riot-shared-cooldown.ts                  # shared cooldownUntil read/write (or packages/)
  riot-shared-cooldown.test.ts

apps/worker/src/riot/                      # or equivalent existing worker config path
  riot-shared-cooldown.ts                  # shared module import if hoisted to package

docs/operations/population-coverage.md     # ops knobs + runbook (only if repo already has ops docs pattern)
```



### Modify

```text
apps/api/prisma/schema.prisma
packages/shared/src/provider.ts            # optional ladder methods on GameDataProvider — OR keep ladder off the generic interface if only collector uses it
packages/server-riot/src/riot-game-data.provider.ts
packages/server-riot/src/riot-api.schemas.ts
packages/server-riot/src/mock-riot-game-data.provider.ts
packages/server-riot/src/riot-api.client.ts # publish shared cooldown on 429 if natural
apps/api/src/features/collector/collector.config.ts
apps/api/src/features/collector/collector.config.test.ts
apps/api/src/features/collector/collector.types.ts
apps/api/src/features/collector/collector-enrollment.service.ts
apps/api/src/features/collector/collector-enrollment.service.test.ts
apps/api/src/features/collector/population-collector.service.ts
apps/api/src/features/collector/collector-scheduler.service.ts  # integrate shared cooldown
apps/api/src/features/collector/collector-coverage.service.ts   # EXTEND existing — do not recreate
apps/api/src/features/collector/collector-coverage.service.test.ts
apps/api/src/features/collector/collector-status.service.ts
apps/api/src/features/collector/collector-audit.service.ts
apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts  # respect/publish shared cooldown
apps/api/package.json                      # scripts: collector:ladder-seed, collector:coverage
.env.example
```



### Likely leave unchanged (reuse)

```text
apps/worker/src/collector/participant-expansion.*
apps/api/src/features/players/bootstrap/enqueue-discovered-matches.ts
```

---



## Phase 0 — Audit + baseline + design ✅

- [x] Verify master includes Milestone 10 merge
- [x] Create branch `milestone-11-population-coverage-scaling`
- [x] Read Task 3/4 specs and collector/worker code
- [x] Provider capability audit (no ladder methods today)
- [x] Rate-limit / cost audit
- [x] Local DB coverage baseline recorded in design spec
- [x] Write design + this plan
- [x] Incorporate late read-only audit corrections (provider gaps, existing `CollectorCoverageService`, semantic patch, Nest enroll race surface)
- [x] Design-review amendments: representative-tier acquisition + shared cooldown Phase 3A
- [x] **Review stop:** Phase 0 approved with amendments — proceed to Phase 1 after this doc pass is accepted

---



## Phase 1 — Provider ladder support (apex + paginated tiers) ✅

**Review stop after this phase.**

### Task 1: Confirm Riot ladder contracts (BOTH families)

**Files:**

- Read: Riot developer docs (external)
- Modify: `docs/superpowers/specs/2026-08-07-population-coverage-scaling-design.md` only if DTO facts change

- [x] **Step 1: Document verified endpoint paths and identity fields for A and B**

Verified against official Riot `league-v4` docs (2026-08-10):

**A — Apex league-list**

- `GET /lol/league/v4/challengerleagues/by-queue/{queue}`
- `GET /lol/league/v4/grandmasterleagues/by-queue/{queue}`
- `GET /lol/league/v4/masterleagues/by-queue/{queue}`
- queue type: `RANKED_SOLO_5x5` (string path param; not numeric 420)
- response: `LeagueListDTO` → `LeagueItemDTO[]` with `puuid`; **no** riotId fields; **no** summonerId on current DTO

**B — Paginated league entries (required verification for A2)**

- `GET /lol/league/v4/entries/{queue}/{tier}/{division}?page=`
- queue / tier (`DIAMOND`…`IRON`) / division (`I`…`IV`) / page (default 1)
- response: `LeagueEntryDTO[]` with `puuid`; **no** riotId fields
- empty page = operational exhaustion signal (page size undocumented)

- [x] **Step 2: Explicitly answer the Phase 1 review question in the Phase 1 report**

> Can Riot league-v4 provide canonical PUUID-based candidates for both apex ladders and bounded lower-tier pages without expensive identity-resolution N+1 calls?

**YES for PUUID.** Riot ID fields are absent → Phase 2 needs bounded `accounts/by-puuid` (or skip) for `PlayerAccount` persistence; **not** added in Phase 1.

- [x] **Step 3: Write failing Zod schema tests for league-list and paginated-entry DTOs**

- [x] **Step 4: Implement schemas + provider methods + mock provider**

Implemented on `RiotGameDataProvider` / `MockRiotGameDataProvider` (**not** on shared `GameDataProvider` — ladder is collector-acquisition-specific):

- `getChallengerLeague(platform, leagueQueueType)`
- `getGrandmasterLeague(platform, leagueQueueType)`
- `getMasterLeague(platform, leagueQueueType)`
- `getLeagueEntriesByTierDivision(platform, leagueQueueType, tier, division, page)`

- [x] **Step 5: Normalize both shapes into a shared** `LadderCandidate` **mapper (unit-tested)**
- [x] **Step 6: Unit-test provider URL construction and mapping for apex + paginated paths**
- [x] **Step 7: Run package tests**

```bash
pnpm --filter @league-helper/server-riot test
pnpm --filter @league-helper/shared test
```

**Checkpoint:** Provider returns normalized `LadderCandidate`s for apex and tier pages in tests/mocks. No DB enrollment yet. Phase 1 review answers the PUUID/N+1 question.

---



## Phase 2 — Safe ladder enrollment + quotas ✅

**Review stop after this phase.**

### Task 2: Schema + config ceilings

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: migration
- Modify: `collector.config.ts` (+ tests), `.env.example`

- [x] **Step 1: Add enum value** `LADDER`
- [x] **Step 2: Add config knobs with hard caps**

Suggested:

- `COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP` (default 5000, hard max 50000)
- `COLLECTOR_LADDER_MAX_TOTAL` (default 3000, hard max 20000)
- `COLLECTOR_LADDER_MAX_NEW_PER_RUN` (default 100, hard max 1000)
- `COLLECTOR_LADDER_PLATFORM` / reuse allowlist
- `COLLECTOR_LADDER_QUEUE_TYPE` = ranked solo
- `COLLECTOR_LADDER_TIERS` = `CHALLENGER,GRANDMASTER` for A1 default
- `COLLECTOR_LADDER_REPRESENTATIVE_TIERS` = `DIAMOND,EMERALD,PLATINUM,GOLD` (A2; enabled later)
- `COLLECTOR_LADDER_MAX_PAGES_PER_TIER_DIVISION` / per-run page caps for A2 (hard-capped)
- Master opt-in under separate explicit flag/cap — not default A1

- [x] **Step 3: Migration for any ladder budget singleton if using counter reservation**

Prefer race-safe counter(s) analogous to `CollectorPopulationBudget` rather than COUNT+insert.

- [x] **Step 4: Config validation tests (reject capless / inverted bounds)**



### Task 3: Enrollment path

**Files:**

- Modify: `collector-enrollment.service.ts` (+ tests)
- Create: `ladder-enrollment.budget.ts` (+ tests)

- [x] **Step 1: Failing tests — LADDER create depth 0, source immutability, cap stops**
- [x] **Step 2: Implement enroll-from-ladder candidate with reservation TX**

Rules:

- platform ∈ allowlist
- require PUUID
- riotId present → upsert without Account-v1
- riotId missing → skip or bounded resolve (config); never unbounded N+1
- `enrollmentSource=LADDER` on create only
- re-enroll preserves source; `discoveryDepth = min(existing, 0)`
- consume ladder/total caps only on **new** creates
- **Do not** rely on Nest `upsertEnrollment` read-then-insert alone — mirror Task 4 style: atomic counter reservation + insert in one TX; unique conflict → rollback → already_tracked

- [x] **Step 3: Integration test for concurrent enroll race (real PG)**

Two parallel creates for different PUUIDs near cap must not exceed cap; duplicate PUUID must not double-count.

### Task 4: Ladder seed CLI

**Files:**

- Create: `ladder-seed.service.ts`, `cli/ladder-seed.ts`, `ladder-candidate.ts`
- Modify: `apps/api/package.json`

- [x] **Step 1: Service orchestration tests (mock provider) for apex mode**
- [x] **Step 2: Implement CLI with apex-first UX; architecture accepts bounded lower-tier mode**

```bash
# A1 — prove acquisition (default path)
pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers CHALLENGER,GRANDMASTER --dry-run
pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers CHALLENGER,GRANDMASTER

# A2 — architecture wired; live use deferred until Phase 5 after apex proof
pnpm collector:ladder-seed -- --platform na1 --mode representative \
  --tiers DIAMOND,EMERALD,PLATINUM,GOLD --max-pages-per-division 1 --dry-run
```

Must print: mode, tiers, fetched, eligible, created, alreadyTracked, skippedIdentity, skippedCap, byTier, errors.

- [x] **Step 3: Ensure seeder does not enqueue match jobs directly**

- [x] **Step 4: Unit tests that representative mode uses same enrollment/cap path as apex (mocked pages)**

- [x] **Step 5: Run collector unit/integration tests**

```bash
pnpm --filter @league-helper/api test -- collector
```

**Checkpoint:** Can enroll bounded apex ladder roots into TrackedPlayer without touching ingest queues. Representative-tier path exists in code/CLI architecture but is not live-crawled yet.

---



## Phase 3 — Refresh prioritization ✅

**Review stop after this phase.**

### Task 5: Hot / warm / cold policy

**Files:**

- Create: `collector-refresh-policy.ts` (+ tests)
- Modify: `population-collector.service.ts` finalize success path
- Modify: `collector.config.ts` intervals

- [x] **Step 1: Write pure policy tests**

Inputs: previous tier/priority, `enqueuedNewCount`, `consecutiveZeroNewMatchRuns`, failure flag.
Outputs: next `priority`, `nextEligibleAt` delta.

- [x] **Step 2: Wire into successful discovery finalize**

- Hot: enqueued ≥1 new match → boost priority, shorter interval
- Warm: success with 0 new → default
- Cold: N consecutive zero-new → lower priority, longer interval
- Keep existing failure backoff path

- [x] **Step 3: Ensure claim SQL order still uses priority/nextEligibleAt (no new indexes required initially)**
- [x] **Step 4: Unit tests for population collector finalize interactions**

**Checkpoint:** Inactive players naturally slow down; active producers stay hot.

---



## Phase 3A — Shared Riot cooldown / Retry-After coordination ✅

**Required before Phase 5 live population scaling. Review stop after this phase.**

### Task 5A: Shared cross-process cooldown

**Files:**

- Create: shared cooldown module (api/worker/package — prefer one shared implementation)
- Modify: Riot client or call-site 429 handlers; `collector-scheduler.service.ts`; ladder seeder; match-ingestion processor
- Modify: `.env.example` (`RIOT_SHARED_COOLDOWN_MIN_MS` or reuse scheduler floor)

- [x] **Step 1: Write failing tests for cooldown semantics**

Required cases:

- Riot 429 with Retry-After publishes shared `cooldownUntil`
- configured floor wins when Retry-After is shorter
- observed Retry-After wins when longer
- ladder seeder skips/stops while cooldown active
- collector scheduler skips acquisition while cooldown active
- worker respects compatible cooldown behavior (delay/skip new Riot work)
- one consumer's 429 suppresses another consumer
- cooldown expiry allows work again
- concurrent updates cannot shorten an existing later cooldown (monotonic max)

- [x] **Step 2: Implement shared store**

Prefer existing Redis if natural for api+worker; else DB singleton. Persist `cooldownUntil`. Writes use monotonic `max(existing, new)`.

- [x] **Step 3: Wire publishers** — on 429: `cooldownUntil = now + max(floor, retryAfter)`

Consumers at minimum: ladder seeder, population collector / scheduler, match-ingestion worker.

- [x] **Step 4: Integrate scheduler-local cooldown with shared signal** (do not compete/ignore)

- [x] **Step 5: Run unit/integration tests for cooldown module + scheduler/seeder gates**

**Checkpoint:** Multi-consumer 429 cannot stampede; Phase 5 preflight may proceed only after this is green.

---



## Phase 4 — Coverage observability + scaling controls ✅

**Review stop after this phase.**

### Task 6: Coverage report CLI

**Files:**

- Modify: `collector-coverage.service.ts` (+ existing tests)
- Create: `cli/coverage.ts` (optional dedicated entry; may extend status output)
- Modify: `package.json`, optionally `collector-status.service.ts` / audit

- [x] **Step 1: Extend existing** `CollectorCoverageService` **DTO for design §17 gaps** (LADDER/caps/activity tiers/classic-zero/representation) — do not create a second coverage service
- [x] **Step 2: Align density metrics with product shape**

Must include:

- tracked by source/platform/depth (incl. LADDER)
- cap usage (participant / ladder / total)
- matches q420 / current-patch q420 via `normalizedPatch` + `resolveLatestSemanticPatch`
- champion×position ≥1/≥30/≥100 with `rankTier='ALL'`, exact positions, versions
- classic champions with zero current-patch q420 position data
- sample distribution histogram
- Re-baseline Phase 0 numbers with this path before Phase 5 go/no-go

- [x] **Step 3: Add representation-health fields where feasible**

- LADDER roots by rank tier
- recent ranked participants / observations by tier
- current-patch q420 matches/participants by tier where data supports
- champion×position by exact tier where aggregate shape supports
- apex-only warning / review flag text

- [x] **Step 4: CLI output stable for ops paste**

```bash
pnpm collector:coverage -- --platform na1 --queue 420
# also reuse where useful:
pnpm aggregates:status-champions
pnpm aggregates:audit-rank-coverage
```

- [x] **Step 5: Audit findings for ladder/total hard-cap drift (if counters used)**

Coverage reports live TrackedPlayer counts for cap usage; hard-cap drift remains an audit concern (`collector:audit`), not a coverage mutation.

- [x] **Step 6: Document env knobs in** `.env.example` **(+ short ops notes if appropriate)**

No new env knobs; density thresholds reuse product semantics (`CHAMPION_AGGREGATION_MIN_SAMPLE` ranking floor + fixed ≥1/≥30/≥100 observability buckets). Existing M11 collector env already documented in prior phases.

**Checkpoint:** Operators can measure density + representation health without public UI.

---



## Phase 5 — Controlled real-data population run ✅ (A1 only; A2 deferred)

**Review stop before starting and after metrics.**

### Task 7: Preflight (HARD GATE — do not start live crawl unless all pass)

- [x] **Step 1: Confirm Phase 3A shared cooldown implemented + tests green**

- [x] **Step 2: Confirm ladder enrollment hard caps + total tracked hard cap tests green**

- [x] **Step 3: Confirm ingestion backpressure behavior still correct**

- [x] **Step 4: Confirm coverage CLI works (density + representation fields)**

- [x] **Step 5: Capture baseline via** `collector:coverage` **(na1, q420)**

Record: tracked, current-patch matches, ≥1/≥30/≥100 buckets, ladder-by-tier (expect empty/near-empty).

Baseline (before A1): tracked=5, LADDER=0, gte1=19, gte30=0, current-patch q420=2.

- [x] **Step 6: Confirm config (A1 only at start)**

Live profile used (more cautious than the suggested defaults):

```text
COLLECTOR_PLATFORM_ALLOWLIST=na1
COLLECTOR_SCHEDULE_QUEUE_ID=420
COLLECTOR_EXPAND_FROM_PARTICIPANTS=false   # off for A1 proof
COLLECTOR_LADDER_MAX_NEW_PER_RUN=25
COLLECTOR_LADDER_MAX_TOTAL=1500
COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP=2000
COLLECTOR_SCHEDULER_ENABLED=false
# representative mode OFF; Master not enabled
```

- [x] **Step 7: Apex ladder dry-run is sane**

```bash
pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers CHALLENGER,GRANDMASTER --dry-run
```

Dry-run: fetched=1020, created=0, stoppedReason=scan_ceiling.



### Task 8: Bounded live run — Phase A1 (apex proof)

- [x] **Step 1: Ladder seed Challenger (+ GM if dry-run counts sane)**

Created 25 LADDER roots (depth 0); `stoppedReason=create_cap`. Total tracked 30.

- [x] **Step 2: Run manual** `collector:run` **waves or enable scheduler briefly**

Wave 1 drained cleanly (+40 completed). Wave 2 hit Riot **401 auth** mid-run; stopped; no further waves; scheduler stayed off.

- [x] **Step 3: Re-run coverage; confirm pipeline health before A2**

A1 pipeline proof succeeded (coverage improved). **No-go for A2** until Riot key auth is healthy and failed ingest jobs are handled.

Do **not** yet enable: Master-at-large-scale, broad lower-tier paging, multiple regions.

### Task 8B: Bounded live run — Phase A2 (representative tiers) — DEFERRED

Only after A1 healthy and Phase 1 confirmed paginated entries + PUUID viability.

Architecture/tests for representative mode exist; **live A2 not started** in this milestone pass (auth ops gate + Phase 6 validation scope).

- [ ] **Step 1: Dry-run representative mode**

```bash
pnpm collector:ladder-seed -- --platform na1 --mode representative \
  --tiers DIAMOND,EMERALD,PLATINUM,GOLD --max-pages-per-division 1 --dry-run
```

- [ ] **Step 2: Bounded live enroll (small per-run caps; one platform)**

- [ ] **Step 3: Collector waves; re-run coverage**

Success signals (flexible to key class):

- tracked ≫ baseline (toward ≥1000 if key allows)
- current-patch na1 q420 matches ≫ 2
- champion×position ≥30 buckets materially > 0
- representation health: new population is **not** essentially apex-only (unless documented contract/key blocker)

**Do not** declare success from queue job counts alone.
**Do not** declare full M11 product completion on A1-only density if A2 remains feasible — A2 is follow-up after key health restore.

---



## Phase 6 — Validation / regression / commit gate ✅ (validation complete; commit pending user ask)



### Task 9: Automated regressions

- [x] Provider ladder tests green (apex + paginated if implemented)
- [x] Enrollment immutability + cap race tests green
- [x] Refresh policy tests green
- [x] Shared cooldown tests green
- [x] Coverage service tests green (density + representation)
- [x] Existing collector scheduler/expansion tests still green
- [x] Optional: multi-player same-match ingest idempotency assertion

Verified 2026-08-10 (Phase 6 gate):

| Command | Result |
| ------- | ------ |
| `pnpm --filter @league-helper/server-riot test` | 10 files / 72 tests passed |
| `pnpm --filter @league-helper/api test -- collector` | 19 files / 283 tests passed |
| `pnpm --filter @league-helper/worker test -- participant-expansion` | 6 files / 27 tests passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |
| `pnpm build` | passed |

```bash
pnpm --filter @league-helper/server-riot test
pnpm --filter @league-helper/api test -- collector
pnpm --filter @league-helper/worker test -- participant-expansion
pnpm lint
pnpm typecheck
pnpm build
```

### Phase 6 live-state validation (read-only; no new waves)

`collector:coverage --platform na1 --queue 420` (2026-08-10):

| Metric | Phase 0 / before A1 | After A1 / Phase 6 |
| ------ | ------------------- | ------------------ |
| tracked players | 5 | **30** |
| LADDER | 0 | **25** (all depth 0) |
| MATCH_PARTICIPANT | 3 | **3** (secondary; unchanged) |
| coverage ≥1 | 19 | **161** |
| coverage ≥30 | 0 | **0** |
| coverage ≥100 | 0 | **0** |
| classic-zero | 154 / 173 | **51 / 173** |
| current-patch q420 matches | 2 | **31** |
| ranking floor | 30 | **30** (unchanged) |
| ingest completed / failed | — | **200 / 41** (failed includes wave-2 auth) |

**A1 success:** ladder enrollment → collector → ingest → aggregate path proved; champion coverage density improved materially.

**Remaining limitation:** No champion-position bucket reached ranking floor ≥30 yet; requires continuous population growth.

**Known Phase 5 follow-ups (not blockers for this commit gate):**

1. Riot API auth degraded mid wave 2 (ops/env `RIOT_API_KEY`) — expected failure mode under bad key; refresh key before more live waves.
2. 23 / 25 LADDER players missing `RankSnapshot` + `neverSuccessfulRefresh=23` — expected after auth failure cut refresh short; not a code regression.
3. Failed ingestion jobs (41) — mostly wave-2 auth; retry only after key health restored.
4. Live A2 representative-tier expansion — deferred; architecture present, not executed.

### Task 10: Commit (only when user asks)

- [ ] Summarize files changed + before/after coverage numbers (density + representation) in commit message body
- [ ] Do not commit secrets, local DB dumps, API keys, diagnostic scripts, or generated/runtime artifacts
- [ ] Stop for review before commit (Phase 6 validation complete 2026-08-10)

---



## Tests per phase (summary)


| Phase  | Tests                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1      | Zod apex + paginated DTOs; provider URL/mapping; `LadderCandidate` mapper; mock provider                               |
| 2      | Config hard caps; LADDER enroll; immutability; concurrent cap reservation (PG); CLI apex + representative architecture |
| 3      | Pure refresh policy; collector finalize wiring                                                                         |
| **3A** | **Shared cooldown publish/read/monotonicity; seeder/scheduler/worker gates; floor vs Retry-After**                     |
| 4      | Coverage aggregations (density + representation); CLI formatting smoke                                                 |
| 5      | Manual live validation checklist A1 then A2 (not CI)                                                                   |
| 6      | Full relevant suite + lint/typecheck                                                                                   |


---



## Controlled real-data validation checklist

Copy into run notes:

```text
Date / key class:
Platform: na1
Queue: 420
Patch: (semantic)

Preflight gates:
- sharedCooldownTests=
- ladderCaps=
- totalHardCap=
- backpressure=
- coverageCli=
- apexDryRun=

Before:
- trackedTotal=
- bySource=
- ladderByTier=
- q420Matches=
- currentPatchQ420=
- cp_ge1/ge30/ge100=
- classicZero=

A1 apex seed:
- tiers=
- created=
- alreadyTracked=
- skippedCap=

After A1 waves:
- trackedTotal=
- currentPatchQ420=
- cp_ge1/ge30/ge100=
- pendingIngest peak=
- sharedCooldown events=
- backpressure skips=
- duplicate match anomalies (expect 0)=
- representation still apex-heavy? (expected yes before A2)

A2 representative seed:
- tiers=
- pagesPerDivision=
- createdByTier=
- skippedCap=

After A2 waves:
- ladderByTier=
- observationsByTier=
- apexOnlyReview=
- cp_ge1/ge30/ge100=
```

---



## Review stopping points

1. After Phase 0 docs + amendments (now)
2. After Phase 1 provider (must answer PUUID/N+1 for apex **and** paginated tiers)
3. After Phase 2 enrollment/seeder
4. After Phase 3 refresh policy
5. After Phase 3A shared cooldown
6. After Phase 4 coverage CLI
7. Before Phase 5 live run (hard preflight gates)
8. After Phase 5 A1 metrics (go/no-go for A2)
9. After Phase 5 A2 metrics (go/no-go for Master / larger caps)
10. Before commit

---



## Out of scope reminders

- MatchupAggregate public API / Strong-Weak UI
- All-region crawl
- Removing hard caps
- Lowering ranking floor
- CN support
- Recursive crawl
- Full proactive token-bucket rate allocator (unless already natural)
- Relying on MATCH_PARTICIPANT expansion for Diamond→Gold representation
