# Milestone 6 Design: Match Ingestion Worker + Data Dragon

**Approved architecture:** Option C as a clean first stage toward Option A.

## Goals

1. Resolve champion IDs to names/icons via public Data Dragon (no API key).
2. Consume BullMQ `match-ingestion` / `INGEST_MATCH` jobs and persist Match-v5 + timeline metrics.
3. Surface stored match summaries on the player page with bounded polling.

## Package boundaries

### `packages/server-riot` (new, server-only)

Framework-independent Riot integration shared by API and worker:

- HTTP client, Zod schemas/DTOs, `RiotGameDataProvider`, mock fixtures
- Retry/backoff, rate-limit + response-metadata parsing, Riot-specific errors
- Framework-independent config types + `loadRiotConfig`

Not exposed to `apps/web`.

### Remain in `apps/api`

- Nest `RiotModule`, DI tokens/factories, config adapters
- Controllers, player orchestration, DTO mapping, Prisma repositories
- `DataDragonChampionService` (API-facing; uses Redis + in-memory cache)

### Remain in `apps/worker`

- BullMQ startup, match-ingestion processor
- Prisma Client lifecycle, normalization orchestration, persistence transactions
- Cache invalidation (best-effort)

### Explicit non-goals

- No `packages/server-core`
- Worker must not import from `apps/api`
- No generic Prisma repository package
- No champion aggregates, patch analysis, matchups, or AI

## Data Dragon

- Fetch versions + `champion.json`; map by numeric key and string id
- Redis + in-memory cache with configurable TTL
- Failures degrade to `Champion #<id>` without breaking profiles
- Frontend-safe champion DTO from API only (no Vue-side URL construction)

## Match ingestion lifecycle

Validate payload → mark durable RUNNING → skip if match complete → fetch/normalize/persist match+teams+participants → fetch timeline (optional for COMPLETE) → compute metrics → mark COMPLETE → invalidate cache → BullMQ complete.

Retries: typed provider errors; 429 → delayed job; permanent failures → durable FAILED/DEAD_LETTERED.

## Timeline metrics (v1)

Gold/CS/XP at 10 and 15; role-opponent diffs when unambiguous; deaths before 10 and 10–20; skill order; first completed item (Data Dragon item metadata when available); kill participation. Objective-proximity deaths deferred (`deathsBeforeObjectives` null).

## Frontend

- Mastery: icon, name, level, points, last played
- Matches: cards as jobs complete; processing banner while queued/active/delayed; poll 5s, max 5 minutes
