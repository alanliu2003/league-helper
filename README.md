# League Helper

League of Legends analytics and AI coaching monorepo.

> Temporary product name. Final branding TBD.

## Workspace layout

- `apps/web` — Nuxt frontend (TypeScript strict, Tailwind CSS)
- `apps/api` — NestJS REST API with Prisma / PostgreSQL
- `apps/worker` — BullMQ background worker
- `packages/shared` — shared types, Zod schemas, constants
- `packages/match-analytics` — pure champion aggregate math (Wilson, KDA, rollups)
- `packages/ai` — champion AI insight generation (provider + validation + eval)
- `packages/config` — shared TypeScript and ESLint config

## Prerequisites

- Node.js 20.12+ (Node 22 recommended; this repo pins `22.14.0` in `.node-version`)
- pnpm 9 (`npm install -g pnpm@9`)
- Docker Desktop running (PostgreSQL + Redis)

### Windows / Nodist note

If you see `Sorry, there's a problem with nodist` or `%1 is not a valid Win32 application`, Nodist's Node 22 install is corrupted or locked. Fix with:

```powershell
nodist 20.10.0
nodist rm 22.14.0
nodist + 22.14.0
nodist 22.14.0
node -v   # should print v22.14.0
```

Then reopen the terminal and rerun `pnpm install` / `pnpm dev`.

## Local setup

Run these commands from the **repository root** unless noted otherwise.

```bash
# 1) Install dependencies
pnpm install

# 2) Copy environment templates (no real secrets)
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env

# 3) Start PostgreSQL and Redis
pnpm docker:up

# 4) Generate Prisma client + apply migrations
pnpm db:generate
pnpm db:migrate

# 5) Seed deterministic fake development data
pnpm db:seed

# 6) Build shared package (also runs on postinstall)
pnpm --filter @league-helper/shared build

# 7) Start API, worker, and web
pnpm dev
```

Then open:

- Web: http://127.0.0.1:3000
- API health: http://localhost:3001/health

## Database and Redis roles

- **PostgreSQL** is required for durable domain data: players/accounts, matches, static patch data, aggregates, coaching reports, and ingestion audit rows.
- **Redis** is used separately for BullMQ job queues/workers. It is not the source of truth for match or player history.

## Database commands

```bash
# From repo root
pnpm docker:up
pnpm db:generate
pnpm db:migrate              # prisma migrate dev (development)
pnpm db:migrate:deploy       # prisma migrate deploy
pnpm db:seed
pnpm db:studio
pnpm db:test:prepare         # apply migrations to TEST_DATABASE_URL schema
pnpm test:api:integration
```

Population-collector schema rollback (manual ops, Task 3 + Task 4 additive objects): drop in dependency order — `DROP TABLE IF EXISTS "CollectorRunSourceQuota"; DROP TABLE IF EXISTS "CollectorSchedulerState"; DROP TABLE IF EXISTS "CollectorPopulationBudget"; DROP TABLE IF EXISTS "CollectorRun"; DROP TABLE IF EXISTS "TrackedPlayer";` (indexes drop with the tables), then drop enums `CollectorSchedulerOutcome`, `CollectorRunStatus`, `TrackedPlayerEnrollmentSource`, `TrackedPlayerStatus`. No PlayerAccount backfill was performed, so rollback does not rewrite account rows. Prefer forward migrations in shared environments.

Safe local reset (destroys local Docker volumes):

```bash
pnpm docker:down
docker compose down -v
pnpm docker:up
pnpm db:migrate
pnpm db:seed
```

Integration tests use separate schemas (do not point destructive tests at `schema=public`):

```text
# API integration tests (pnpm --filter @league-helper/api test / db:test:prepare)
TEST_DATABASE_URL=postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test

# Worker integration tests (pnpm --filter @league-helper/worker test / db:test:prepare)
WORKER_TEST_DATABASE_URL=postgresql://league:league@localhost:5432/league_helper?schema=league_helper_worker_test
```

API and worker use distinct schemas so parallel `pnpm test` TRUNCATE resets cannot race across packages.

## Useful scripts

```bash
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm build
pnpm docker:down
```

## Domain model overview

```mermaid
erDiagram
  Player ||--o{ PlayerAccount : has
  PlayerAccount ||--o{ PlayerAccountAlias : aliases
  PlayerAccount ||--o{ RankSnapshot : ranks
  PlayerAccount ||--o{ ChampionMasterySnapshot : mastery
  PlayerAccount ||--o{ MatchParticipant : "linked (nullable)"
  Match ||--o{ MatchParticipant : participants
  Match ||--o{ MatchTeam : teams
  Match ||--|| MatchTimeline : timeline
  Patch ||--o{ ChampionStaticData : champions
  Patch ||--o{ ItemStaticData : items
  Patch ||--o{ RuneStaticData : runes
  PlayerAccount ||--o{ PlayerMetricSnapshot : metrics
  PlayerMetricSnapshot ||--o{ PlayerAnalysisReport : reports
  PlayerAnalysisReport ||--o{ AnalysisFinding : findings
```

### Identity rules

- Internal primary keys are UUIDs.
- For Riot, `PlayerAccount.externalAccountId` stores the **PUUID** (persistent external identity).
- Riot ID (`gameName` / `tagLine`) is display + lookup data, with normalized fields for case-insensitive search.
- `PlayerAccountAlias` preserves Riot ID history; upsert logic avoids duplicate “current” rows.

### Referential behavior

