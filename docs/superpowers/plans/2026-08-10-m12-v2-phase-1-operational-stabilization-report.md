# M12-v2 Phase 1 Report — Operational Stabilization + DB Readiness

**Date:** 2026-08-10  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Code baseline:** `395d251` — `feat(collector): scale population coverage via ladder acquisition (M11)`  
**Decision:** `READY_FOR_M12_V2_PHASE_2`

---

## Git baseline

| Check | Result |
| ----- | ------ |
| Branch | `milestone-12-continuous-population-operations-v2` |
| HEAD | `395d2512466828aec29ba7009dc7efb363cf9f4d` |
| Dirty/clean | Clean tracked tree at M11; Phase 0 docs + Phase 1 diagnostic scripts/report untracked |
| Abandoned M12 production implementation on branch | **Absent** from working tree and git tree |

Confirmed:

- HEAD matches M11 baseline `395d251`
- Prisma migrations on disk are the 9 M11 migrations only (head folder: `20260810130000_milestone_11_refresh_activity`)
- No `ParticipantRankObservation` / rank-resolution fields in `apps/api/prisma/schema.prisma`
- Abandoned migration folder `20260810160000_participant_rank_enrichment` is **not** present in the code tree
- Archive branch `archive/m12-first-attempt` was not checked out or cherry-picked

---

## DB baseline

### Compatibility result (original runtime DB)

**`DB_BASELINE_INCOMPATIBLE` on `league_helper`** — initial hard gate finding (preserved; not mutated).

Original connected database:

- Host: `localhost:5432`
- Database name: `league_helper`
- Schema: `public`

Prisma CLI note: `prisma migrate status` can report “up to date” even when abandoned objects remain, because the abandoned migration file is absent from the code tree. Direct inspection is required.

Original migration head on `league_helper`: `20260810160000_participant_rank_enrichment`

Abandoned objects on `league_helper` (still present; intentionally preserved):

| Object | Status |
| ------ | ------ |
| Migration row `20260810160000_participant_rank_enrichment` | PRESENT |
| Table `ParticipantRankObservation` | PRESENT |
| Enum `ParticipantRankResolutionStatus` | PRESENT |
| Column `MatchParticipant.rankResolutionStatus` | PRESENT |
| Column `MatchParticipant.rankResolvedAt` | PRESENT |

---

## DB remediation

| Item | Result |
| ---- | ------ |
| Old DB preserved? | **Yes** — live `league_helper` untouched; custom dump archive created |
| Dump archive | `.local/db-archives/league_helper_m12_experimental_2026-08-10.dump` (~2.3 MB, gitignored) |
| New DB name | `league_helper_m12v2` |
| New DB host | `localhost:5432` (same Docker Compose Postgres service) |
| Migrations applied | Exactly the 9 M11 migrations from this branch |
| Migration head | `20260810130000_milestone_11_refresh_activity` |
| Abandoned objects on new DB | Absent (table/enum/columns all empty) |
| `phase1-db-baseline-check.mjs` (new DB) | **`DB_BASELINE_COMPATIBLE` / `RESULT=M11_COMPATIBLE`** |
| Real `.env` files edited by agent? | **No** |

Non-destructive setup performed:

1. `pg_dump` of `league_helper` → local archive
2. `CREATE DATABASE league_helper_m12v2 OWNER league`
3. `prisma migrate deploy` with one-shot `DATABASE_URL` override to the new DB
4. Baseline check against the new DB via the same override
5. Example env files updated to document `league_helper_m12v2`
6. Operator manually switched real `DATABASE_URL` values and restarted API/worker

### Runtime switch verification (post-operator)

| Check | Result |
| ----- | ------ |
| `prisma migrate status` datasource | `league_helper_m12v2` |
| Migration count | 9 |
| Migration head | `20260810130000_milestone_11_refresh_activity` |
| Abandoned rank schema | Absent |
| `phase1-db-baseline-check.mjs` | **`DB_BASELINE_COMPATIBLE`** |

