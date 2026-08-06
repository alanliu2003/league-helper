# Milestone 9 Task 2 — Match Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `pnpm matches:bootstrap-player` (single Riot ID + optional `--file`) that paginates ranked match discovery and enqueues the **existing** match-ingestion pipeline, with dry-run, lightweight `--wait`, and aggregate smoke validation.

**Architecture:** Thin CLI in `apps/api` → bootstrap core → minimal shared helpers (resolve, paginated discovery, enqueue via existing producer/durable jobs). No second ingestion pipeline. No refresh refactor. Spec: `docs/superpowers/specs/2026-08-06-milestone-9-task-2-match-bootstrap-design.md`.

**Tech Stack:** TypeScript, Nest application context (same as `player:search:mock`), Prisma, BullMQ producer, Zod, Vitest, `@league-helper/server-riot`

**Plan decisions (locked):**

1. Dry-run may call Riot for resolve + match ID discovery; must not write DB, create durable jobs, or mutate ingestion state.
2. Extract only: paginated discovery helper + shared enqueue helper used by search + bootstrap. Do not refactor `PlayerRefreshService`.
3. `--wait` only polls/summarizes existing durable job / match statuses for IDs from this run.
4. Aggregate smoke: ≥1 `ChampionAggregate` with `queueId=420`, known position (not `ALL` / not `UNKNOWN`), `sampleSize > 0`.
5. `--file` sequential by default; `--concurrency` optional and hard-capped.
6. Do not commit unless the user explicitly asks.

---

## File structure

### Create

```text
apps/api/src/features/players/bootstrap/bootstrap-player.config.ts
apps/api/src/features/players/bootstrap/bootstrap-player.types.ts
apps/api/src/features/players/bootstrap/bootstrap-player.args.ts
apps/api/src/features/players/bootstrap/paginate-match-ids.ts
apps/api/src/features/players/bootstrap/enqueue-discovered-matches.ts
apps/api/src/features/players/bootstrap/bootstrap-player-core.ts
apps/api/src/features/players/bootstrap/bootstrap-verify.ts
apps/api/src/features/players/bootstrap/cli-output.ts
apps/api/src/features/players/cli/bootstrap-player.ts
apps/api/src/features/players/bootstrap/*.test.ts
```

### Modify

```text
apps/api/src/features/players/player-search.service.ts   # call extracted enqueue helper; keep refresh untouched
apps/api/package.json                                    # matches:bootstrap-player
package.json                                             # root proxy
.env.example
apps/api/.env.example
README.md                                                # ops section
```

### Do not modify

```text
Match / MatchParticipant / ChampionAggregate schemas
Worker aggregation formulas
PlayerRefreshService cooldown/lock behavior
Classic champion visibility filter
Frontend
```

---

### Task 1: Config, types, args, file schema

**Files:**
- Create: `apps/api/src/features/players/bootstrap/bootstrap-player.config.ts`
- Create: `apps/api/src/features/players/bootstrap/bootstrap-player.types.ts`
- Create: `apps/api/src/features/players/bootstrap/bootstrap-player.args.ts`
- Create: `apps/api/src/features/players/bootstrap/bootstrap-player.args.test.ts`
- Create: `apps/api/src/features/players/bootstrap/cli-output.ts`
- Modify: `.env.example`, `apps/api/.env.example`

- [x] **Step 1: Write failing args tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseBootstrapArgs, BootstrapPlayersFileSchema } from './bootstrap-player.args';

