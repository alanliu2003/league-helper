# Milestone 12 Design (v2): Continuous Representative Population Operations

**Date:** 2026-08-10  
**Status:** Phase 0 — design / plan review (M12-v2 restart; no production code)  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Base:** `395d251` — Milestone 11 (`feat(collector): scale population coverage via ladder acquisition (M11)`)  
**Depends on:** Milestone 11 (`docs/superpowers/specs/2026-08-07-population-coverage-scaling-design.md`)  
**Plan:** `docs/superpowers/plans/2026-08-10-continuous-population-operations.md`  
**Abandoned attempt archive:** `archive/m12-first-attempt` @ `a48cb23` (evidence only; not an implementation baseline)

---

## 0. Restart posture

### 0.1 Why M12-v2 exists

The first Milestone 12 attempt is **abandoned**. It is preserved only as:

- git archive branch `archive/m12-first-attempt`
- prior experimental findings (ops evidence)
- lessons about rank correctness and aggregation convergence

M12-v2 **restarts from M11 code** (`395d251`). It must **not**:

- cherry-pick abandoned production code wholesale
- silently depend on abandoned Prisma migration `20260810160000_participant_rank_enrichment`
- treat abandoned DB schema/data as the clean development baseline
- resume population scaling before rank attribution is correct

### 0.2 Product goal (unchanged intent, corrected dependency)

Build a **sustainable, bounded** system that continuously collects enough ranked Solo/Duo data to provide useful champion statistics representing the **real player population** — not only Challenger / Master+.

Target product outcomes (multi-week, not a single run):

- Meaningful sample sizes on champion pages (many champion×position buckets ≥30, growing toward ≥100)
- **Honest** rank-aware statistics (exact-tier views over participant-attributed ranks)
- Regional statistics (na1-first; multi-platform later under caps)
- Representative tracked population across apex → low tiers

### 0.3 Critical framing

**Continuous operations does NOT mean maximum always-on crawling.**

It means:

- controlled recurring operations
- bounded enrollment waves
- bounded refresh cycles
- measurable growth
- **rank-correct statistics before volume scaling**

Success is **not**:

- Infinite crawling
- High-elo-only analytics
- Brute-force Riot API usage
- Maximizing tracked-player count alone
- Assuming production-scale throughput on a developer key
- Rank filters that silently drop unresolved participants from `ALL`
- Treating Challenger-only apex roots as “Apex represented”

Success is:

> A continuous operations loop that first attributes participant rank correctly, then enrolls and refreshes a **capped, fair, representation-aware** population under shared Riot backpressure — measured by rank-resolution quality, coverage density, coverage velocity, unique match yield, and rank representation.

---

## 1. Locked product semantic: participant rank attribution

### 1.1 Non-negotiable rule

For ranked champion statistics, the rank bucket must represent the **actual participant** whose champion performance is being counted.

If Riot can determine that participant’s rank, the sample **MUST** be attributed to that rank.

It **MUST NOT** remain unresolved / unknown merely because:

- the participant is not a `TrackedPlayer`
- the participant is not a `PlayerAccount` product root
- the participant was discovered as a co-participant
- the match came from another tracked player’s crawl

### 1.2 Separation of concerns (mandatory)

M12-v2 explicitly separates three planes:

| Plane | Purpose | Must not be conflated with |
| ----- | ------- | -------------------------- |
| **1. Match / statistics eligibility** | Whether a `MatchParticipant` contributes to champion aggregates at all (`ALL`, exact position, patch/platform/queue filters) | Rank resolution state |
| **2. Participant-rank resolution** | Resolving that participant’s Solo/Duo rank via League-v4 by PUUID (+ durable observation/cache) | TrackedPlayer enrollment |
| **3. Population acquisition** | Enrolling `TrackedPlayer` roots for continuous match discovery | Rank attribution completeness |

`TrackedPlayer` is for **population acquisition**.

`TrackedPlayer` must **not** be required for **participant rank attribution**.

### 1.3 ALL / exact / UNKNOWN / unresolved contract