---

## Riot auth

Probed via `apps/api/scripts/phase1-riot-auth-probe.ts` against `na1` / Ranked Solo.

| API | Result |
| --- | ------ |
| Account-v1 (`accounts/by-puuid`) | **OK** (HTTP 200) |
| League-v4 (challenger list + `entries/by-puuid`) | **OK** (HTTP 200; challenger candidates=302) |
| Match-v5 (recent match ids, count=1, queue 420) | **OK** (HTTP 200) |
| Auth blocked (401/403) | **No** |
| Operating mode | **`developer-key`** (evidence: `x-app-rate-limit` = `100:120,20:1`) |

No API keys were printed. No retry storm.

---

## Jobs

Source of truth for Phase 1 durable state: clean DB `IngestionJobRecord` on `league_helper_m12v2`.

| Status | Count |
| ------ | ----- |
| PENDING | 0 |
| QUEUED | 0 |
| RUNNING | 0 |
| COMPLETED | 0 |
| FAILED | 0 |
| DEAD_LETTERED | 0 |
| CANCELLED | 0 |

Failure classifications (durable failed/dead-lettered sample): all zero.

BullMQ Redis note (shared Redis; not clean-DB durable state):

| BullMQ list | Count |
| ----------- | ----- |
| waiting | 0 |
| active | 0 |
| delayed | 0 |
| failed set | 30 (orphan leftovers from prior experimental Redis usage) |

No mass retry performed. Pending backpressure signal (`waiting+active+delayed`) = **0**. Orphan Redis failed-set entries are noted for operator hygiene later; they are not a clean-DB job storm.

---

## Population

Fresh clean-DB baseline (`pnpm collector:coverage --platform na1 --queue 420 --json`):

| Metric | Value |
| ------ | ----- |
| tracked total | 0 |
| ADMIN_SEED | 0 |
| PRODUCT_SEARCH | 0 |
| BOOTSTRAP | 0 |
| LADDER | 0 |
| MATCH_PARTICIPANT | 0 |
| byDiscoveryDepth / byStatus | empty |
| caps remaining | matchParticipant 500; ladder 1500; totalTracked 2000 |

This empty population is expected for a newly created M11-compatible DB and is **not** treated as abandoned-M12 metrics.

---

## Coverage

`platform=na1`, `queue=420` (clean DB):

| Metric | Value |
| ------ | ----- |
| ≥1 | 0 |
| ≥30 | 0 |
| ≥100 | 0 |
| classic-zero | unavailable (no semantic patch yet) |
| current semantic patch | null |
| current-patch q420 matches | null / queueTotal=0 |
| unique matches | 0 |
| max sample | 0 (all positions) |
| ranking floor | 30 (unchanged) |

Warnings are empty-DB expected: no aggregate patch resolved; classic-zero unavailable.

---

## Rank baseline

`platform=na1`, `queue=420` MatchParticipant rows on clean DB:

| Metric | Value |
| ------ | ----- |
| eligible participant count | 0 |
| `rankTierAtIngestion` known | 0 |
| `rankTierAtIngestion` null | 0 |
| known percent | n/a (no rows) |
| null percent | n/a (no rows) |

Honesty note: at M11, null `rankTierAtIngestion` would mean unresolved ambiguity for future M12-v2 distinction — **not** finalized `UNKNOWN`. No null rows exist yet on this clean DB.

---

## Scheduler / Redis

| Check | Result |
| ----- | ------ |
| scheduler exists | Yes (`collector:scheduler-status` / scheduler CLI path) |
| default disabled | **Yes** — `enabled=false` / `COLLECTOR_SCHEDULER_ENABLED=false` |
| no boot auto-start | Confirmed by disabled config + no lease/trigger activity |
| lease | Absent (`leaseOwnerPresent=false`, `leaseExpiresAt=null`) |
| last outcome / trigger | null |
| Redis reachable | **Yes** (`PONG`) |
| shared Riot cooldown key | `riot:shared-429-cooldown` readable |
| cooldown currently active | **Inactive** (stored until `2026-08-10T08:22:28.407Z`; expired; scheduler reports `cooldownActive=false`) |
| ingestion backpressure threshold | `maxPendingIngestionJobs=500` |
| current pending pressure | 0 (`waiting+active+delayed`) |
| HOT/WARM/COLD config intact | Yes (intervals/priorities/cold-after-zero-new-runs present; expansion off) |
| participant expansion | `expandFromParticipants=false` |