describe('parseBootstrapArgs', () => {
  it('parses single-player mode with defaults', () => {
    const args = parseBootstrapArgs([
      '--game-name', 'A',
      '--tag-line', 'NA1',
      '--platform', 'na1',
    ]);
    expect(args.mode).toBe('single');
    expect(args.queueId).toBe(420);
    expect(args.maxMatches).toBe(100);
    expect(args.dryRun).toBe(false);
    expect(args.concurrency).toBe(1);
  });

  it('rejects mixing --file with --game-name', () => {
    expect(() =>
      parseBootstrapArgs(['--file', 'p.json', '--game-name', 'A', '--tag-line', 'NA1', '--platform', 'na1']),
    ).toThrow(/mutually exclusive|either/i);
  });

  it('parses --file mode', () => {
    const args = parseBootstrapArgs(['--file', 'players.json', '--dry-run']);
    expect(args.mode).toBe('file');
    expect(args.filePath).toBe('players.json');
    expect(args.dryRun).toBe(true);
  });

  it('validates players.json schema', () => {
    const parsed = BootstrapPlayersFileSchema.parse([
      { gameName: 'PlayerOne', tagLine: 'NA1', platform: 'na1' },
    ]);
    expect(parsed).toHaveLength(1);
  });
});
```

- [x] **Step 2: Implement config + args**

Defaults from env:

```ts
export type MatchBootstrapConfig = {
  defaultQueueId: number; // 420
  defaultMaxMatches: number; // 100
  hardMaxMatches: number; // 500
  pageSize: number; // 100
  fileMaxPlayers: number; // 25
  maxConcurrency: number; // 3
  waitTimeoutMs: number; // e.g. 120_000
  waitPollIntervalMs: number; // e.g. 2_000
};
```

Args result shape:

```ts
export type BootstrapPlayerTarget = {
  gameName: string;
  tagLine: string;
  platform: string;
};

export type BootstrapCliArgs = {
  mode: 'single' | 'file';
  players: BootstrapPlayerTarget[]; // length 1 for single; filled after file load in CLI
  filePath?: string;
  queueId: number;
  maxMatches: number;
  dryRun: boolean;
  json: boolean;
  wait: boolean;
  concurrency: number;
};
```

`cli-output.ts`: copy pattern from champion static sync (`cliLog` stderr, `writeJsonStdout`, `reportCliFailure`).

Env examples:

```env
MATCH_BOOTSTRAP_DEFAULT_QUEUE_ID=420
MATCH_BOOTSTRAP_DEFAULT_MAX_MATCHES=100
MATCH_BOOTSTRAP_HARD_MAX_MATCHES=500
MATCH_BOOTSTRAP_PAGE_SIZE=100
MATCH_BOOTSTRAP_FILE_MAX_PLAYERS=25
MATCH_BOOTSTRAP_MAX_CONCURRENCY=3
MATCH_BOOTSTRAP_WAIT_TIMEOUT_MS=120000
MATCH_BOOTSTRAP_WAIT_POLL_INTERVAL_MS=2000
```

- [x] **Step 3: Run args tests — expect PASS**

```bash
pnpm --filter @league-helper/api exec vitest run src/features/players/bootstrap/bootstrap-player.args.test.ts
```

---

### Task 2: Paginated match discovery helper

**Files:**
- Create: `apps/api/src/features/players/bootstrap/paginate-match-ids.ts`
- Create: `apps/api/src/features/players/bootstrap/paginate-match-ids.test.ts`

- [x] **Step 1: Write failing pagination tests**

Injectable `getRecentMatchIds(account, { queue?, start?, count? })`.

Cases:

1. Single page when `maxMatches ≤ pageSize`
2. Multiple pages until `maxMatches`
3. Stops early when a page returns fewer than requested
4. Dedupes overlapping IDs if provider returns overlap
5. Passes `queue` through on every page

- [x] **Step 2: Implement**

```ts
export async function paginateRecentMatchIds(input: {
  getRecentMatchIds: (
    account: ProviderAccount,
    options: { queue?: number; start?: number; count?: number },
  ) => Promise<string[]>;
  account: ProviderAccount;
  queueId: number;
  maxMatches: number;
  pageSize: number; // ≤ 100
}): Promise<string[]> {
  // loop start = 0, pageSize, ... until maxMatches or short page
}
```

- [x] **Step 3: Run tests — expect PASS**

---

### Task 3: Extract enqueue helper (minimal; reuse by search)

**Files:**
- Create: `apps/api/src/features/players/bootstrap/enqueue-discovered-matches.ts`
- Create: `apps/api/src/features/players/bootstrap/enqueue-discovered-matches.test.ts`
- Modify: `apps/api/src/features/players/player-search.service.ts`

- [x] **Step 1: Move logic**

Cut `PlayerSearchService.enqueueDiscoveredMatches` body into:

```ts
export async function enqueueDiscoveredMatches(deps: EnqueueDiscoveredMatchesDeps, input: {
  account: PlayerAccount;
  discoveredMatchIds: string[];
  correlationId: string;
}): Promise<PlayerSafeWarning[]>
```

Deps: matches repo, ingestionJobs repo, producer, config (`matchIngestionJobAttempts`), logger, cache invalidate — same collaborators search already has.

`PlayerSearchService` becomes a thin caller of this function (behavior unchanged).

- [x] **Step 2: Unit test with fakes**

- Skips linked COMPLETED
- Skips live BullMQ waiting/active/delayed
- Creates durable job + calls `producer.enqueueMatch` for new IDs
- Dry-run path is **not** in this helper (bootstrap core simply does not call it)

- [x] **Step 3: Run player-search related unit/integration tests still green**

```bash
pnpm --filter @league-helper/api exec vitest run src/features/players
```

---

### Task 4: Bootstrap core — single player (dry-run + apply)

**Files:**
- Create: `apps/api/src/features/players/bootstrap/bootstrap-player-core.ts`
- Create: `apps/api/src/features/players/bootstrap/bootstrap-player-core.test.ts`

- [x] **Step 1: Define result types**

```ts
export type BootstrapPlayerResult = {
  ok: boolean;
  gameName: string;
  tagLine: string;
  platform: string;
  dryRun: boolean;
  discoveredMatchCount: number;
  wouldEnqueueCount?: number; // dry-run estimate optional
  enqueuedCount: number;
  skippedAlreadyCompleteCount: number;
  error?: string;
  externalMatchIds: string[]; // for --wait summary; omit PUUID from reports
};