| Bucket / state | Meaning | Counted in `ALL`? | Counted in exact tier? | Counted in product `UNKNOWN`? |
| -------------- | ------- | ----------------- | ---------------------- | ----------------------------- |
| **ALL** | All otherwise eligible source-backed participant samples | Yes (definition) | N/A | N/A |
| **Exact tier** (e.g. DIAMOND) | Participant rank successfully resolved to that tier | Yes | Yes | No |
| **UNKNOWN / UNRANKED** | Riot rank lookup **completed successfully** and returned **no applicable ranked entry** (`RESOLVED_UNRANKED`) | Yes | No | Yes |
| **PERMANENT_UNAVAILABLE** (`FAILED_PERMANENT`) | Documented permanent technical/data gap (e.g. missing PUUID) — rank could not be resolved through the normal path; **not** proof of unranked | Yes | No | **No** |
| **UNRESOLVED** (`PENDING`) | Rank lookup has not completed yet | Yes | No | No |
| **FAILED_RETRYABLE** | Lookup temporarily failed / rate limited | Yes | No | No |

Locked product distinction:

```text
UNKNOWN            = successfully resolved as having no applicable rank
PERMANENT_UNAVAILABLE = rank could not be resolved for a documented permanent technical/data reason
```

They are **not** the same product bucket. Do not silently mix technical data-quality failures with actual unranked players.

Mandatory invariant:

```text
ALL = all otherwise eligible source-backed participant samples
```

Rank resolution **MUST NEVER** determine whether a participant exists in `ALL`.

Also mandatory:

- `UNRESOLVED`, `FAILED_RETRYABLE`, and `FAILED_PERMANENT` **MUST NOT** silently become `UNKNOWN`
- During asynchronous enrichment, it is **expected and correct** that:

```text
ALL >= sum(exact tiers + UNKNOWN/UNRANKED)
```

The difference includes unresolved / retryable samples **and** permanent-unavailable samples (which remain in ALL but outside exact and UNKNOWN).

Do **not** enforce:

```text
ALL == exact tiers + UNKNOWN
```

until `rankResolutionCoverage` is effectively 100% (subject to legitimate permanent gaps that remain outside UNKNOWN).

### 1.4 Canonical example (locked)

Suppose Camille SUPPORT has 27 valid source participants:

- 2 ranks successfully resolved: Challenger = 1, Grandmaster = 1
- 25 rank lookups still pending

Correct:

- `ALL = 27`
- `CHALLENGER = 1`
- `GRANDMASTER = 1`
- `UNKNOWN = 0`
- unresolved diagnostic = 25

Incorrect:

- `ALL = 2` (rank resolution gated eligibility)
- `ALL = 27` and `UNKNOWN = 25` before those lookups finalize as genuinely unranked

### 1.5 Historical rank honesty

Do **not** claim Riot League-v4 gives exact historical match-time rank unless evidence proves it.

Honest product wording:

> Rank observed during the ingestion / enrichment cycle

Acceptable for rank-aware product stats if documented.

Do **not** call it historical MMR / ELO.

---

## 2. Lessons from the abandoned first attempt

These are **prior experimental findings**, not current branch state. M12-v2 code starts from M11 and must re-implement only what the new design requires.

### 2.1 What worked operationally

1. Developer-key operation was healthy under conservative settings.
2. Scheduler observation run was stable.
3. Representative ladder candidates are abundant.
4. Diamond / Emerald / Platinum bounded waves produced strong unique-match yield.
5. Shared 429 cooldown worked correctly.
6. Queue / backpressure remained healthy.
7. Population must eventually include lower tiers; Gold / Silver / Bronze / Iron remain required.

### 2.2 What failed product-semantically

1. Population acquisition can produce lots of match data while most co-participant ranks remain unresolved.
2. That yields misleading rank-filtered champion stats if unresolved samples are dropped from `ALL` or dumped into `UNKNOWN`.
3. Aggregation convergence issues appeared: stale UNKNOWN rows, orphan exact-rank keys after transitions, and repair paths that risked deleting valid ALL samples.
4. Champion-specific cleanup (Camille / Akali style) is not an acceptable architecture.
5. Apex representation was incomplete: Challenger roots existed while Grandmaster / Master could be zero — “Apex represented” must not mean Challenger-only.

### 2.3 Technical lessons to preserve in the new design