- Deleting a `Match` cascades to participants, teams, and timeline.
- Deleting a `PlayerAccount` uses `ON DELETE SET NULL` for `MatchParticipant.playerAccountId`, so historical matches survive.
- Rank/mastery history and analysis rows cascade with `PlayerAccount`.
- Static data deletion is restricted while a `Patch` is referenced (`ON DELETE RESTRICT`).
- Aggregate tables use empty-string sentinels for unspecified platform/regional dimensions so composite uniqueness remains reliable in PostgreSQL.

## Shared domain and Riot routing

Routing helpers live in `@league-helper/shared`. Apps must not hardcode Riot API hostnames in Vue components or Nest controllers.

### Platform vs regional routing

- **Platform routes** (for example `na1`, `euw1`, `kr`) — summoner / league / champion-mastery endpoints.
- **Regional routes** (`americas`, `europe`, `asia`, `sea`) — account-v1 and match-v5 endpoints.

Hosts are always constructed as `https://{route}.api.riotgames.com` from validated shared route values. Arbitrary hostnames from user input are rejected.

Examples:

- Ranked / mastery lookup on North America → `na1.api.riotgames.com`
- Account + match history for that player → `americas.api.riotgames.com`

### Out of scope

Mainland Chinese servers (Tencent / WeGame / CN routing aliases) are unsupported.

## Riot API integration (Milestone 4)

The Nest API includes a Riot HTTP transport and `RiotGameDataProvider` behind the shared `GameDataProvider` interface.

### APIs integrated

| API                 | Routing  | Operations used                             |
| ------------------- | -------- | ------------------------------------------- |
| account-v1          | regional | Resolve Riot ID → PUUID / canonical Riot ID |
| summoner-v4         | platform | Summoner profile by PUUID                   |
| league-v4           | platform | Ranked entries by PUUID                     |
| match-v5            | regional | Recent match IDs, match details, timeline   |
| champion-mastery-v4 | platform | Champion mastery by PUUID                   |

### Provider modes

- `RIOT_PROVIDER_MODE=mock` (default when unset) — deterministic local fixtures, no network, no API key required.
- `RIOT_PROVIDER_MODE=real` — live Riot HTTP client. Startup and health checks still do **not** call Riot. Invoking the provider without `RIOT_API_KEY` throws `PROVIDER_NOT_CONFIGURED`.

Server-side configuration (see `apps/api/.env.example`):

```bash
RIOT_API_KEY=your_riot_api_key_here
RIOT_API_TIMEOUT_MS=10000
RIOT_API_MAX_RETRIES=2
RIOT_API_MAX_RETRY_DELAY_MS=5000
RIOT_API_BASE_DOMAIN=api.riotgames.com
RIOT_PROVIDER_MODE=mock
```

Never put Riot keys in Nuxt public runtime config (`NUXT_PUBLIC_*`). Never log the key or `X-Riot-Token`.

### Development keys expire

Riot **development** API keys expire regularly (often daily). If you see HTTP 403:

