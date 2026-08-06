# Milestone 9 Task 1 — Champion Static Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `pnpm champions:sync-static` so Data Dragon champion metadata is validated and upserted into `Patch` + `ChampionStaticData`, activating a full roster for `/champions` without schema migration or frontend Data Dragon calls.

**Architecture:** Thin CLI in `apps/api` calls reusable sync core: fetch (timeout/retry) → Zod validate + min-count gate → map identities → dry-run compare or single Prisma transaction (upsert patch/champions, activate, demote previous). Icon/splash URLs remain computed at read time. Spec: `docs/superpowers/specs/2026-08-06-milestone-9-task-1-champion-static-sync-design.md`.

**Tech Stack:** TypeScript, Zod, Prisma, Vitest, injectable `fetch`, existing Data Dragon URL builders, pnpm scripts

**Plan decisions (locked):**

1. No Prisma migration; never write sync intermediate `PENDING`.
2. `championKey` = DDragon `id`; `championId` = parsed `key` integer; never infer.
3. Persist consumer fields + minimal required JSON placeholders; `rawPayload` stays null.
4. `DATA_DRAGON_SYNC_MIN_CHAMPIONS` default `100` blocks tiny/malformed payloads before activation.
5. Commits only when the user explicitly asks (do not auto-commit during implementation unless requested).

---

## File structure (create / modify)

### Create

```text
apps/api/src/integrations/data-dragon/sync/sync-champion-static.types.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.config.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.mapper.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.fetch.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static-core.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.args.ts
apps/api/src/integrations/data-dragon/sync/cli-output.ts
apps/api/src/integrations/data-dragon/cli/sync-champion-static.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.mapper.test.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.fetch.test.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static-core.test.ts
apps/api/src/integrations/data-dragon/sync/sync-champion-static.config.test.ts
```

### Modify

```text
apps/api/package.json                          # champions:sync-static script
package.json                                   # root proxy script
.env.example                                   # DATA_DRAGON_VERSION + sync knobs
apps/api/.env.example                          # same
README.md                                      # short ops note for champions:sync-static (if README already documents ddragon CLI)
```

### Do not modify

```text
Match / MatchParticipant / ChampionAggregate models
apps/web Data Dragon URL construction
Worker aggregation pipeline
Prisma schema (no migration)
```

---

### Task 1: Sync Zod types + mapper (identity, URLs, version)

**Files:**
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.types.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.mapper.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.mapper.test.ts`

- [ ] **Step 1: Write failing mapper tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  mapDataDragonChampionEntry,
  normalizeMajorMinor,
  buildChampionIconUrl,
  buildChampionSplashUrl,
} from './sync-champion-static.mapper';
import { parseChampionStaticFile } from './sync-champion-static.types';

describe('sync-champion-static.mapper', () => {
  it('maps championKey from Data Dragon id and championId from numeric key', () => {
    const row = mapDataDragonChampionEntry({
      id: 'DrMundo',
      key: '36',
      name: 'Dr. Mundo',
      title: 'the Madman of Zaun',
      tags: ['Fighter', 'Tank'],
      image: { full: 'DrMundo.png' },
      stats: { hp: 600 },
    });
    expect(row.championKey).toBe('DrMundo');
    expect(row.championId).toBe(36);
    expect(row.name).toBe('Dr. Mundo');
    expect(row.title).toBe('the Madman of Zaun');
    expect(row.tags).toEqual(['Fighter', 'Tank']);
    expect(row.imageData).toEqual({ full: 'DrMundo.png' });
    expect(row.baseStats).toEqual({ hp: 600 });
    expect(row.passive).toEqual({});
    expect(row.spells).toEqual([]);
  });

  it('rejects non-numeric key instead of inferring', () => {
    expect(() =>
      mapDataDragonChampionEntry({
        id: 'Ahri',
        key: 'Ahri',
        name: 'Ahri',
        title: 'the Nine-Tailed Fox',
        tags: ['Mage'],
      }),
    ).toThrow(/numeric/i);
  });

  it('builds icon and splash URLs from championKey', () => {
    expect(buildChampionIconUrl('MissFortune', '16.10.1')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.10.1/img/champion/MissFortune.png',
    );
    expect(buildChampionSplashUrl('MissFortune')).toBe(
      'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/MissFortune_0.jpg',
    );
  });

  it('normalizes major.minor from Data Dragon version', () => {
    expect(normalizeMajorMinor('16.10.1')).toBe('16.10');
    expect(normalizeMajorMinor('14.1.1')).toBe('14.1');
  });

  it('parses champion.json payload', () => {
    const file = parseChampionStaticFile({
      version: '16.10.1',
      data: {
        Ahri: {
          id: 'Ahri',
          key: '103',
          name: 'Ahri',
          title: 'the Nine-Tailed Fox',
          tags: ['Mage', 'Assassin'],
          image: { full: 'Ahri.png' },
          stats: {},
        },
      },
    });
    expect(file.version).toBe('16.10.1');
    expect(Object.keys(file.data)).toEqual(['Ahri']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @league-helper/api exec vitest run src/integrations/data-dragon/sync/sync-champion-static.mapper.test.ts
```