- `MatchParticipant` already stores participant PUUID in `externalAccountId`.
- Riot League-v4 supports `entries/by-puuid`.
- Account-v1 is **not** required for rank lookup.
- Co-participant rank lookup can therefore be decoupled from `TrackedPlayer`.
- Durable observations / cache are preferred over Redis-only rank memory.
- Shared Riot 429 cooldown is mandatory for enrichment as well as collector / ladder.

---

## 3. Current baseline (Milestone 11 code)

### 3.1 Validated M11 A1 state (from M11 design)

| Metric | Before M11 | After M11 A1 |
| ------ | ---------- | ------------ |
| Tracked players | 5 | **30** |
| Sources | ADMIN_SEED 2, MATCH_PARTICIPANT 3 | ADMIN_SEED 2, **LADDER 25**, MATCH_PARTICIPANT 3 |
| champion-position ≥1 | 19 | **161** |
| classic zero | 154 / 173 | **51 / 173** |
| champion-position ≥30 | 0 | **0** (expected) |

Honest remaining limitation after M11: no ranking-floor buckets yet. Pipeline works; bottleneck is population size + representation + continuous match volume — **and**, for M12-v2, honest participant-rank attribution before scaling that volume.

### 3.2 Architecture in place (reuse — do not rewrite)

```text
Acquisition (Nest CLI — operator today)
  ladder-seed (apex | representative)
    → LadderCandidate normalize
    → bounded Account-v1 resolve (when Riot ID missing)
    → race-safe LADDER + total hard-cap TX
    → TrackedPlayer (enrollmentSource=LADDER, discoveryDepth=0)

Collection (Nest CLI — not auto-started)
  collector:run / collector:scheduler
    → PopulationCollectorService.runOnce
    → claim TrackedPlayer wave (leases + HOT/WARM/COLD priority)
    → soft ranks + match ID discovery (queue 420)
    → enqueue INGEST_MATCH (bounded + backpressure)

Ingestion (worker)
  match-ingestion → Match / MatchParticipant
    → champion-aggregation
    → optional MATCH_PARTICIPANT expansion (Task 4; default off)

Coordination
  RiotSharedCooldownStore (Redis) — cross-process 429

Observability
  collector:coverage — density + ladder representation health
```

### 3.3 Known M11 rank gap (must be fixed before scaling)

At M11, champion aggregation maps null `rankTierAtIngestion` to the `UNKNOWN` sentinel.

That is insufficient for asynchronous co-participant enrichment:

- null today often means “not resolved yet,” not “Riot confirmed unranked”
- M12-v2 must introduce an explicit unresolved state that remains in `ALL` and is excluded from exact tiers and from finalized UNKNOWN

### 3.4 Safety invariants inherited from Task 4 / M11 (locked)

1. Bounded `runOnce` (batch / concurrency / match-id / enqueue caps)
2. Global autonomous MATCH_PARTICIPANT budget + ladder/total hard caps
3. Owner-safe scheduler lease; scheduler never auto-starts from API/worker boot
4. Winner-only BullMQ ingestion backpressure
5. Shared cross-process 429 cooldown (Retry-After-aware, monotonic)
6. First `enrollmentSource` immutable; `discoveryDepth` uses min-on-rediscovery
7. No recursive immediate crawl (expansion enrolls only)
8. Ranking floor unchanged (**30**)
9. Queue-420 primary for success metrics
10. No CN platforms; no second ingestion pipeline

---

## 4. Database compatibility warning (local ops)

Git reset / clean branch checkout **does not** reset PostgreSQL.

As of Phase 0 audit on this machine:

| Check | Finding |
| ----- | ------- |
| Git code baseline | Clean `395d251` on `milestone-12-continuous-population-operations-v2` |
| Repo migrations on branch | 9 migrations through `20260810130000_milestone_11_refresh_activity` |
| Local DB `_prisma_migrations` | Includes abandoned `20260810160000_participant_rank_enrichment` |
| Abandoned schema present? | Yes — `ParticipantRankObservation`, `ParticipantRankResolutionStatus`, `MatchParticipant.rankResolutionStatus` / `rankResolvedAt` |
| Local population vs M11 A1 | Larger experimental population (e.g. ~95 tracked players, hundreds of matches) from abandoned attempt |

### 4.1 Required operator action before implementation