Scheduler was **not** enabled persistently. Real `.env` files were not edited by the agent.

---

## Tiny run

**Skipped apply run; dry-run only.**

| Item | Result |
| ---- | ------ |
| Apply tiny collector run | Skipped |
| Reason | Clean DB has **0** tracked players — no existing M11 population to refresh without seeding/ladder enrollment (forbidden here) |
| Dry-run performed | Yes — `pnpm collector:run --dry-run --platform na1 --queue 420 --batch-size 1 --json` |
| Dry-run outcome | `ok=true`, `eligibleCount=0`, `candidates=[]` |

No ladder enrollment, no participant expansion, no persistent scheduler enablement, no 401/403/429 during the dry-run path.

---

## Files changed

| Path | Role |
| ---- | ---- |
| `apps/api/scripts/phase1-db-baseline-check.mjs` | Read-only M11 DB compatibility gate |
| `apps/api/scripts/phase1-riot-auth-probe.ts` | Read-only Account/League/Match auth + mode probe |
| `apps/api/scripts/phase1-job-triage.mjs` | Read-only durable ingestion job triage |
| `apps/api/scripts/phase1-rank-baseline.mjs` | Read-only rankTierAtIngestion baseline |
| `.env.example` | Document `league_helper_m12v2` DB name |
| `apps/api/.env.example` | Document `league_helper_m12v2` DB name |
| `apps/worker/.env.example` | Document `league_helper_m12v2` DB name |
| `docs/superpowers/plans/2026-08-10-m12-v2-phase-1-operational-stabilization-report.md` | This report |

No production behavior changes. No real env files modified by the agent. No commit created.

Also present (Phase 0, untracked):

- `docs/superpowers/plans/2026-08-10-continuous-population-operations.md`
- `docs/superpowers/specs/2026-08-10-continuous-population-operations-design.md`

---

## Commands run (Tasks 3–7 resume)

```bash
pnpm --filter @league-helper/api exec prisma migrate status
pnpm --filter @league-helper/api exec node scripts/phase1-db-baseline-check.mjs
pnpm --filter @league-helper/api exec tsx scripts/phase1-riot-auth-probe.ts
pnpm --filter @league-helper/api exec node scripts/phase1-job-triage.mjs
pnpm --filter @league-helper/api exec node scripts/phase1-rank-baseline.mjs
pnpm collector:coverage --platform na1 --queue 420 --json
pnpm collector:scheduler-status --json
pnpm collector:status --platform na1 --queue 420 --json
docker compose exec -T redis redis-cli PING
docker compose exec -T redis redis-cli GET riot:shared-429-cooldown
# BullMQ depths via redis-cli LLEN/ZCARD on bull:match-ingestion:*
pnpm collector:run --dry-run --platform na1 --queue 420 --batch-size 1 --json
```

---

## Decision

**`READY_FOR_M12_V2_PHASE_2`**

Phase 1 operational stabilization succeeded on clean M11 DB `league_helper_m12v2`:

- runtime DB verified M11-compatible
- Riot auth healthy under developer-key evidence
- durable jobs empty / no systemic failure storm
- honest empty coverage + rank baseline captured
- scheduler remains disabled; Redis + shared cooldown reachable; cooldown inactive
- tiny apply run correctly skipped (no tracked population); dry-run confirms collector CLI wiring

Await human approval phrase `APPROVE M12-V2 PHASE 2` before any Phase 2 rank-foundation work.

Do **not** begin Phase 2 until that approval.
