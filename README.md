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

### What this milestone does **not** do

- No automatic Prisma ingestion of Riot responses
- No public player-search HTTP controller
- No frontend player pages
- No BullMQ match-ingestion jobs
- Automated tests never call Riot’s live API (HTTP is mocked)

## Notes

- `RIOT_API_KEY` stays in backend/worker env only. Never use a `NUXT_PUBLIC_` prefix. Never log the value.
- AI coaching generation is **not** implemented yet.
- Prisma models are persistence internals — do not expose them directly as public API DTOs.