Do **not** destructively reset/drop the DB automatically from an agent.

Preferred path:

1. **Backup / archive** the current DB (keeps abandoned experimental evidence).
2. Obtain a **clean M11-compatible development DB**:
   - restore an M11 backup, **or**
   - create a fresh database and apply only the 9 M11 migrations from this branch.
3. Confirm:
   - no `ParticipantRankObservation`
   - no `ParticipantRankResolutionStatus`
   - no `rankResolutionStatus` / `rankResolvedAt` columns
   - `_prisma_migrations` matches the 9 M11 migrations only
4. Only then begin Phase 1+ implementation against that DB.

M12-v2 must design and later implement its own rank-enrichment schema from the M11 baseline. It must not silently reuse abandoned migration objects as if they were already approved.

### 4.2 Aggregate / data preservation invariant

**Aggregate repair must never create consistency by deleting valid source-backed match samples.**

- `MatchParticipant` is source truth.
- Reclassification may change rank buckets.
- Repair / convergence must not erase valid `ALL` contributions.
- No champion-specific delete/cleanup as architecture.

---

## 5. Rank-dimension foundation (first-class architecture)

### 5.1 Design goal

Resolve rank for every eligible ranked-match participant where possible, without:

- creating `TrackedPlayer` merely to obtain rank
- copying the tracked/root player’s tier onto co-participants
- requiring Account-v1 for rank lookup
- treating Redis as the only durability layer

### 5.2 Proposed resolution states

Starting vocabulary (implementation may refine names, not semantics):

| Status | Meaning | Finalized? | Exact-tier eligible? | UNKNOWN-eligible? |
| ------ | ------- | ---------- | -------------------- | ----------------- |
| `PENDING` / UNRESOLVED | Not looked up yet, or waiting | No | No | No |
| `FAILED_RETRYABLE` | Transient failure / 429 / timeout | No | No | No |
| `RESOLVED_RANKED` | Applicable Solo/Duo rank observed | Yes | Yes | No |
| `RESOLVED_UNRANKED` | Lookup completed successfully; no applicable rank | Yes | No | Yes (`UNKNOWN` / `UNRANKED` product bucket) |
| `FAILED_PERMANENT` / PERMANENT_UNAVAILABLE | Explicitly documented unrecoverable technical/data gap (e.g. missing PUUID) | Yes (as unavailable diagnostic) | No | **No** — remains ALL-only; never product UNKNOWN |
| `NOT_APPLICABLE` | Non-ranked queue / outside enrichment scope | N/A | No | No |

### 5.3 Enrichment architecture (design only)

```text
Match ingestion persists MatchParticipant (PUUID in externalAccountId)
  → eligible ranked participants enter rank-enrichment backlog
  → enrichment worker resolves League-v4 entries/by-puuid
  → durable ParticipantRankObservation (cache)
  → participant resolution status + observed tier/division updated
  → affected aggregate keys recalculated from MatchParticipant source rows
```

Design requirements:

- League-v4 by PUUID
- reusable participant rank observation / cache
- durable observations preferred over Redis-only
- proposed freshness starting point: **6h** (review in Phase 2/3; not locked forever)
- developer concurrency begins at **1**
- shared Riot 429 cooldown mandatory
- retryable errors stay unresolved (`FAILED_RETRYABLE` / retry schedule)
- same PUUID should not incur repeated calls unnecessarily (singleflight + observation freshness)
- enrichment converges automatically under bounded retries / backfill

### 5.4 Aggregate convergence requirements

Aggregation must treat `MatchParticipant` source rows as authoritative and use a **generic affected-key / recalculation model**.

For rank-state transitions such as:

- PENDING → DIAMOND
- UNKNOWN/UNRANKED → DIAMOND
- DIAMOND → EMERALD
- DIAMOND → UNRANKED

the system must:

1. preserve `ALL`
2. remove stale old rank contribution
3. add new rank contribution
4. delete aggregate rows whose source set becomes empty
5. remain idempotent
6. avoid orphan exact-rank keys and stale UNKNOWN rows
7. never invent Camille/Akali special cases

### 5.5 Rank quality metrics and gates

Diagnostics (minimum):

