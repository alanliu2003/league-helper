# M12-v2 Phase 6A Report — Representation Audit and Acquisition Foundation

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2`  
**Decision:** `READY_FOR_M12_V2_PHASE_6B`

---

## Current state

| Guard | Result |
| ----- | ------ |
| Active DB | `league_helper_m12v2` (root / api / worker `.env` verified; real env files not modified) |
| Rank-quality gate | `exactRankCoverage` **97.7%**, `rankResolutionCoverage` **100%**, health **MATURE** |
| Tracked population | **1** `PRODUCT_SEARCH`; **0** `LADDER` roots |
| Caps / crawler / lower tiers | untouched |

### DB representation snapshot (`pnpm ops:phase6a-db-audit`)

| Layer | Apex / related |
| ----- | -------------- |
| `RankSnapshot` by tier | `CHALLENGER:1`, `PLATINUM:1` (tiny product population) |
| `MatchParticipant` RESOLVED_RANKED (na1/420) | Challenger **15**, Grandmaster **9**, Master **7**, plus Diamond/Emerald/etc. |
| `ChampionAggregate.rankTier` (na1/420) | Challenger **28**, Grandmaster **18**, Master **14**, plus `ALL` / other exact tiers |
| LADDER roots by tier | **none** (`ladderPlayersByTier` empty) |

**Verdict on prior “Apex looked Challenger-only” concern:**  
Not a Challenger-only acquisition/enrichment bug. Participant observations and aggregate exact dimensions already expose Challenger **and** Grandmaster **and** Master. LADDER root acquisition simply has not been applied on this DB (0 LADDER rows). Root-tier coverage via RankSnapshot is therefore empty/partial by population shortage, not by tier collapse.

---

## Acquisition flow

### 1. Where does a player's rank come from?

- Written to `RankSnapshot` via League-v4 `entries/by-puuid` during player search / match-discovery refresh (`softSyncRanks` / search refresh / bootstrap).
- `TrackedPlayer` has **no tier column**. Ladder seed does **not** write RankSnapshot at enroll time.
- Coverage “ladder by tier” joins latest Solo RankSnapshot for LADDER roots after refresh.

### 2. Where does a participant's rank come from?

- Optional seed at ingest from linked PlayerAccount RankSnapshot (`rankTierAtIngestion`).
- Authoritative path: `participant-rank-enrichment` → League-v4 by PUUID → `ParticipantRankObservation` → applied to `MatchParticipant` (`RESOLVED_RANKED` + exact tier, or `RESOLVED_UNRANKED` → aggregate `UNKNOWN`).

### 3. Are they independent?

**Yes.** Player RankSnapshot and participant observed rank are separate League-v4 surfaces. Challenger LADDER roots do not force opponent tiers.

### 4. Can a Challenger root produce GM/Master participant observations?

**Yes.** Roots only drive match discovery. Co-participants resolve independently; DB already shows GM/Master participant + aggregate buckets without any LADDER roots.

### 5. What do rank filters aggregate from?

| Consumer | Source |
| -------- | ------ |
| Champion-stats API tier filter | `ChampionAggregate.rankTier` |
| Aggregate write path | `MatchParticipant.rankResolutionStatus` + `rankTierAtIngestion` → `classifyParticipantRankForAggregates` |
| Coverage ladder-by-tier | latest `RankSnapshot` for LADDER roots (not enrollment acquisition tier) |
| Not used for stats filters | TrackedPlayer (no tier), raw ladder candidate tier after enroll |

---

## Apex audit

### Acquisition (provider)

| Check | Finding |
| ----- | ------- |
| Endpoints | Separate league-v4 lists: `challengerleagues`, `grandmasterleagues`, `masterleagues` (not league-exp) |
| Pagination | Apex = **one list call per selected tier** (no paging). Representative mode pages `entries/{queue}/{tier}/{division}` |
| Tier on candidates | Taken from list DTO `tier` (apex) or entry `tier` (representative) — not collapsed to CHALLENGER |
| Division | Apex entries keep `rank` as division when present; apex divisions are often `I` |

### Enrollment

| Field | Preserved? |
| ----- | ---------- |
| Platform | Yes (`platformRoute`) |
| PUUID | Yes (`externalAccountId` / account link) |
| Original ladder tier | **Not stored on TrackedPlayer** (by design). Tier becomes visible after RankSnapshot sync on refresh |

### Refresh

Refresh `softSyncRanks` writes **current** Riot tier into RankSnapshot. There is no sticky “enrolled as Challenger” field to corrupt. Demotion/promotion over time is expected for current-rank semantics.

### Rank snapshots

With only a PRODUCT_SEARCH root, RankSnapshots are tiny. Not evidence of Challenger-only ladder acquisition.

### Config / operator path

| Knob | Behavior |
| ---- | -------- |
| Default `COLLECTOR_LADDER_TIERS` | `CHALLENGER,GRANDMASTER` (safe default; Master list is large) |
| Phase 6A fix | Env allowlist now includes **MASTER** (shared Apex segment) |
| CLI safety retained | MASTER still requires explicit `--tiers` (cannot come from config defaults alone) |

---

## Findings

1. **No Challenger-only provider bug.** Live dry-run returned non-zero Challenger, Grandmaster, and Master candidates.
2. **Aggregate / participant Apex dimensions already work** on co-participant enrichment without LADDER roots.
3. **LADDER root Apex representation is absent** because no ladder enrollment has been run on `league_helper_m12v2` — a population gap for Phase 6B, not a representation pipeline defect.
4. **Enrollment does not persist acquisition tier** on `TrackedPlayer`; representation of roots depends on later RankSnapshot. Documented; not rewritten (architecture change out of scope).
5. **Master league volume is large** (~10k on na1 dry-run). Keep MASTER opt-in via explicit CLI `--tiers` for Phase 6B budgets.
6. Dry-run hit `scan_ceiling` after scanning 200 candidates (expected config ceiling); fetch still counted full list sizes per tier.

---

## Fixes (if any)

Smallest foundation layer only — no population scaling, no enroll apply:

| Change | Why |
| ------ | --- |
| `packages/shared/src/rank-segments.ts` | Stable Apex/High/Mid/Low vocabulary; `hasCompleteApexRepresentation` helper |
| `LADDER_APEX_TIERS_ALLOWLIST` → shared `APEX_RANK_TIERS` | Env may include MASTER; defaults unchanged |
| Coverage service uses shared Apex/High/Mid sets | Single vocabulary source |
| Example env comment (root `.env.example` only) | Document MASTER allowlist + explicit CLI rule |
| Ops script `phase6a-db-audit.mjs` | Read-only DB guard + tier distribution |

**Not changed:** real `.env` files, caps, crawler, scheduler expansion, frontend, matchups, old DB `league_helper`, enrollment apply / tiny ladder creates.

---

## Tests

```text
shared: rank-segments + participant-rank-resolution → 19 passed
server-riot: riot-league-ladder → 19 passed
api: collector.config + collector.args + ladder-seed.service → 77 passed
worker: champion-aggregation eligibility + previous-keys → 35 passed
typecheck: shared, server-riot, api, worker → exit 0
```

Added/updated coverage includes:

- Challenger / Grandmaster / Master candidate tier preservation (no Challenger collapse)
- Master enroll path + full Apex dry-run (no creates)
- MASTER allowlisted in config; still rejected when only in config defaults for CLI
- Exact rank dimensions keep C / GM / Master distinct
- Segment vocabulary completeness

---

## Dry-run results

Command (no DB mutation; PowerShell: quote the CSV):

```text
pnpm collector:ladder-seed -- --platform na1 --mode apex --tiers "CHALLENGER,GRANDMASTER,MASTER" --dry-run --json
```

| Metric | Value |
| ------ | ----- |
| `dryRun` | `true` |
| `created` | **0** |
| `providerCalls` | **3** |
| `apexCandidates` / `fetched` | **11019** |
| by tier | **CHALLENGER 302**, **GRANDMASTER 717**, **MASTER 10000** |
| `alreadyTracked` | 0 |
| `wouldNeedIdentityResolve` | 199 (of scanned window; Account-v1 not called in dry-run) |
| `stoppedReason` | `scan_ceiling` |
| Riot HTTP | 3× league-v4 **200** |

Pagination: N/A for apex lists (one response per tier). Missing rank data: none on successful list responses; incomplete PUUID entries would increment `skippedIncompleteIdentity` (0 observed in this run’s fetch counters path).

---

## Coverage model (segment vocabulary)

Defined in `packages/shared` (`RANK_SEGMENTS`):

| Segment | Tiers |
| ------- | ----- |
| **Apex** | Challenger, Grandmaster, Master |
| **High** | Diamond, Emerald, Platinum |
| **Mid** | Gold |
| **Low** | Silver, Bronze, Iron |

Goal: **representation exists** — not equal player counts.

---

## Remaining scaling risks

- Phase 6B must use **explicit per-tier budgets**; Master list alone is ~10k and must not be enrolled unbounded.
- Almost all apex candidates need Account-v1 identity resolve on apply (`wouldNeedIdentityResolve`).
- LADDER root tier observability still lags until first RankSnapshot after refresh (no sticky acquisition tier).
- Scan ceiling / create caps interact with multi-tier waves — budget ordering must not starve GM/Master when Master volume dominates.
- Do not treat Challenger-only LADDER roots (if an operator seeds only Challenger) as “Apex represented”; use `hasCompleteApexRepresentation` / coverage by-tier.

---

## Files changed

### New

- `packages/shared/src/rank-segments.ts`
- `packages/shared/src/rank-segments.test.ts`
- `apps/api/scripts/phase6a-db-audit.mjs`
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-6a-representation-audit-report.md`