export type BootstrapRunResult = {
  ok: boolean;
  dryRun: boolean;
  players: BootstrapPlayerResult[];
  totals: {
    players: number;
    playersFailed: number;
    discoveredMatchCount: number;
    enqueuedCount: number;
  };
  waitSummary?: WaitSummary;
  aggregateSmoke?: AggregateSmokeResult;
  error?: string;
};
```

- [x] **Step 2: Dry-run tests**

Given mocked Riot resolve + paginated IDs:

- Calls Riot discover
- Does **not** call: account upsert, rank insert, `enqueueDiscoveredMatches`, producer, ingestionJobs.create
- Returns discovered counts

- [x] **Step 3: Apply tests**

- Upserts/resolves account via existing account repository path (same as search)
- Syncs ranks (reuse search’s rank insert pattern or call a tiny internal helper — **not** full `syncPlayerData` if that forces non-paginated discovery; prefer bootstrap-owned apply steps)
- Paginates IDs with queue + maxMatches
- Calls `enqueueDiscoveredMatches`
- Second apply with all COMPLETED → enqueuedCount 0

**Important:** Do not call `PlayerSearchService.syncPlayerData` as-is if it only fetches one page without `start`. Bootstrap owns pagination via `paginateRecentMatchIds`.

Apply sequence:

1. `resolveRiotId` (Riot)
2. Upsert `PlayerAccount` (existing repo)
3. Fetch/insert rank snapshots (existing repo pattern from search)
4. `paginateRecentMatchIds`
5. `enqueueDiscoveredMatches`
6. Return per-player result

Skip mastery sync in bootstrap (YAGNI for aggregate validation).

- [x] **Step 4: Implement core + pass tests**

---

### Task 5: File mode + concurrency

**Files:**
- Modify: `bootstrap-player-core.ts`, tests

- [x] **Step 1: Tests**

1. Loads N players; processes sequential by default
2. Player 2 fails resolve → player 1 still `ok`; rollup `ok=false`; exit semantics documented
3. `--concurrency 2` runs with bound (fake delay + max in-flight assertion)
4. Rejects file longer than `fileMaxPlayers`

- [x] **Step 2: Implement**

```ts
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]>
```

Default concurrency `1`. Cap with `Math.min(args.concurrency, config.maxConcurrency)`.

---

### Task 6: Lightweight `--wait` + aggregate smoke verify

**Files:**
- Create: `apps/api/src/features/players/bootstrap/bootstrap-verify.ts`
- Create: `apps/api/src/features/players/bootstrap/bootstrap-verify.test.ts`

- [x] **Step 1: Wait summary (no new monitoring system)**

Poll Prisma only (and optionally producer.getJobStates if already available):

- Input: list of `externalMatchId`s from this run + provider
- Loop until timeout or all terminal (`Match.ingestionStatus` COMPLETED/FAILED/SKIPPED, or durable job FAILED/COMPLETED)
- Return counts: `{ completed, failed, pending, skipped, timedOut }`

Do not invent Redis dashboards, webhooks, or worker changes.

- [x] **Step 2: Aggregate smoke**

```ts
import {
  ALL_POSITION_SENTINEL,
  UNKNOWN_POSITION_SENTINEL,
} from '@league-helper/match-analytics';

