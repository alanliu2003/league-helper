# League Helper

League of Legends analytics and AI coaching monorepo.

> Temporary product name. Final branding TBD.

## Workspace layout

- `apps/web` — Nuxt frontend (TypeScript strict, Tailwind CSS)
- `apps/api` — NestJS REST API with Prisma / PostgreSQL
- `apps/worker` — BullMQ background worker
- `packages/shared` — shared types, Zod schemas, constants
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

Safe local reset (destroys local Docker volumes):

```bash
pnpm docker:down
docker compose down -v
pnpm docker:up
pnpm db:migrate
pnpm db:seed
```

Integration tests use a separate schema:

```text
TEST_DATABASE_URL=postgresql://league:league@localhost:5432/league_helper?schema=league_helper_test
```

Do not point destructive tests at `schema=public`.

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
```

Set `RIOT_PROVIDER_MODE=real` and a valid `RIOT_API_KEY` in `apps/api/.env` before using live data.

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

- Champion aggregates, patch analysis, matchups, or AI coaching
- Polished OP.GG-style profile pages / live game coaching
- Mainland Chinese server support
- Authentication

## Notes

- `RIOT_API_KEY` stays in backend/worker env only. Never use a `NUXT_PUBLIC_` prefix. Never log the value.
- AI coaching generation is **not** implemented yet.
- Prisma models are persistence internals — do not expose them directly as public API DTOs.
- Frontend requires only `NUXT_PUBLIC_API_BASE` (default `http://localhost:3001`).