1. Open the [Riot Developer Portal](https://developer.riotgames.com/)
2. Regenerate / refresh your development key
3. Update `RIOT_API_KEY` in `apps/api/.env` (and worker env if used)
4. Restart only the process that reads that env file

### Manual CLI helpers (explicit only)

These commands never run during tests, builds, seeds, migrations, or `pnpm dev` startup:

```bash
# Resolve one Riot ID (safe fields only)
pnpm riot:resolve --game-name "Example" --tag-line "NA1" --platform na1

# List recent match IDs for a PUUID
pnpm riot:match-ids --puuid "fake-or-real-puuid" --platform na1 --count 5

# Sync champion static data from Data Dragon into Patch + ChampionStaticData (no API key).
# Re-run after champion ability UI so existing READY patches get passive/spell snapshots.
pnpm champions:sync-static --dry-run
pnpm champions:sync-static
pnpm champions:sync-static --json

# Ops-only match bootstrap (not a crawler / not a tracked-player system)
# Dry-run may call Riot for resolve + match ID discovery; never writes DB or enqueues jobs.
pnpm matches:bootstrap-player --game-name "Example" --tag-line "NA1" --platform na1 --dry-run

# Apply: upsert account, sync ranks, paginate queue 420 match IDs, enqueue via existing ingestion pipeline
pnpm matches:bootstrap-player --game-name "Example" --tag-line "NA1" --platform na1 --queue 420 --max-matches 100

# Optional lightweight --wait polls Match/durable job terminal states for IDs from this run only
# (bounded timeout/poll from MATCH_BOOTSTRAP_*). Wait timeout with pending jobs is reported as
# inconclusive smoke and exits 0 so you can retry; definitive smoke failure or finished wait with
# ingestion failures exits 1.
pnpm matches:bootstrap-player --game-name "Example" --tag-line "NA1" --platform na1 --wait --json

# Optional file mode (Zod-validated; sequential by default; bounded --concurrency)
pnpm matches:bootstrap-player --file players.json --concurrency 1 --wait
```

Example `players.json`:

```json
[
  { "gameName": "PlayerOne", "tagLine": "NA1", "platform": "na1" },
  { "gameName": "PlayerTwo", "tagLine": "NA1", "platform": "na1" }
]
```

Ops env (CLI only — not used by the public UI): `MATCH_BOOTSTRAP_DEFAULT_QUEUE_ID`, `MATCH_BOOTSTRAP_DEFAULT_MAX_MATCHES`, `MATCH_BOOTSTRAP_HARD_MAX_MATCHES`, `MATCH_BOOTSTRAP_PAGE_SIZE`, `MATCH_BOOTSTRAP_FILE_MAX_PLAYERS`, `MATCH_BOOTSTRAP_MAX_CONCURRENCY`, `MATCH_BOOTSTRAP_WAIT_TIMEOUT_MS`, `MATCH_BOOTSTRAP_WAIT_POLL_INTERVAL_MS`.

Pipeline smoke after apply+`--wait` checks for ≥1 `ChampionAggregate` with `queueId=420`, known position, and `sampleSize > 0`. The public champion UI still hides stats below `sampleSize ≥ 30` — that floor remains best-effort for bootstrap sessions.

### Population collector (Milestone 9 Task 3 — manual one-shot)

Task 3 adds a **bounded, manually triggered** population collector that selects known ranked players and feeds the existing Task 2 discovery → match-ingestion → champion-aggregation pipeline. It does **not** schedule itself or auto-enroll match participants. Recurring scheduling and bounded participant expansion are **Task 4** (opt-in; see next section).

**Architecture (one-shot only):**

```text
collector:seed-player / optional flag enrollment
  → TrackedPlayer rows
collector:run (manual)
  → claim wave (PostgreSQL FOR UPDATE SKIP LOCKED)
  → shared PlayerMatchDiscoveryService (PlayerAccount mode)
  → MatchIngestionProducer (durable jobs)
  → worker match-ingestion → champion-aggregation
collector:status / collector:audit (read-only)
```

Collector success means **discovery/enqueue orchestration succeeded**, not that downstream ingestion or aggregation has finished. Coverage reporting is an asynchronous **current DB snapshot**, not “this run added N samples.” The public ranking floor (`CHAMPION_AGGREGATION_MIN_SAMPLE`) is unchanged. A player-timeout wrapper does **not** cancel an already-started underlying Riot provider operation.

**Migration / setup:** apply Prisma migrations (`pnpm db:migrate` / `pnpm db:migrate:deploy`). Schema rollback note is under Database commands above (drop `CollectorRun` / `TrackedPlayer` + enums; no PlayerAccount backfill). Task 4 adds additive tables/columns on top of Task 3 — apply the full migration history.

**Commands (root or `apps/api`):**

```bash
# Admin seed (enrollmentSource=ADMIN_SEED on first insert; idempotent)
pnpm collector:seed-player --game-name "Example" --tag-line "NA1" --platform na1
pnpm collector:seed-player --file tracked-players.json --concurrency 1

# Operator status transitions (optional --force clears lease; --reset-failures)
pnpm collector:set-player-status --tracked-player-id <uuid> --status PAUSED

# Read-only eligibility preview (no CollectorRun, no leases, no jobs, no Riot unless sample-discovery)
pnpm collector:run --dry-run --platform na1 --queue 420

# Read-only sample discovery (Riot match-ID list only; no upsert/rank/enqueue/lease)
pnpm collector:run --dry-run --sample-discovery 1 --platform na1 --queue 420 --max-matches 5 --json

# Mutating one-shot run (claim → discover/enqueue → finalize; then coverage snapshot)
pnpm collector:run \
  --platform na1 \
  --queue 420 \
  --batch-size 10 \
  --concurrency 2 \
  --max-matches 20 \
  --max-match-ids 200 \
  --max-enqueue 200 \
  --json

# Read-only ops (Task 3 + Task 4 population/scheduler snapshot)
pnpm collector:status --json
pnpm collector:audit --json
```

Example seed file (`tracked-players.json`):

```json
[
  { "gameName": "ExampleOne", "tagLine": "NA1", "platform": "na1", "priority": 10 },
  { "gameName": "ExampleTwo", "tagLine": "NA1", "platform": "na1" }
]
```

**Exit codes (`collector:run`):** dry-run valid preview → `0`; mutating `COMPLETED` → `0`; `PARTIAL` / `FAILED` → `1`. Coverage unavailable after `COMPLETED` is a warning only (still exit `0`).

**Enrollment flags (default false):**

| Env | Default | Effect when true |
| --- | ------- | ---------------- |
| `COLLECTOR_ENROLL_FROM_BOOTSTRAP` | `false` | Soft-enroll after successful non-dry-run bootstrap account upsert (`BOOTSTRAP`) |
| `COLLECTOR_ENROLL_FROM_SEARCH` | `false` | Soft-enroll after successful product search upsert (`PRODUCT_SEARCH`) |

When false, enrollment is short-circuited before any collector enrollment DB work or extra Riot calls. Enrollment failures never change bootstrap/search success. Unsupported platforms are informational only. `enrollmentSource` is first-source only.

Set `RIOT_PROVIDER_MODE=real` and a valid `RIOT_API_KEY` in `apps/api/.env` before using live Riot data. Champion static sync uses the public Data Dragon CDN only (`DATA_DRAGON_VERSION`, `DATA_DRAGON_SYNC_MIN_CHAMPIONS`, `DATA_DRAGON_SYNC_MAX_RETRIES`).

### Recurring collection + bounded population expansion (Milestone 9 Task 4)

Task 4 adds two **independent, opt-in** autonomous behaviors on top of Task 3:

1. **Optional scheduler** — dedicated Nest CLI process that periodically invokes the same bounded `PopulationCollectorService.runOnce`
2. **Optional bounded participant expansion** — after successful completed match ingestion, enroll a fixed consideration-window of match participants as `TrackedPlayer` rows (`MATCH_PARTICIPANT`)

Both are **disabled by default**. Neither starts on normal API boot (`pnpm dev:api` / `AppModule`) nor on normal worker boot (`pnpm dev:worker`). There is **no** public collector/scheduler HTTP API and **no** Nuxt admin UI. Ranking formulas and `CHAMPION_AGGREGATION_MIN_SAMPLE` are unchanged. Task 4 improves collection coverage over time but does **not** guarantee any champion bucket reaches the ranking floor.

```text
# Scheduler path (opt-in process)
pnpm collector:scheduler
  → PostgreSQL CollectorSchedulerState lease
  → (winner only) BullMQ pending probe
  → PopulationCollectorService.runOnce  (same Task 3 path)
  → release lease

# Expansion path (opt-in worker hook)
match-ingestion COMPLETED
  → expandMatchParticipantsSafe (non-fatal)
  → fixed per-match window → race-safe quota TX → TrackedPlayer
  → newly enrolled players wait for later bounded collector runs
  (no recursive immediate crawl; no Account-v1 N+1)
```

#### Process ownership (scheduler)

| Process | Schedules collection? |
| ------- | --------------------- |
| Normal API boot | **No** |
| Normal worker boot | **No** |
| `pnpm collector:scheduler` | **Yes** — long-running loop |
| `pnpm collector:scheduler-trigger` | One-shot guarded tick |
| `pnpm collector:scheduler-status` | Read-only focused scheduler status |
| `pnpm collector:run` | Manual Task 3 one-shot (independent of scheduler) |
| `pnpm collector:status` / `pnpm collector:audit` | Broader read-only ops (includes Task 4 fields) |

```bash
# Long-running scheduler (only this process owns the loop)
pnpm collector:scheduler

# One-shot guarded tick (same lease/backpressure/cooldown rules)
pnpm collector:scheduler-trigger --json

# Focused read-only scheduler snapshot
pnpm collector:scheduler-status --json
```

`COLLECTOR_SCHEDULER_ENABLED` is re-read from `process.env` **each tick**. Other scheduler knobs are loaded at process bootstrap. Changing `.env` files under a process manager still requires restarting the scheduler process unless you mutate that process’s environment in place. Worker expansion knobs are loaded per expansion-hook invocation from `process.env`; changing on-disk `.env` still requires a worker restart under normal process managers.

#### Lease safety

PostgreSQL `CollectorSchedulerState` singleton (`id='singleton'`) is authoritative. Each tick generates an owner token. Stale owners cannot mutate active owner state (renew / outcome / cooldown / release are all `WHERE leaseOwner = $owner`).

Lease TTL invariant (**strict greater-than** — equality is rejected at config load):

```text
COLLECTOR_SCHEDULER_LEASE_MS
  > ceil(COLLECTOR_SCHEDULE_BATCH_SIZE / COLLECTOR_SCHEDULE_CONCURRENCY)
    * COLLECTOR_PLAYER_TIMEOUT_MS
    + COLLECTOR_SCHEDULER_LEASE_SAFETY_MARGIN_MS
```

Current defaults: `batch=10`, `concurrency=2`, `playerTimeout=10m`, `safetyMargin=5m` → derived minimum **55m**; default lease **60m** (`60m > 55m`).

Local-only tick outcomes (not persisted by losers): `SKIPPED_DISABLED`, `SKIPPED_OVERLAP`. Persisted outcomes (owner only): `TRIGGERED`, `SKIPPED_BACKPRESSURE`, `SKIPPED_COOLDOWN`, `FAILED_TO_START`.

Scheduler `TRIGGERED` means the scheduler successfully invoked the bounded collector run. The `CollectorRun` itself may still finish `COMPLETED` / `PARTIAL` / `FAILED`. It does **not** mean ingestion or aggregation is complete.

#### Backpressure (scheduled path only)

After lease acquisition, the **winning** owner probes BullMQ `match-ingestion` pending count:

```text
pending = waiting + active + delayed
```

Skip when `pending > COLLECTOR_MAX_PENDING_INGESTION_JOBS` (default **500**):

- `pending === 500` → allowed
- `pending === 501` → `SKIPPED_BACKPRESSURE`

Queue probe failure is fail-safe: do **not** trigger collection (`SKIPPED_BACKPRESSURE` / `QUEUE_PROBE_FAILED`). Manual `pnpm collector:run` bypasses scheduler backpressure by default.

#### Rate-limit cooldown

If a scheduled run reports rate-limit stops/failure, the scheduler sets cooldown using configured `COLLECTOR_SCHEDULER_RATE_LIMIT_COOLDOWN_MS` (default **15m**). Observed Riot `Retry-After` is **not** currently exposed on `CollectorRunOnceResult`, so cooldown is the configured duration — not exact Retry-After integration. Later ticks may acquire the lease, observe active cooldown, return `SKIPPED_COOLDOWN`, and release.

#### Participant expansion safety

| Knob | Default |
| ---- | ------- |
| `COLLECTOR_EXPAND_FROM_PARTICIPANTS` | `false` |
| `COLLECTOR_EXPANSION_MAX_DEPTH` | `1` (hard max ≤ 3) |
| `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH` | `3` |
| `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_SOURCE_PLAYER` | `5` |
| `COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_RUN` | `20` |
| `COLLECTOR_EXPANSION_MAX_TRACKED_PLAYERS` | `500` (autonomous MATCH_PARTICIPANT creates only) |
| `COLLECTOR_EXPANSION_QUEUE_ID` | `420` |

Expansion runs only after successful **completed** match ingestion (including already-complete reprocess paths). Incomplete normalized identity is skipped — **no Account-v1 N+1**. There is **no** recursive immediate crawl: newly enrolled players wait for later bounded collector runs.

Enrollment source: `MATCH_PARTICIPANT`. Depth: root explicit enrollment = `0`; participant child = source depth + 1; rediscovery uses minimum depth; hard max depth ≤ 3. Explicit search/bootstrap/seed can root an existing player to depth `0` without changing first `enrollmentSource`.

#### Fixed per-match consideration window

`COLLECTOR_EXPANSION_MAX_NEW_PLAYERS_PER_MATCH` is a **deterministic lifetime consideration-window size**, not “N new players per retry.”

Window ordering uses only stable persisted identity fields:

```text
externalAccountId ASC, participantId ASC
```

Already-tracked candidates remain window occupants. Repeated processing must not slide to later candidates. There is no `MatchExpansion` table. Do not log or dump raw participant identities / PUUIDs in ops output unless necessary.

#### Quota model (race-safe)

The global autonomous cap applies **only** to `MATCH_PARTICIPANT` creates. It does **not** cap total `TrackedPlayer` rows. Explicit `ADMIN_SEED` / `PRODUCT_SEARCH` / `BOOTSTRAP` enrollments do **not** consume or get blocked by the autonomous participant budget.

Reservation order inside one short PostgreSQL transaction:

1. Global `CollectorPopulationBudget`
2. CollectorRun attributed cap (`playersEnrolledFromParticipants`)
3. `CollectorRunSourceQuota`
4. `TrackedPlayer` INSERT

Unique race rolls back **all** reservations. There is no `COUNT(...) < cap` race.

#### Async expansion counters vs Task 3 counters

Task 3 execution counters / status equality are finalized by `runOnce`. Task 4 expansion counters on `CollectorRun` (`participantsConsidered`, `playersEnrolledFromParticipants`, …) are **async post-finalization** and may legally increase after the run is terminal. Do not treat “participant enrolled” as “participant collected,” and do not treat scheduler `TRIGGERED` as ingestion/aggregation complete. `collector:status` labels expansion counters as `ASYNC_POST_FINALIZATION_EXPANSION_METRICS`.

#### Status / audit

`pnpm collector:status` includes total tracked population, depth histogram, enrollment-source counts, autonomous `MATCH_PARTICIPANT` budget usage, async expansion counters, and scheduler config/state snapshot. Scheduler lease ownership is reported as `PRESENT` / `ABSENT` only (no raw owner UUID) — same privacy rule as `collector:scheduler-status`.

`pnpm collector:audit` is **read-only**. It checks depth anomalies, budget drift, impossible counters, scheduler singleton/lease shape, and existing Task 3 invariants. It does **not** repair.

#### Emergency disable

Strongest stop: terminate the `collector:scheduler` process.

Also set independently:

```bash
COLLECTOR_SCHEDULER_ENABLED=false
COLLECTOR_EXPAND_FROM_PARTICIPANTS=false
```

- Scheduler enable is re-read each tick in the running scheduler process.
- Expansion disable is honored on the next expansion-hook invocation once the worker’s `process.env` reflects the change (restart worker after editing `.env`).
- Do not leave a long-running scheduler process up after intentional disable without also stopping the process.

#### Product boundaries

Task 4 adds **no** public collector API and **no** Nuxt admin UI. No frontend behavior is intentionally changed. Ranking sample floor remains unchanged. Reaching floor for a ranking key is an ops coverage outcome, not a Task 4 success criterion.
### Common error interpretations

| Situation                              | Meaning                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 403 / `PROVIDER_FORBIDDEN`             | Key invalid or expired development key — refresh in the portal                                                                             |
| 404 / `RESOURCE_NOT_FOUND`             | Riot ID, summoner, match, or timeline not found for that route                                                                             |
| 429 / `PROVIDER_RATE_LIMITED`          | App/method rate limit — honor `retryAfterSeconds` (workers should reschedule; the HTTP client does not sleep for long Retry-After windows) |
| 5xx / timeout / `PROVIDER_UNAVAILABLE` | Temporary Riot or network failure after bounded GET retries                                                                                |

### What Milestone 4 did **not** do (completed in Milestone 5 where noted)

- ~~No automatic Prisma ingestion of Riot responses~~ → Milestone 5 persists identity, ranks, mastery, and durable ingestion jobs
- ~~No public player-search HTTP controller~~ → Milestone 5
- ~~No frontend player pages~~ → Milestone 5 minimal search UI
- ~~No BullMQ match-ingestion jobs~~ → Milestone 5 produces jobs; Milestone 6 consumes them
- Automated tests never call Riot’s live API (HTTP is mocked)

## Player search (Milestone 5)

Milestones 1–4 exposed only API health in the Nuxt UI because no player-facing backend endpoints existed yet. Milestone 5 replaces that homepage with a minimal Riot ID search interface and keeps health in a compact development-status section.

### Why search is `POST /api/players/search`

Search resolves external Riot data, upserts durable player records, and enqueues match-ingestion work. That is not a safe idempotent GET.

### Architecture

```mermaid
sequenceDiagram
  participant Browser
  participant Nuxt
  participant PlayersController
  participant PlayerSearchService
  participant GameDataProvider
  participant PostgreSQL
  participant BullMQ
  participant PlayerPage

  Browser->>Nuxt: Submit Riot ID search
  Nuxt->>PlayersController: POST /api/players/search
  PlayersController->>PlayerSearchService: search
  PlayerSearchService->>GameDataProvider: resolvePlayer
  PlayerSearchService->>PostgreSQL: upsert Player and aliases
  PlayerSearchService->>GameDataProvider: ranks mastery matchIds
  PlayerSearchService->>PostgreSQL: snapshots and PENDING jobs
  PlayerSearchService->>BullMQ: enqueue INGEST_MATCH
  PlayerSearchService->>PostgreSQL: mark QUEUED
  PlayersController-->>Nuxt: profile plus refresh state
  Nuxt->>PlayerPage: navigate /players/:playerId
```

### Identity, aliases, and snapshots

- PUUID remains the persistent external account identity (`PlayerAccount.externalAccountId`). Public APIs never return it.
- Riot ID changes update the current alias and preserve history; they do not create a new internal `Player`.
- Rank snapshots insert only when meaningful ranked state changes.
- Mastery snapshots skip identical rows inside `PLAYER_MASTERY_SNAPSHOT_MIN_AGE_SECONDS`.

### Match discovery and queues

1. Discover recent match IDs (default queue 420) without fetching match details or timelines.
2. Create durable `IngestionJobRecord` rows as `PENDING` before Redis publication.
3. Publish BullMQ `match-ingestion` / `INGEST_MATCH` jobs with deterministic IDs.
4. Mark durable status `QUEUED` only after BullMQ accepts the job.
5. If Redis fails, rows stay `PENDING` for reconciliation.

```bash
pnpm jobs:status-match-ingestion
pnpm jobs:reconcile-match-ingestion
pnpm player:search:mock --game-name "Example" --tag-line "NA1" --platform na1
```

Match IDs are queued for the worker (Milestone 6). Search/refresh responses return any already-stored match summaries immediately.

### Refresh, cache, and coalescing

- `POST /api/players/:playerId/refresh` re-resolves the stored Riot ID, refreshes secondary data, and queues only missing matches.
- Redis lock + `PLAYER_REFRESH_COOLDOWN_SECONDS` prevent duplicate Riot calls.
- Profile DTOs are cached in Redis (`PLAYER_PROFILE_CACHE_TTL_SECONDS`) and invalidated after writes.
- Read endpoints (`GET` profile/ranks/mastery/matches/refresh-status) use the database/cache only — they never call Riot.

### Mock browser testing

```bash
# Ensure RIOT_PROVIDER_MODE=mock in apps/api/.env
pnpm docker:up
pnpm db:migrate:deploy
pnpm dev
# Open http://127.0.0.1:3000 — search ExamplePlayer#NA1 on NA
# Or: pnpm test:e2e  (uses system Microsoft Edge; no Playwright Chromium download)
```

### Optional real Riot browser testing

```bash
# Set in apps/api/.env only (never Nuxt):
# RIOT_PROVIDER_MODE=real
# RIOT_API_KEY=<your key>
pnpm dev
# Search a real Riot ID on a supported platform
```

## Match ingestion + Data Dragon (Milestone 6)

Milestone 6 finishes the search → queue → worker → match-card loop and enriches mastery/match champions via public Data Dragon (no API key).

### Why mastery used to show only numbers

Mastery snapshots store Riot’s numeric `championId`. Names and icons come from Data Dragon (`versions.json` + `champion.json`), cached in Redis + memory by `DataDragonChampionService` in the API. Failures degrade to `Champion #<id>` without breaking the profile.

### Why matches are queued

Search/refresh discovers match IDs only. Match-v5 details and timelines are fetched by the worker so the HTTP request stays fast and rate limits stay off the request path. The UI polls refresh status + profile while jobs remain queued/active/delayed (5s interval, max 5 minutes), then offers manual refresh.

**Refresh state is ingestion-aware:** discovering match IDs (or syncing ranks/mastery) is not `COMPLETE`. `COMPLETE` means every discovered match is persisted **and linked** to the player, with no queued/active/delayed/pending work left. While jobs run you should see `PROCESSING` or `PARTIAL`.

### You must run the worker

`pnpm dev` starts web, API, **and** worker. If you run API/web alone, jobs stay queued and match cards never appear.

Primary worker command: **`pnpm dev:worker`** (alias: `pnpm worker:dev`).  
Optional smoke-only queue (`league-helper-default`): `pnpm worker:smoke` — not started by normal worker startup.

```bash
pnpm docker:up
pnpm db:migrate:deploy
pnpm --filter @league-helper/shared build
pnpm --filter @league-helper/server-riot build
pnpm dev
# or separately:
# pnpm dev:api
# pnpm dev:worker
# pnpm dev:web
```

### Architecture

```mermaid
sequenceDiagram
  participant Browser
  participant Nuxt
  participant API
  participant DataDragon
  participant PostgreSQL
  participant BullMQ
  participant Worker
  participant Riot

  Browser->>Nuxt: Search Riot ID
  Nuxt->>API: POST /api/players/search
  API->>Riot: resolve + ranks + mastery + matchIds
  API->>PostgreSQL: upsert player snapshots PENDING jobs
  API->>BullMQ: enqueue INGEST_MATCH
  API->>DataDragon: enrich mastery champion metadata
  API-->>Nuxt: profile + refresh counts
  Nuxt->>Browser: player page + processing banner
  loop while queued or active or delayed
    Nuxt->>API: GET refresh-status + profile
    Note over API: GET never calls Riot
  end
  Worker->>BullMQ: claim INGEST_MATCH
  Worker->>PostgreSQL: mark RUNNING
  Worker->>Riot: match-v5 (+ timeline optional)
  Worker->>PostgreSQL: persist match participants metrics COMPLETE
  Worker->>BullMQ: complete job
  Nuxt->>API: poll sees completed matches
  API->>DataDragon: enrich match champion or item icons
  API-->>Nuxt: PublicMatchSummary cards
```

### Ingestion lifecycle and retries

1. Validate job payload → durable `RUNNING`.
2. Skip if match already `COMPLETED`.
3. Fetch/normalize/persist match + teams + participants.
4. Fetch timeline when practical (match can still complete if timeline fails).
5. Compute timeline metrics (gold/CS/XP at 10/15, KP, etc.) → durable `COMPLETED`.
6. Best-effort profile cache invalidation → BullMQ complete.

Retries: typed provider errors; `429` → delayed BullMQ job (not “stuck”); permanent failures → durable `FAILED` / `DEAD_LETTERED`.

### Timeline is optional

Match cards render without timeline metrics. `timelineMetricsAvailable` indicates whether early-game fields are present. Objective-proximity death metrics remain deferred.

### Queue status commands

```bash
pnpm jobs:status-match-ingestion
pnpm jobs:reconcile-match-ingestion
pnpm jobs:retry-match-ingestion
pnpm player:search:mock --game-name "ExamplePlayer" --tag-line "NA1" --platform na1
```

### Existing jobs

Jobs queued before the worker existed remain in Redis/Postgres. Start the worker (and run reconcile if durable rows are stuck `PENDING`) to drain them — no need to re-search unless you want fresh discovery.

### Playwright e2e note

`apps/web` e2e covers mock search → processing banner + no PUUID leak. It does **not** start a full worker drain (too heavy for the default suite). For cards end-to-end, run `pnpm dev` (includes worker) and search `ExamplePlayer#NA1` manually, or rely on API/worker unit tests for mapping and ingestion.

### What Milestone 6 still does **not** do

- ~~Champion aggregates~~ → Milestone 8
- Patch analysis, matchups, or AI coaching
- Polished OP.GG-style profile pages / live game coaching
- Mainland Chinese server support
- Authentication

## Design system + player UI (Milestone 7)

Milestone 7 replaces the temporary development UI with a League-inspired dark design system while preserving the search → profile → ingestion → match-card flow.

### Design tokens

CSS custom properties live in `apps/web/assets/css/main.css` (`--lh-*`):

| Category | Examples                                                                                 |
| -------- | ---------------------------------------------------------------------------------------- |
| Surfaces | `--lh-bg`, `--lh-surface`, `--lh-surface-raised`, `--lh-surface-inset`                   |
| Text     | `--lh-text`, `--lh-text-secondary`, `--lh-muted`                                         |
| Accents  | `--lh-accent` (blue), `--lh-accent-gold`, `--lh-victory` / `--lh-defeat` / `--lh-remake` |
| Layout   | `--lh-max-content`, radii, shadows, transition durations                                 |

Default appearance is dark with Cinzel (display) + Source Sans 3 (body). Focus rings and `prefers-reduced-motion` are supported. Do not scatter arbitrary colors in Vue components — use tokens / utility classes.

### Component structure

```text
apps/web/components/layout/   AppHeader, AppFooter, GlobalPlayerSearch
apps/web/components/player/   PlayerHero, RankedOverview, MasteryShowcase,
                              FeaturedMasteryCard, MatchHistoryToolbar,
                              MatchCard (+ processing banner / skeletons)
apps/web/layouts/default.vue  Persistent shell
```

### Champion imagery

- Square icons and default-skin splash URLs are built **on the API** via `DataDragonChampionService` (`buildChampionIconUrl` / `buildChampionSplashUrl`).
- Public mastery DTOs expose optional `championIconUrl` and `championSplashUrl`.
- Splash path uses the Data Dragon **asset key** and default skin suffix `_0` (example: `…/splash/Tryndamere_0.jpg`). Never stored in PostgreSQL.
- Frontend consumes backend URLs only — it must not reconstruct Data Dragon splash paths.
- Player hero reuses the top mastery splash; featured mastery cards use their own splash. Dark overlays + neutral fallbacks keep text readable when images fail.

### Implemented pages

| Route                | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `/`                  | Product landing + Riot ID search + recent local searches       |
| `/players/:playerId` | Profile hero, ranked overview, mastery showcase, match history |

Champions navigation is enabled in Milestone 8 (`/champions`). Deferred: matchups, patch impact, AI coaching, auth/social.

### Responsive breakpoints

Layouts target roughly **375px**, **768px**, **1280px**, and **1600px**. Match cards stack on narrow viewports; mastery featured cards use a grid / snap carousel. Avoid horizontal page overflow.

### Playwright e2e note

`apps/web` e2e covers mock search → redesigned profile (hero, ranks, mastery, matches), queue filter URL sync, refresh preserving cards, and no horizontal overflow at 375px. API must use `RIOT_PROVIDER_MODE=mock`. Prefer running `pnpm dev` (API + web + worker) before `pnpm test:e2e`.

## Champion aggregates (Milestone 8)

Milestone 8 materializes champion-level aggregate statistics from successfully ingested matches, exposes public champion APIs, and ships Nuxt directory/detail pages. Stats represent **matches collected by League Helper** (primarily via searched players) — not Riot’s global match database.

Design: `docs/superpowers/specs/2026-08-05-milestone-8-champion-aggregates-design.md`  
Plan: `docs/superpowers/plans/2026-08-05-milestone-8-champion-aggregates.md`

### Architecture

Pipeline: Riot match ingestion → `MatchParticipant` storage → champion aggregation worker → `ChampionAggregate` materialization → API → Nuxt `/champions` pages.

Pure math lives in `@league-helper/match-analytics` (no Prisma/Nest/BullMQ). The worker recalculates aggregates incrementally after match ingestion and via rebuild/reconcile CLIs. API reads versioned aggregate rows from **PostgreSQL** (optional Redis response cache with generation invalidation); Nuxt never calls Riot.

```mermaid
sequenceDiagram
  participant Browser
  participant Nuxt
  participant API
  participant PostgreSQL
  participant BullMQ
  participant Worker

  Note over Worker,PostgreSQL: Match already COMPLETE with participants
  Worker->>BullMQ: enqueue RECALCULATE_CHAMPION_AGGREGATES
  Worker->>BullMQ: claim champion aggregation job
  Worker->>PostgreSQL: load eligible participants + rank at ingestion
  Worker->>Worker: accumulate / roll up / derive (match-analytics)
  Worker->>PostgreSQL: upsert ChampionAggregate rows
  Browser->>Nuxt: open /champions or /champions/:key
  Nuxt->>API: GET champion directory / stats (URL filters)
  API->>PostgreSQL: read ChampionAggregate (versioned)
  API-->>Nuxt: DTOs + sample size + disclaimer
  Nuxt->>Browser: directory / detail (no tier-list language)
```

### Analytics dimensions and rollups

Stored dimensions: patch, platform, region, queue, rank tier, position, champion (+ `aggregationVersion` / `sourceNormalizationVersion`).

Default rollup policy:

- Exact dimension rows
- `ALL` rank tier and `ALL` position rollups
- **No** `ALL`×`ALL` (tier × position)
- **No** `ALL` platform / region / queue by default

Formulas (aligned with player UI where applicable): aggregate KDA (`computeAggregateKdaRatio`, same rules as player `computePublicKda`), CS/min, DPM, vision/min, GD@10 / CSD@10 when timeline metrics exist. Win rate uses a Wilson score interval. Sample confidence thresholds default to **30 / 100 / 500** (`INSUFFICIENT` / `LOW` / `MEDIUM` / `HIGH`). Remakes, incomplete matches, and wrong source-normalization versions are excluded from aggregation.

### Data limitations

- Always show sample size; never imply a full-population or balanced global sample.
- Missing timeline metrics surface as unavailable/`null`, never as zero averages.
- Directory ranking requires an **exact** position (role rankings are not mixed across ARAM / non-role queues).

### Rank semantics

`rankTierAtIngestion` comes from the local `RankSnapshot` at ingestion cutoff for queues **420** and **440** only. Other queues follow the UNKNOWN/`null` path. Do **not** claim historical match-time rank.

### Queue handling

Ranked Solo/Duo (420) and Ranked Flex (440) stay separated. ARAM and other non-role queues are not mixed into role rankings. Default queue for stats UI/API is configurable (`CHAMPION_AGGREGATION_DEFAULT_QUEUE_ID`, typically 420).

### Operations (champion aggregate CLIs)

Run from the repo root against your local database. Rebuilds **do not** delete match data.

| Command                               | Purpose                                          |
| ------------------------------------- | ------------------------------------------------ |
| `pnpm aggregates:rebuild-champions`   | Full/partial rebuild of `ChampionAggregate` rows |
| `pnpm aggregates:reconcile-champions` | Enqueue missing / stale recalculation jobs       |
| `pnpm aggregates:status-champions`    | Queue + materialization status snapshot          |
| `pnpm aggregates:audit-champions`     | Consistency / coverage audit                     |
| `pnpm aggregates:audit-rank-coverage` | Rank-at-ingestion coverage audit                 |

Safety:

- `--dry-run` plans work without mutating
- Mutating rebuild requires `--confirm` **or** `AGGREGATES_REBUILD_CHAMPIONS_CONFIRM=YES`
- `--json` writes machine-readable results on **stdout**; human logs go to **stderr**

Example local verify:

```bash
pnpm aggregates:rebuild-champions --dry-run --json
pnpm aggregates:rebuild-champions --confirm
pnpm aggregates:status-champions --json
pnpm aggregates:audit-champions --json
pnpm aggregates:audit-rank-coverage --json
```

Keep `CHAMPION_AGGREGATION_VERSION` and `CHAMPION_AGGREGATION_SOURCE_NORMALIZATION_VERSION` aligned between API and worker.

### API / UI

| Surface         | Path                                    |
| --------------- | --------------------------------------- |
| Directory       | `GET /api/champions`                    |
| Champion        | `GET /api/champions/:championKey`       |
| Champion stats  | `GET /api/champions/:championKey/stats` |
| Ranked table    | `GET /api/champion-stats`               |
| Filter metadata | `GET /api/champion-stats/filters`       |
| Pages           | `/champions`, `/champions/:championKey` |

Filters are URL-authoritative. Copy uses collected-sample wording — no tier-list claims.

### Playwright e2e note

Champions e2e (Task 11) uses **route mocks** for API responses so the suite does not require a seeded DB rebuild. Full DB seed → rebuild → live API e2e remains operational future work. Prefer `pnpm dev` (API + web + worker) for manual UI checks against real aggregates.

### What Milestone 8 still does **not** do

- Champion-versus-champion matchups / counters
- AI coaching / player-specific champion coaching
- Patch-impact causality or patch-note ingestion
- Full-population / global ladder crawling
- Advanced Data Dragon sync (items/runes/full spell text); champion roster sync is available via `pnpm champions:sync-static`
- Authentication

## Notes

- `RIOT_API_KEY` stays in backend/worker env only. Never use a `NUXT_PUBLIC_` prefix. Never log the value.
- Champion AI insights are **off by default** (`AI_ENABLED=false`). For local Ollama: `ollama pull qwen2.5:7b` then `ollama serve`; set `AI_ENABLED=true` (and optionally `AI_MODEL`) in `apps/api/.env` and `apps/worker/.env`. Leave `AI_API_KEY` empty for local Ollama. Do not use `NUXT_PUBLIC_*` for any AI secret.
- `GET /api/champions/:championKey/insights` uses the same filters as builds and requires `position`. AI copy is supplemental; collected-sample stats remain the source of truth. Player-specific AI coaching is still deferred.
- Offline eval: `pnpm ai:eval`. Live eval: `pnpm ai:eval -- --live` (requires `AI_ENABLED=true`; docs default model `qwen2.5:7b`).
- Prisma models are persistence internals — do not expose them directly as public API DTOs.
- Frontend requires only `NUXT_PUBLIC_API_BASE` (default `http://localhost:3001`).