Expected: FAIL (modules missing)

- [ ] **Step 3: Implement types + mapper**

`sync-champion-static.types.ts`:

```ts
import { z } from 'zod';

export const SyncDataDragonChampionEntrySchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  image: z.record(z.unknown()).optional(),
  stats: z.record(z.unknown()).optional(),
});

export const SyncDataDragonChampionFileSchema = z.object({
  type: z.string().optional(),
  version: z.string().min(1),
  data: z.record(z.string(), SyncDataDragonChampionEntrySchema).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'champion data must not be empty' },
  ),
});

export type SyncDataDragonChampionEntry = z.infer<typeof SyncDataDragonChampionEntrySchema>;
export type SyncDataDragonChampionFile = z.infer<typeof SyncDataDragonChampionFileSchema>;

export function parseChampionStaticFile(input: unknown): SyncDataDragonChampionFile {
  return SyncDataDragonChampionFileSchema.parse(input);
}

export type MappedChampionStaticRow = {
  championId: number;
  championKey: string;
  name: string;
  title: string;
  tags: string[];
  baseStats: Record<string, unknown>;
  passive: Record<string, unknown>;
  spells: unknown[];
  imageData: Record<string, unknown>;
};
```

`sync-champion-static.mapper.ts`:

```ts
import type { MappedChampionStaticRow, SyncDataDragonChampionEntry } from './sync-champion-static.types';

const BASE_URL = 'https://ddragon.leagueoflegends.com';

export function mapDataDragonChampionEntry(
  entry: SyncDataDragonChampionEntry,
): MappedChampionStaticRow {
  if (!/^\d+$/.test(entry.key)) {
    throw new Error(`Data Dragon key must be a numeric string; received ${entry.key}`);
  }
  const championId = Number.parseInt(entry.key, 10);
  if (!Number.isInteger(championId) || championId < 0) {
    throw new Error(`Failed to parse championId from key ${entry.key}`);
  }
  return {
    championId,
    championKey: entry.id,
    name: entry.name,
    title: entry.title,
    tags: entry.tags ?? [],
    baseStats: entry.stats ?? {},
    passive: {},
    spells: [],
    imageData: entry.image ?? {},
  };
}

export function normalizeMajorMinor(version: string): string {
  const parts = version.trim().split('.');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Cannot derive normalizedMajorMinor from version ${version}`);
  }
  return `${parts[0]}.${parts[1]}`;
}

export function buildChampionIconUrl(championKey: string, version: string): string {
  const key = championKey.trim();
  const ver = version.trim();
  if (!key || !ver) {
    throw new Error('championKey and version are required to build an icon URL');
  }
  return `${BASE_URL}/cdn/${encodeURIComponent(ver)}/img/champion/${encodeURIComponent(key)}.png`;
}