export async function checkAggregateSmoke(prisma: PrismaClient): Promise<{
  ok: boolean;
  row?: { championId: number; teamPosition: string; sampleSize: number; queueId: number };
}> {
  const row = await prisma.championAggregate.findFirst({
    where: {
      queueId: 420,
      sampleSize: { gt: 0 },
      teamPosition: { notIn: [ALL_POSITION_SENTINEL, UNKNOWN_POSITION_SENTINEL, ''] },
    },
    select: { championId: true, teamPosition: true, sampleSize: true, queueId: true },
  });
  return { ok: row !== null, row: row ?? undefined };
}
```

- [x] **Step 3: Wire into core**

- `--wait`: after apply (not dry-run), run wait summary
- After apply (and after wait if set): run aggregate smoke; include in report
- Smoke failure → `ok: false` / exit 1 **only when** apply was requested and workers had a chance — if `--wait` timed out with pending jobs, report smoke as `skipped` or `failed` with clear reason (prefer: run smoke always; if no row yet, `ok: false` with message “no ChampionAggregate sample yet — ensure worker ran / aggregates:reconcile”)

Manual ops note: smoke may fail until worker finishes; `--wait` improves odds.

---

### Task 7: Thin CLI + scripts + README

**Files:**
- Create: `apps/api/src/features/players/cli/bootstrap-player.ts`
- Modify: `apps/api/package.json`, root `package.json`, `README.md`

- [x] **Step 1: CLI entry**

Use `NestFactory.createApplicationContext(AppModule)` like `player-search-mock.ts` to obtain:

- Riot game data provider (or existing tokens)
- Account/rank/match/ingestion repos
- `MatchIngestionProducer`
- `PrismaService`

Flow:

1. `loadMatchBootstrapConfig` + `parseBootstrapArgs`
2. If `--file`: read + Zod parse; enforce max players
3. `bootstrapPlayers({ ... })`
4. Print JSON or text; `exitCode = result.ok ? 0 : 1`

Never print PUUID / API keys.

- [x] **Step 2: Scripts**

```json
"matches:bootstrap-player": "tsx src/features/players/cli/bootstrap-player.ts"
```

Root proxy: `pnpm --filter @league-helper/api matches:bootstrap-player`

- [x] **Step 3: README ops examples**

```bash
pnpm matches:bootstrap-player --game-name "X" --tag-line "NA1" --platform na1 --dry-run
pnpm matches:bootstrap-player --game-name "X" --tag-line "NA1" --platform na1 --queue 420 --max-matches 100 --wait
pnpm matches:bootstrap-player --file players.json --concurrency 1
```

---

### Task 8: Verification suite

- [x] **Step 1: Unit tests**

```bash
pnpm --filter @league-helper/api exec vitest run src/features/players/bootstrap
pnpm --filter @league-helper/api exec vitest run src/features/players
```

- [x] **Step 2: Repo gates**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [x] **Step 3: Manual ops (local, real key)**

1. Ensure API worker running (`pnpm dev` or worker separately)
2. Dry-run one player
3. Apply one player with `--wait`
4. Optional `--file` with 2–3 players
5. Confirm smoke: `queueId=420`, known position, `sampleSize > 0`
6. Spot-check `/champions` + Ahri detail

- [x] **Step 4: Final report**

Files changed, CLI examples, tests, verification results, remaining limitations (sampleSize≥30 may still fail), commit hash only if user requested commit.

---

## Spec coverage checklist

| Spec item | Task |
| --------- | ---- |
| Admin CLI single ID | 4, 7 |
| `--file` list | 5, 7 |
| Default queue 420 + pagination | 2, 4 |
| Dry-run Riot OK / no writes | 4 |
| Minimal extract resolve/discover/enqueue | 2, 3 |
| No refresh refactor | constraint |
| No second ingest pipeline | 3, 4 |
| Lightweight `--wait` | 6 |
| Aggregate smoke > 0 | 6 |
| Sequential default / bounded concurrency | 5 |
| Quality reporting | 6 |
| Env + README | 1, 7 |

---

## Remaining limitations (document in report)

- Not a global sample of League
- UI stats still need `sampleSize ≥ 30`
- Rank UNKNOWN for participants never searched
- Smoke can lag until workers process jobs unless `--wait` used
)