| Metric | Definition |
| ------ | ---------- |
| `rankClassifiedSampleCount` | Finalized ranked + finalized unranked + permanent-unavailable terminals |
| `rankUnresolvedSampleCount` | PENDING + FAILED_RETRYABLE |
| `permanentUnavailableSampleCount` | `FAILED_PERMANENT` only — separate diagnostic; **never** product UNKNOWN |
| `rankResolutionCoverage` | `(RESOLVED_RANKED + RESOLVED_UNRANKED + FAILED_PERMANENT) / eligible ranked participants` |
| `exactRankCoverage` | `RESOLVED_RANKED / eligible ranked participants` (denominator **includes** permanent-unavailable — they penalize exact coverage) |
| health status | Product data-quality classification from `exactRankCoverage` (below) |

Track counts by state (required in operational output):

- PENDING
- FAILED_RETRYABLE
- RESOLVED_RANKED
- RESOLVED_UNRANKED
- FAILED_PERMANENT / permanent-unavailable (separate; not UNKNOWN)
- `exactRankCoverage`
- `rankResolutionCoverage`
- health status

#### Exact rank coverage health policy (locked)

This is a **product data-quality requirement**, not a claim that Riot guarantees any resolution rate.

| `exactRankCoverage` | Health class | Meaning |
| ------------------- | ------------ | ------- |
| **&lt; 60%** | **RED / UNHEALTHY / PROBLEMATIC** | Materially incomplete rank-filtered statistics dataset. Emit operational warning **`RANK_COVERAGE_UNHEALTHY`**. |
| **60%–80%** | **YELLOW** | Usable but incomplete |
| **80%–90%** | **HEALTHY-ISH** | Strong validation range |
| **≥ 90%** | Preferred mature range | Where feasible given Riot-ranked population data |

Important:

- **60% is a MINIMUM HEALTH FLOOR, not the target.**
- Do **not** claim Riot guarantees &gt;60% ranked resolution.
- A rank-filtered statistics dataset below 60% exact rank coverage is considered **materially incomplete**.

#### Scaling rule (locked)

Population scaling **must remain blocked** when:

```text
exactRankCoverage < 60%
```

unless a human explicitly approves a documented external-data exception.

| Intent | Threshold |
| ------ | --------- |
| Hard block on representative / population scaling | `exactRankCoverage < 60%` → RED / `RANK_COVERAGE_UNHEALTHY` |
| Preferred before representative scaling | `exactRankCoverage ≥ 80%` |
| Target mature state | `rankResolutionCoverage ≥ 90%`, with `exactRankCoverage` as high as Riot-ranked population data reasonably permits |

If `exactRankCoverage` remains below 60% after enrichment/backfill:

**STOP and investigate.**

Do **not** address it by:

- converting unresolved to UNKNOWN
- dropping unresolved from `ALL`
- lowering the threshold
- hiding the warning

At minimum, rank-quality/status reporting must emit **`RANK_COVERAGE_UNHEALTHY`** when `exactRankCoverage < 0.60`.

#### Gate philosophy

- Do **not** silently accept ~10–15% known-rank coverage as healthy.
- Do **not** treat the 60% floor as success.
- Before population scaling resumes, prefer `exactRankCoverage ≥ 80%` and mature toward `rankResolutionCoverage ≥ 90%`.
- Subject to legitimate Riot-data gaps for finalized unranked / permanent-unavailable residuals — those must be explained, not papered over.

---

## 6. Milestone phase sequence (M12-v2)

**Dependency lock:** RANK CORRECTNESS BEFORE POPULATION SCALING.

| Phase | Intent | Production code? |
| ----- | ------ | ---------------- |
| **0** | Design + plan (this document + plan) | **No** |
| **1** | Operational stabilization from M11 — auth, failed jobs, coverage baseline, scheduler health, **M11-compatible DB confirmation** | Minimal ops tooling only if required |
| **2** | Rank-dimension foundation — semantics, observation/cache design, aggregate convergence semantics, tests; **no population scaling** | Yes (foundation only) |
| **3** | Rank enrichment implementation + tiny validation — co-participant lookup, cache/retry/cooldown, aggregation convergence; **no large backfill** | Yes |
| **4** | Bounded current-patch rank backfill — progressive batches; coverage metrics; champion smoke tests | Yes |
| **5** | Observation-scale continuous scheduler on existing M11 population | Yes (ops enablement; no large ladder expansion) |
| **6A** | Apex representation correction — Challenger / Grandmaster / Master audit + small repair if needed | Yes (bounded) |
| **6B** | Diamond / Emerald / Platinum representative acquisition | Yes (bounded waves) |
| **6C** | Gold | Yes |
| **6D** | Silver / Bronze / Iron | Yes |
| **7** | Coverage balancing / hard-cap evidence gates | Yes |
| **8** | Rank-aware analytics preparation (no frontend redesign / matchups) | Prep only |