export function buildChampionSplashUrl(championKey: string): string {
  const key = championKey.trim();
  if (!key) {
    throw new Error('championKey is required to build a splash URL');
  }
  return `${BASE_URL}/cdn/img/champion/splash/${encodeURIComponent(key)}_0.jpg`;
}
```

Keep URL path format identical to `DataDragonChampionService` builders.

- [ ] **Step 4: Run mapper tests — expect PASS**

```bash
pnpm --filter @league-helper/api exec vitest run src/integrations/data-dragon/sync/sync-champion-static.mapper.test.ts
```

---

### Task 2: Sync config

**Files:**
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.config.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.config.test.ts`
- Modify: `.env.example`, `apps/api/.env.example`

- [ ] **Step 1: Write config tests**

```ts
import { describe, expect, it } from 'vitest';
import { loadChampionStaticSyncConfig } from './sync-champion-static.config';

describe('loadChampionStaticSyncConfig', () => {
  it('defaults version to latest and min champions to 100', () => {
    const cfg = loadChampionStaticSyncConfig({});
    expect(cfg.version).toBe('latest');
    expect(cfg.minChampions).toBe(100);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.baseUrl).toBe('https://ddragon.leagueoflegends.com');
  });

  it('accepts pinned DATA_DRAGON_VERSION', () => {
    const cfg = loadChampionStaticSyncConfig({ DATA_DRAGON_VERSION: '16.10.1' });
    expect(cfg.version).toBe('16.10.1');
  });
});
```

- [ ] **Step 2: Implement config loader**

Reuse locale/timeout parsing patterns from `loadDataDragonConfig` (import shared helpers or duplicate bounded-int parsing locally to avoid breaking enrichment config API).

```ts
export type ChampionStaticSyncConfig = {
  locale: string;
  requestTimeoutMs: number;
  baseUrl: string;
  version: string; // 'latest' or pinned
  minChampions: number;
  maxRetries: number;
  maxRetryDelayMs: number;
};
```

Defaults: `version='latest'`, `minChampions=100`, `maxRetries=2`, `maxRetryDelayMs=5000`, locale/timeout from existing Data Dragon env vars, `baseUrl` hard-coded approved CDN.

- [ ] **Step 3: Update env examples**

Add under Data Dragon section:

```env
DATA_DRAGON_VERSION=latest
DATA_DRAGON_SYNC_MIN_CHAMPIONS=100
DATA_DRAGON_SYNC_MAX_RETRIES=2
```

- [ ] **Step 4: Run config tests — expect PASS**

---

### Task 3: Fetch with timeout + retry

**Files:**
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.fetch.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.fetch.test.ts`

- [ ] **Step 1: Write failing fetch tests**

Cover:

1. Successful versions + champion.json fetch
2. Invalid JSON / Zod rejection
3. Timeout → retryable then fail after budget
4. 503 then success on retry
5. Non-retryable 404 fails immediately

Use injectable `fetchFn` and `sleepFn` (no real timers/network).

Reuse `decideRetry` / `computeRetryDelayMs` from `@league-helper/server-riot` for retry decisions (GET only; no Riot API key headers).

- [ ] **Step 2: Implement fetch module**

Public API sketch:

```ts
export type SyncFetchDeps = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
};

export async function resolveDataDragonVersion(
  config: ChampionStaticSyncConfig,
  deps?: SyncFetchDeps,
): Promise<string>;