### Modified

- `packages/shared/src/index.ts`
- `packages/shared/src/participant-rank-resolution.test.ts`
- `packages/server-riot/src/riot-league-ladder.test.ts`
- `apps/api/src/features/collector/collector.config.ts`
- `apps/api/src/features/collector/collector.config.test.ts`
- `apps/api/src/features/collector/collector.args.ts`
- `apps/api/src/features/collector/collector.args.test.ts`
- `apps/api/src/features/collector/collector-coverage.service.ts`
- `apps/api/src/features/collector/ladder/ladder-seed.service.test.ts`
- `apps/api/src/features/collector/cli/ladder-seed.ts`
- `.env.example`
- `package.json` (`ops:phase6a-db-audit`)

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Cap increases, ladder apply waves, crawler, lower-tier acquisition
- Frontend / matchups
- Git commit

---

## Decision

**`READY_FOR_M12_V2_PHASE_6B`**

Rationale:

- Acquisition can represent Challenger, Grandmaster, and Master (live dry-run + tests).
- Participant enrichment and champion aggregates already expose distinct Apex exact dimensions.
- “Challenger-only Apex” on this DB was **missing LADDER roots / data shortage**, not a broken tier pipeline.
- Foundation vocabulary + MASTER allowlist aligned; MASTER remains explicit-CLI for safety.
- No redesign required; Phase 6B may proceed with **bounded** Apex repair / High-tier waves under existing caps — only after explicit Phase 6B approval.

Do **not** begin Phase 6B until explicit approval.