### 6.1 Why this order is required

The abandoned attempt proved population acquisition can create large match volume while co-participant ranks remain unresolved, producing misleading rank-filtered champion stats.

Therefore:

> Do **not** scale data volume until the rank pipeline can correctly classify the participants already present.

---

## 7. Population acquisition strategy (later phases)

### 7.1 Multi-source model

| Source | Role in M12-v2 | Depth | Caps | Notes |
| ------ | -------------- | ----- | ---- | ----- |
| **LADDER** | Primary continuous root acquisition after rank pipeline healthy | 0 | Ladder total + per-run + total hard cap | Representation engine |
| **MATCH_PARTICIPANT** | Secondary breadth amplifier | parent+1 | Autonomous budget + windows | Not the tier-mix strategy; not required for rank attribution |
| **PRODUCT_SEARCH** | Opportunistic user-driven enrollment | 0 | Total hard cap; flag-gated | Highest product-intent priority when scarce |
| **ADMIN_SEED / BOOTSTRAP** | Operator / ops | 0 | Total hard cap | Explicit ops |

Preserve:

- `enrollmentSource` immutability
- `discoveryDepth` min-on-rediscovery
- population caps
- dedup via unique `TrackedPlayer.playerAccountId`

### 7.2 Rank representation segments

| Segment | Tiers | Product role | Acquisition phase |
| ------- | ----- | ------------ | ----------------- |
| **Apex** | Challenger, Grandmaster, Master | High-skill reference | **6A** audit/repair first |
| **High / Mid** | Diamond, Emerald, Platinum | Competitive signal | **6B** |
| **Mid-low** | Gold | Bridge into majority band | **6C** |
| **Low** | Silver, Bronze, Iron | Majority population honesty | **6D** |

Lower-tier representation remains a **core product requirement**. The system must not become high-elo-only.

Required eventual presence:

Challenger, Grandmaster, Master, Diamond, Emerald, Platinum, Gold, Silver, Bronze, Iron.

### 7.3 Apex representation audit (mandatory)

Do **not** equate:

```text
APEX REPRESENTED == CHALLENGER ONLY
```

Phase 6A must verify Challenger / Grandmaster / Master balance and perform small GM/Master repair if needed before claiming apex coverage is healthy.

Prior experimental evidence suggested Challenger roots could exist while Grandmaster/Master were zero — possibly create-budget ordering. Treat as a hypothesis to audit, not a solved fact.

### 7.4 What not to do for acquisition

- Do not treat MATCH_PARTICIPANT expansion as the path to lower-tier representation
- Do not champion-target enrollment
- Do not remove per-run / total caps “to go faster”
- Do not multi-region stampede before na1 representation is healthy
- Do not start Phase 6 (including 6A apex repair and 6B–6D representative waves) while `exactRankCoverage` is RED (`< 60%`), unless a human documents an external-data exception
- Prefer `exactRankCoverage ≥ 80%` before representative scaling; do not start Phase 6B–6D until Phase 4 rank-quality gates and Phase 5 observation ops are healthy

---

## 8. Continuous crawler architecture (post rank health)

### 8.1 Dual loop (unchanged concept, later enablement)

```text
Loop A — Population maintenance (enrollment waves)
  periodic / operator-triggered ladder-seed waves
  segment budgets + page bounds
  → new LADDER roots (depth 0)

Loop B — Match collection (refresh)
  collector scheduler (when enabled by operator)
  → HOT/WARM/COLD claim order
  → bounded runOnce → ingest → rank enrichment → aggregate
  → optional Task 4 expansion (secondary)
```

Continuous ≠ maximum always-on crawl. Every wave and tick remains admission-controlled.