export async function fetchChampionStaticFile(
  config: ChampionStaticSyncConfig,
  version: string,
  deps?: SyncFetchDeps,
): Promise<SyncDataDragonChampionFile>;
```

Behavior:

- AbortController timeout per attempt using `config.requestTimeoutMs`
- Retry transient transport errors and 5xx up to `maxRetries`
- Parse with `parseChampionStaticFile`
- Clear errors: include URL kind (`versions` vs `champion.json`) and status; never log secrets

- [ ] **Step 3: Run fetch tests — expect PASS**

---

### Task 4: Sync core (dry-run, transaction, count gate, verification)

**Files:**
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static-core.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static-core.test.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/cli-output.ts`
- Create: `apps/api/src/integrations/data-dragon/sync/sync-champion-static.args.ts`

- [ ] **Step 1: Write failing core tests**

Use a fake Prisma-shaped repository interface so unit tests do not require live Postgres for most cases; optionally one integration-style test with test DB if patterns already exist.

Required cases:

1. **Count gate:** mapped champions `< minChampions` → throws; prisma write methods never called
2. **Dry-run:** classifies new/changed/unchanged; no writes
3. **Insert new:** empty patch → upserts all; activates READY; demotes previous active
4. **Update existing:** changed title/tags counted as changed; upsert updates row
5. **Invalid payload:** fetch returns bad body → no writes
6. **Transaction safety:** upsert throws mid-txn → previous active patch remains active (simulate transactional rollback via fake that only commits on success)
7. **Version storage:** patch `version` / `dataDragonVersion` equal resolved version; `normalizedMajorMinor` derived
8. **Post-sync verification:** after apply, report includes `championRowCount` and `distinctChampionKeyCount`; fail if distinct ≠ row count or `< minChampions`
9. **No deletes:** when remote omits a previously stored champion on same patch, core does not call delete

Comparison for changed: any of `championKey`, `name`, `title`, tags (order-insensitive or JSON-stable), `imageData`, `baseStats` differs.

Result type sketch:

```ts
export type ChampionStaticSyncResult = {
  ok: boolean;
  dryRun: boolean;
  resolvedVersion: string;
  discovered: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  upsertedCount: number;
  activePatchVersion: string | null;
  championRowCount: number | null;
  distinctChampionKeyCount: number | null;
  error?: string;
};
```

- [ ] **Step 2: Implement core**

```ts
export async function syncChampionStatic(input: {
  config: ChampionStaticSyncConfig;
  prisma: PrismaClient; // or narrow SyncPrisma port
  dryRun: boolean;
  fetchDeps?: SyncFetchDeps;
  log?: (msg: string) => void; // stderr via CLI
}): Promise<ChampionStaticSyncResult>;
```

Apply path (single `$transaction`):

1. `upsert` Patch by `version`
2. For each mapped champion: `upsert` on `patchId_championId`
3. `updateMany` `{ isActive: true }` → `isActive: false` excluding synced id (or demote all others)
4. `update` synced patch `{ staticDataStatus: READY, isActive: true }`

Never set `PENDING` in this flow. Never delete champions. Never mutate other patches’ champion rows.

After commit, verification queries:

```ts
const rows = await prisma.championStaticData.findMany({
  where: { patchId: active.id },
  select: { championKey: true },
});
const championRowCount = rows.length;
const distinctChampionKeyCount = new Set(rows.map((r) => r.championKey)).size;
```

If verification fails → return/throw failure (data already written only if counts somehow inconsistent — should be rare; still fail CLI).

- [ ] **Step 3: Implement args + cli-output helpers**

Mirror worker aggregates style locally (do not import worker package):

- `parseSyncArgs(argv)` → `{ dryRun, json }`
- `cliLog` → stderr
- `writeJsonStdout` / `writeTextStdout`

- [ ] **Step 4: Run core tests — expect PASS**

---

### Task 5: Thin CLI entry + package scripts

**Files:**
- Create: `apps/api/src/integrations/data-dragon/cli/sync-champion-static.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json` (root)
- Modify: `README.md` (brief usage near other CLIs)

- [ ] **Step 1: Implement CLI**

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadChampionStaticSyncConfig } from '../sync/sync-champion-static.config';
import { parseSyncArgs } from '../sync/sync-champion-static.args';
import { syncChampionStatic } from '../sync/sync-champion-static-core';
import { cliLog, reportCliFailure, writeJsonStdout, writeTextStdout } from '../sync/cli-output';