### 8.2 Scheduler behavior

Reuse `CollectorSchedulerService`:

- Explicit process (`pnpm collector:scheduler`); never auto-start on API/worker boot
- Hot-re-read `COLLECTOR_SCHEDULER_ENABLED`
- Tick gates: lease → shared 429 cooldown → local cooldown → ingestion backpressure → `runOnce`
- Agents never enable scheduler by editing real `.env` files

### 8.3 Refresh cadence (reuse HOT/WARM/COLD)

| Tier | Signal | Default cadence | Priority |
| ---- | ------ | --------------- | -------- |
| HOT | ≥1 new match enqueued | 1h | 100 |
| WARM | zero-new, streak < cold threshold | 6h | 50 |
| COLD | zero-new streak ≥ 3 | 48h | 10 |
| Failed | discovery failures / 429 | exponential backoff | (existing) |

---

## 9. Riot API budget model

### 9.1 Operating modes

Key class is an **operational mode**, not a footnote.

#### Developer key mode

- Slower multi-week accumulation
- Lower batch / concurrency; observation-scale first
- Enrichment concurrency begins at 1
- Small bounded enrollment waves only after rank gates
- Planning band remains conservative unique-match/day growth

#### Production key mode

- Higher sustainable throughput under the same caps/gates
- Still admission-controlled; not unlimited
- Finalize velocity targets after measurement

Do **not** assume production-scale throughput on a developer key.

### 9.2 Cost notes

Dominating cost at scale remains **match detail (+ timeline)**, not ladder list calls. Rank enrichment adds League-v4 by-PUUID cost and must share the same cooldown / budget discipline.

Useful request/cache design choices for later phases:

- League-v4 by PUUID
- durable observation cache
- 6h freshness as a starting proposal
- developer concurrency = 1
- shared 429 cooldown
- no unnecessary repeat calls for the same PUUID

---

## 10. Coverage-driven scaling (after rank health)

### 10.1 Primary density metrics

Reuse product shape: semantic latest patch, `rankTier='ALL'`, exact positions, platform + queue 420.

| Metric | Why |
| ------ | --- |
| champion-position ≥1 | Breadth |
| champion-position ≥30 | Ranking floor / usefulness |
| champion-position ≥100 | Stretch quality |
| classic-zero count | Roster gaps |
| near-floor band (20–29) | Leading indicator |

### 10.2 Coverage velocity and unique match yield

| Metric | Why |
| ------ | --- |
| Δ ≥30 buckets / day | Product usefulness trend |
| Δ current-patch matches / day | Patch-relevant volume |
| Δ unique matches / day | Dedup-aware throughput |
| unique matches ingested / tracked players refreshed | Yield vs vanity player count |

### 10.3 Hard-cap increase gates

Before increasing `COLLECTOR_LADDER_MAX_TOTAL` or `COLLECTOR_TOTAL_TRACKED_PLAYERS_HARD_CAP`, require written evidence of:

1. Rank-quality gates already healthy on current-patch data
2. Coverage velocity measured over a defined window
3. Stable worker throughput
4. No cooldown thrashing
5. Storage growth acceptable
6. Queue / backpressure healthy

Raising hard caps is a Phase 7 decision with evidence, not a shortcut around rank correctness.

---

## 11. Rank-aware analytics preparation (Phase 8 only)

No frontend redesign and no matchups in M12.

Later prep may include:

- stable segment vocabulary in `packages/shared`
- read-path merge design for band views
- honesty rules (sample size always visible; ranking floor 30)
- cache identity includes segment / rank filter
- ingestion completeness metrics

Band views are associations within a sampled population, not causal proof and not “all League matches.”

---

## 12. Environment ownership (permanent)

Agents **NEVER** modify:

- `.env`
- `apps/api/.env`
- `apps/worker/.env`
- any real local secret / runtime env file

Agents **MAY** modify:

- `.env.example`
- `apps/api/.env.example`
- `apps/worker/.env.example`
- config schemas
- docs / tests

Operator applies real runtime env changes manually.

No agent should enable schedulers, crawlers, or production-like limits by editing real `.env` files.

---

## 13. Failure and operations

| Failure | Handling |
| ------- | -------- |
| Expired / invalid Riot key | Fail closed; no retry storm; ops gate before live waves / enrichment scale |
| 429 cooldown | Shared Redis cooldown; enrichment/collector/ladder all honor it |
| Retryable rank lookup failure | Remain `FAILED_RETRYABLE` / unresolved; do not become UNKNOWN |
| Permanent rank gap | Explicit status; documented product mapping only |
| Worker failures | BullMQ retries + durable job state |
| Scheduler crash | Lease expiry → another owner |
| Cap exhaustion | Stop creates; report |
| Aggregate repair temptation | Recalculate from source; never delete valid MatchParticipant samples to force totals |

Phase 1 review gate order:

1. Confirm M11-compatible DB (or approved exception)
2. Riot key / auth verification
3. Failed ingest triage
4. Coverage baseline
5. Scheduler status verification
6. Tiny controlled run only if healthy

---

## 14. Explicit non-goals

Do **not** propose or implement in M12-v2:

- Champion-targeted crawling
- Infinite graph traversal / depth explosions
- Replacing Task 4 expansion machinery
- Removing caps or bypassing Riot limits
- Lowering ranking floor below **30**
- Frontend redesign
- Matchup / counter implementation
- Treating Challenger-only as Apex success
- Boot-auto-started crawlers
- CN / unofficial clients
- Building on abandoned M12 migration/code as baseline
- Population scaling before rank-quality gates
- Agent-owned edits to real `.env` files

---

## 15. Open questions (require approval)

1. **Local DB remediation choice for Phase 1:** archive-and-fresh-M11-DB vs restore-from-backup vs carefully reverse abandoned schema in place?
2. **UNKNOWN product label:** keep aggregate sentinel name `UNKNOWN` for finalized unranked, or introduce distinct `UNRANKED` storage value with API mapping?
3. **Permanent-unavailable mapping:** **DECIDED (Phase 2 correction)** — `FAILED_PERMANENT` is a separate diagnostic (`PERMANENT_UNAVAILABLE`); ALL yes; exact no; UNKNOWN no; remains in exact-coverage denominator.
4. **Observation freshness:** keep 6h as Phase 3 default, or choose another TTL after tiny validation?
5. **Timeline fetch during later ramp:** keep enabled, or temporarily disable to raise match throughput in developer mode?
6. **Ladder continuous driver later:** stay CLI+external cron, or add in-repo ladder-scheduler CLI with lease?
7. **PRODUCT_SEARCH enrollment during M12:** enable or keep off until population is healthy?
8. **Multi-platform timing:** only after na1 usefulness, or earlier for americas siblings?

**Resolved by this M12-v2 redesign:**

- Rank correctness precedes population scaling.
- `TrackedPlayer` is not required for participant rank attribution.
- `ALL` is independent of rank-resolution state.
- Unresolved must not silently become UNKNOWN.
- `exactRankCoverage < 60%` is RED / `RANK_COVERAGE_UNHEALTHY` (minimum health floor, not target); population scaling stays blocked unless a documented human exception is approved.
- Preferred before representative scaling: `exactRankCoverage ≥ 80%`; mature target: `rankResolutionCoverage ≥ 90%`.
- Lower tiers remain required; sequence is 6A → 6B → 6C → 6D after rank health.
- Apex means Challenger + Grandmaster + Master, not Challenger-only.
- Agents never edit real runtime env files.

---

## 16. Recommendation

Approve Phase 0 M12-v2 design direction:

1. Restart from M11 (`395d251`); archive first attempt; do not build on abandoned implementation.
2. Remediate local DB to M11-compatible schema before implementation.
3. Build participant-rank enrichment + aggregate convergence **before** ladder scaling.
4. Enforce exact-rank health policy: `<60%` = `RANK_COVERAGE_UNHEALTHY` / scaling blocked; prefer `≥80%` before representative waves; mature toward `≥90%` resolution coverage.
5. Preserve continuous dual-loop ops, developer/production modes, coverage velocity/yield, hard-cap gates, lower-tier requirement, ranking floor 30, and no frontend/matchup work in M12.
6. Use honest “rank observed during enrichment cycle” semantics.

**Stop for review.** No production code, migrations, scheduler enablement, rank backfill, or ladder waves in Phase 0.