async function main(): Promise<void> {
  const args = parseSyncArgs(process.argv.slice(2));
  const config = loadChampionStaticSyncConfig(process.env);
  const prisma = new PrismaClient();
  try {
    const result = await syncChampionStatic({
      config,
      prisma,
      dryRun: args.dryRun,
      log: cliLog,
    });
    if (args.json) {
      writeJsonStdout(result);
    } else {
      writeTextStdout([
        `ok=${result.ok} dryRun=${result.dryRun} version=${result.resolvedVersion}`,
        `discovered=${result.discovered} new=${result.newCount} changed=${result.changedCount} unchanged=${result.unchangedCount}`,
        // ... upserted + verification lines
      ]);
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    reportCliFailure({
      argv: process.argv,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

Keep CLI free of fetch/mapping details.

- [ ] **Step 2: Register scripts**

`apps/api/package.json`:

```json
"champions:sync-static": "tsx src/integrations/data-dragon/cli/sync-champion-static.ts"
```

Root `package.json`:

```json
"champions:sync-static": "pnpm --filter @league-helper/api champions:sync-static"
```

- [ ] **Step 3: Smoke dry-run help path**

```bash
pnpm champions:sync-static --dry-run --json
```

(May hit live CDN locally for smoke; unit tests remain mocked. If offline, skip smoke and rely on tests.)

---

### Task 6: Frontend isolation + full verification

**Files:** none required if existing isolation test still passes; fix only if regressions appear.

- [ ] **Step 1: Run targeted API unit tests**

```bash
pnpm --filter @league-helper/api exec vitest run src/integrations/data-dragon/sync
```

- [ ] **Step 2: Run frontend isolation test**

```bash
pnpm --filter @league-helper/web exec vitest run utils/splash-url-isolation.test.ts
```

- [ ] **Step 3: Run repo checks**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 4: Local sync against real DB (operator)**

```bash
pnpm champions:sync-static --dry-run
pnpm champions:sync-static
```

Then SQL:

```sql
SELECT COUNT(*) FROM "ChampionStaticData";
SELECT p.version, p."isActive", p."staticDataStatus", COUNT(c.id) AS n,
       COUNT(DISTINCT c."championKey") AS distinct_keys
FROM "Patch" p
LEFT JOIN "ChampionStaticData" c ON c."patchId" = p.id
GROUP BY p.id
ORDER BY p."isActive" DESC;
```

Expect active patch READY with ~170+ champions; `n = distinct_keys`; seed patch retained inactive.

- [ ] **Step 5: Spot-check UI/API**

- `GET /api/champions` returns full roster (respect limit)
- `/champions/Ahri`, `/champions/DrMundo` load
- Icons/splashes resolve

- [ ] **Step 6: Final report for user**

Include: files changed, schema changes (none), CLI examples, config changes, tests added, verification results, remaining limitations, commit hash (only if user requested a commit).

---

## Spec coverage checklist

| Spec requirement | Task |
| ---------------- | ---- |
| CLI `champions:sync-static` | 5 |
| Fetch + validate + upsert | 3, 4 |
| Identity rules | 1 |
| Configurable version | 2 |
| Timeout/retry | 3 |
| No partial updates / txn | 4 |
| Dry-run + JSON | 4, 5 |
| No deletes | 4 |
| Min champion count gate | 4 |
| READY only after validation | 4 |
| Post-sync verification | 4 |
| Tests 1–16 | 1–4, 6 |
| No frontend DDragon | 6 |
| No Match/Aggregate changes | (constraint) |

---

## Remaining limitations (document in final report)

- Statistics still hidden until match sample thresholds are met (later M9 work)
- Spell/passive text not synced (`champion.json` only)
- Redis enrichment cache not invalidated by sync
)
