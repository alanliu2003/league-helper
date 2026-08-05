# Milestone 8 Champion Aggregates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship champion aggregate statistics from eligible ingested matches, with idempotent BullMQ recalculation, public champion APIs, and Nuxt `/champions` pages using collected-sample wording.

**Architecture:** Pure math in `@league-helper/match-analytics`; Prisma/BullMQ orchestration in the worker; public Zod DTOs + cache-key helpers in `@league-helper/shared`; Nest read APIs with generation-based Redis cache; Nuxt directory/detail with URL-authoritative filters. Spec: `docs/superpowers/specs/2026-08-05-milestone-8-champion-aggregates-design.md`.

**Tech Stack:** pnpm monorepo, TypeScript, Prisma/PostgreSQL, Redis, BullMQ, NestJS, Nuxt 3, Zod, Vitest, Playwright

**Plan decisions (resolve spec ambiguities):**

1. Add operational model `ChampionAggregationProcessing` in the same migration so reconcile can detect match-level completion without guessing from arbitrary aggregate rows.
2. On match re-ingestion that can rewrite aggregate-defining fields: derive previous materialized keys from stored state before replace, enqueue recalculation over previous ∪ current keys.

---

## File structure (create / modify)

### Create

```text
packages/match-analytics/                     # new package (full tree in Task 1)
packages/shared/src/champion-api.ts
packages/shared/src/champion-stats-cache.ts
packages/shared/src/job-queues/champion-aggregation-job.ts
apps/api/prisma/migrations/<ts>_champion_aggregate_csdiff_and_versioning/
apps/api/src/config/champion-stats.config.ts
apps/api/src/features/champions/              # module, controllers, services, mappers, cache, errors
apps/api/src/persistence/champion-static.repository.ts
apps/api/src/persistence/champion-aggregate-read.repository.ts
apps/worker/src/queues/champion-aggregation/  # worker, processor, service, repository, eligibility, cache invalidator
apps/worker/src/cli/rebuild-champion-aggregates.ts
apps/worker/src/cli/reconcile-champion-aggregates.ts
apps/worker/src/cli/status-champion-aggregates.ts
apps/worker/src/cli/audit-rank-coverage.ts
apps/worker/src/cli/audit-champions.ts
apps/web/pages/champions/index.vue
apps/web/pages/champions/[championKey].vue
apps/web/composables/useChampionApi.ts
apps/web/composables/useChampionStatsFilters.ts
apps/web/utils/champion-links.ts
apps/web/components/champions/*               # see Task 10
apps/web/e2e/champions.e2e.ts
apps/web/e2e/global-setup.champions.ts        # or extend existing playwright global setup
```

### Modify

```text
apps/api/prisma/schema.prisma
apps/api/src/persistence/persistence.integration.test.ts
apps/api/src/app.module.ts
apps/api/.env.example
apps/worker/src/main.ts
apps/worker/src/config.ts
apps/worker/src/queues/match-ingestion/match-persistence.ts
apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts
apps/worker/package.json
apps/api/package.json
package.json                                  # build order + aggregates:* scripts
packages/shared/src/job-queues/queue-names.ts
packages/shared/src/job-queues/index.ts
packages/shared/src/index.ts
apps/web/components/layout/AppHeader.vue
apps/web/components/player/FeaturedMasteryCard.vue
apps/web/components/player/PlayerMatchCard.vue
apps/web/playwright.config.ts
README.md
apps/worker/.env.example
```

---

### Task 0: Baseline pre-checks (record only)

**Files:** none (report artifact in PR/notes)

- [x] **Step 1: Run baseline checks without formatting first**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api:integration
pnpm test:e2e
pnpm build
docker compose ps
```

- [x] **Step 2: Record a baseline results table**

Columns: `command | result (PASS/FAIL/SKIPPED) | duration | notes | pre-existing?`

Do not treat SKIPPED Playwright as PASS. Do not reset databases.

Pre-existing FAILs (approved baseline): `format:check` (M8 plan/spec Markdown), `test:api:integration` (vitest glob/filter finds no tests), `test:e2e` (player-search `waitForResponse` timeout).

- [x] **Step 3: Commit nothing** (documentation-only notes stay local or go into the final M8 report)

---

### Task 1: Scaffold `@league-helper/match-analytics` + safe-math + Wilson + confidence

**Files:**
- Create: `packages/match-analytics/package.json`
- Create: `packages/match-analytics/tsconfig.json`
- Create: `packages/match-analytics/eslint.config.mjs`
- Create: `packages/match-analytics/vitest.config.mts`
- Create: `packages/match-analytics/src/index.ts`
- Create: `packages/match-analytics/src/errors.ts`
- Create: `packages/match-analytics/src/statistics/safe-math.ts`
- Create: `packages/match-analytics/src/statistics/wilson-interval.ts`
- Create: `packages/match-analytics/src/statistics/sample-confidence.ts`
- Create: `packages/match-analytics/src/statistics/*.test.ts`
- Modify: `package.json` (root `build` / `postinstall` to build match-analytics after shared)

- [x] **Step 1: Create package.json mirroring shared**

```json
{
  "name": "@league-helper/match-analytics",
  "version": "0.0.0",
  "private": true,
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@league-helper/shared": "workspace:*"
  },
  "devDependencies": {
    "@league-helper/config": "workspace:*",
    "@types/node": "^22.13.10",
    "eslint": "^9.22.0",
    "tsup": "^8.5.1",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.26.1",
    "vitest": "^3.0.8"
  }
}
```

Copy `tsconfig.json` / `eslint.config.mjs` / `vitest.config.mts` patterns from `packages/shared`.

- [x] **Step 2: Write failing Wilson / safe-math / confidence tests**

```ts
// packages/match-analytics/src/statistics/wilson-interval.test.ts
import { describe, expect, it } from 'vitest';
import { wilsonScoreInterval } from './wilson-interval';

describe('wilsonScoreInterval', () => {
  it('returns null for zero samples', () => {
    expect(wilsonScoreInterval(0, 0, 0.95)).toBeNull();
  });
  it('bounds all wins within [0,1]', () => {
    const r = wilsonScoreInterval(100, 100, 0.95)!;
    expect(r.lowerBound).toBeGreaterThanOrEqual(0);
    expect(r.upperBound).toBeLessThanOrEqual(1);
    expect(r.lowerBound).toBeLessThanOrEqual(r.upperBound);
  });
  it('supports 0.90 / 0.95 / 0.99', () => {
    for (const level of [0.9, 0.95, 0.99]) {
      const r = wilsonScoreInterval(50, 100, level)!;
      expect(r.confidenceLevel).toBe(level);
    }
  });
  it('rejects invalid confidence', () => {
    expect(() => wilsonScoreInterval(1, 2, 0)).toThrow();
    expect(() => wilsonScoreInterval(1, 2, 1)).toThrow();
    expect(() => wilsonScoreInterval(1, 2, Number.NaN)).toThrow();
  });
});
```

```ts
// sample-confidence.test.ts — assert 0,29→INSUFFICIENT; 30,99→LOW; 100,499→MEDIUM; 500→HIGH
// safe-math.test.ts — safeDivide(1,0)=null; never NaN/Infinity
```

- [x] **Step 3: Run tests — expect FAIL**

```bash
pnpm --filter @league-helper/match-analytics test
```

Expected: FAIL (package/module missing)

- [x] **Step 4: Implement**

```ts
// errors.ts
export class MatchAnalyticsValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'MatchAnalyticsValidationError';
  }
}

// safe-math.ts
export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

// wilson-interval.ts — inverseNormApprox for z; Wilson formula; clamp [0,1]
// sample-confidence.ts
export type SampleConfidence = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';
export const DEFAULT_SAMPLE_CONFIDENCE_THRESHOLDS = {
  insufficientBelow: 30,
  lowBelow: 100,
  mediumBelow: 500,
} as const;
```

Wilson algorithm (document in file comment): for proportion `p = wins/n`, z from Φ⁻¹(1-α/2),  
`center = (p + z²/(2n)) / (1 + z²/n)`,  
`margin = (z / (1 + z²/n)) * sqrt(p(1-p)/n + z²/(4n²))`.

- [x] **Step 5: Re-run tests — expect PASS; build package**

```bash
pnpm --filter @league-helper/match-analytics test
pnpm --filter @league-helper/match-analytics build
```

- [x] **Step 6: Commit**

```bash
git add packages/match-analytics package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(match-analytics): add package with Wilson CI and sample confidence

EOF
)"
```

---

### Task 2: Sentinels, dimensions, keys, rollups, accumulation, derivations

**Files:**
- Create: `packages/match-analytics/src/sentinels/aggregate-sentinels.ts`
- Create: `packages/match-analytics/src/sentinels/public-sentinel-mapping.ts`
- Create: `packages/match-analytics/src/champion/*.ts` (+ tests)
- Create: `packages/match-analytics/README.md`
- Modify: `packages/match-analytics/src/index.ts`

- [x] **Step 1: Write failing rollup / key / accumulation tests**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAMPION_ROLLUP_POLICY, expandChampionDimensionTuples } from './rollup-policy';
import { assertExactChampionDimensions } from './aggregate-dimensions';
import { buildChampionAggregateDimensionKey } from './aggregate-keys';
import { emptyAccumulator, accumulateContribution, combineAccumulators } from './aggregate-accumulation';
import { deriveChampionAggregateMetrics } from './aggregate-derivations';
import { resolveMatchEndedAt } from './match-end-timestamp';

const baseExact = {
  patch: '16.15',
  platformRoute: 'na1',
  regionalRoute: 'americas',
  queueId: 420,
  rankTier: 'GOLD' as const,
  position: 'MIDDLE' as const,
  championId: 103,
  sourceNormalizationVersion: '1',
  aggregationVersion: '1',
};

it('emits exact, ALL-tier, ALL-position only', () => {
  const tuples = expandChampionDimensionTuples(baseExact, DEFAULT_CHAMPION_ROLLUP_POLICY);
  expect(tuples).toHaveLength(3);
  expect(tuples.some((t) => t.rankTier === 'ALL' && t.position === 'ALL')).toBe(false);
});

it('rejects ALL in exact dims', () => {
  expect(() =>
    assertExactChampionDimensions({ ...baseExact, rankTier: 'ALL' as never }),
  ).toThrow();
});

it('KDA matches player UI perfect-game convention', () => {
  const acc = accumulateContribution(emptyAccumulator(), {
    championId: 1, won: true, kills: 10, deaths: 0, assists: 2,
    totalCs: 0, gameSeconds: 60, damageToChampions: 0, visionScore: 0,
    goldDifferenceAt10: null, goldDifferenceAt15: null,
    csDifferenceAt10: null, csDifferenceAt15: null, matchEndedAt: null,
  });
  const d = deriveChampionAggregateMetrics(acc, {
    confidenceLevel: 0.95,
    thresholds: { insufficientBelow: 30, lowBelow: 100, mediumBelow: 500 },
  });
  expect(d.aggregateKdaRatio).toBe(12);
});
```

Also cover: missing timeline does not increment samples; `resolveMatchEndedAt` rejects duration ≤ 0; dimension key changes when patch changes; ALL vs UNKNOWN do not collide; combineAccumulators order-independence.

- [x] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @league-helper/match-analytics test
```

- [x] **Step 3: Implement types and functions**

```ts
// ExactChampionDimensions: rankTier RankTier|'UNKNOWN'; position NormalizedPosition|'UNKNOWN'
// MaterializedChampionDimensions: adds 'ALL' for tier/position
// DEFAULT_CHAMPION_ROLLUP_POLICY as in spec
// buildChampionAggregateDimensionKey = JSON.stringify([
//   patch, platformRoute, regionalRoute, queueId, rankTier, position,
//   championId, sourceNormalizationVersion, aggregationVersion
// ])
// accumulate: null timeline → skip sample; first sample initializes total (incl 0)
// derive: KDA rules from locked table; per-minute via safeDivide(total, seconds/60)
```

- [x] **Step 4: Tests PASS + README**

Document formulas, Wilson, thresholds, sentinels, rollup policy, KDA, no env/Prisma rule.

- [x] **Step 5: Commit**

```bash
git add packages/match-analytics
git commit -m "$(cat <<'EOF'
feat(match-analytics): add champion aggregation math and rollup policy

EOF
)"
```

---

### Task 3: Prisma migration + processing marker

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration `champion_aggregate_csdiff_and_versioning`
- Modify: `apps/api/src/persistence/persistence.integration.test.ts`

- [x] **Step 1: Update schema**

```prisma
model ChampionAggregate {
  // existing fields…
  totalCsDifferenceAt10       Int?
  csDifferenceAt10Samples     Int      @default(0)
  totalCsDifferenceAt15       Int?
  csDifferenceAt15Samples     Int      @default(0)
  aggregationVersion          String   @default("1")
  latestEligibleMatchAt       DateTime? @db.Timestamptz(3)
  calculatedAt                DateTime @db.Timestamptz(3)
  sourceNormalizationVersion  String

  @@unique([
    patch, platformRoute, regionalRoute, queueId, rankTier, teamPosition,
    championId, sourceNormalizationVersion, aggregationVersion
  ])
  @@index([platformRoute, patch, queueId, aggregationVersion])
  @@index([aggregationVersion, calculatedAt])
}

model ChampionAggregationProcessing {
  id                          String   @id @default(uuid())
  matchId                     String
  sourceNormalizationVersion  String
  aggregationVersion          String
  status                      String   // COMPLETED | FAILED
  processedAt                 DateTime @db.Timestamptz(3)
  lastErrorCode               String?
  createdAt                   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt                   DateTime @updatedAt @db.Timestamptz(3)

  match Match @relation(fields: [matchId], references: [id], onDelete: Cascade)

  @@unique([matchId, sourceNormalizationVersion, aggregationVersion])
  @@index([status, processedAt])
}
```

Add `championAggregationProcessing ChampionAggregationProcessing[]` on `Match`.

Implemented as Prisma enum `ChampionAggregationProcessingStatus { COMPLETED FAILED }` (repo enum convention).

- [x] **Step 2: Create migration (no reset)**

```bash
pnpm --filter @league-helper/api prisma:migrate
# name when prompted: champion_aggregate_csdiff_and_versioning
```

SQL must: ADD columns with defaults; DROP old unique; CREATE new unique; ADD CHECKs for sample counters ≥ 0; CREATE processing table. Must not DELETE from Match/MatchParticipant.

Migration path: `apps/api/prisma/migrations/20260805160846_champion_aggregate_csdiff_and_versioning/`.

- [x] **Step 3: Update uniqueness integration test** for versioned unique + CSD defaults; add CHECK/counter invariant test if practical.

- [x] **Step 4: Run integration tests**

```bash
pnpm test:api:integration
```

Expected: PASS (existing tests + new uniqueness)

Note: root `test:api:integration` glob still fails on this Windows runner (baseline). Task 3 verified via focused:
`pnpm --filter @league-helper/api exec vitest run src/persistence/persistence.integration.test.ts` → 16/16 PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/src/persistence/persistence.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(db): version champion aggregates and add processing marker

EOF
)"
```

---

### Task 4: Shared job contracts + cache-key helpers + champion API Zod schemas

**Files:**
- Modify: `packages/shared/src/job-queues/queue-names.ts`
- Create: `packages/shared/src/job-queues/champion-aggregation-job.ts`
- Create: `packages/shared/src/champion-stats-cache.ts`
- Create: `packages/shared/src/champion-api.ts` (+ tests)
- Modify: `packages/shared/src/job-queues/index.ts`, `packages/shared/src/index.ts`
- Modify: root/`packages` build so api/worker depend on match-analytics where needed later

- [x] **Step 1: Failing tests for job ID + cache keys + position-required schema**

```ts
import { ChampionStatsTableQuerySchema } from './champion-api';
import { buildChampionAggregationBullMqJobId } from './job-queues/champion-aggregation-job';
import { buildChampionStatsGenerationKey, buildChampionStatsTableCacheKey } from './champion-stats-cache';

it('requires position for table query', () => {
  expect(() => ChampionStatsTableQuerySchema.parse({ platform: 'na1', queueId: 420 })).toThrow();
});

it('builds deterministic job id', () => {
  const a = buildChampionAggregationBullMqJobId({
    matchId: '11111111-1111-4111-8111-111111111111',
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  });
  const b = buildChampionAggregationBullMqJobId({
    matchId: '11111111-1111-4111-8111-111111111111',
    sourceNormalizationVersion: '1',
    aggregationVersion: '1',
  });
  expect(a).toBe(b);
  expect(a.startsWith('agg_champ_')).toBe(true);
});
```

- [x] **Step 2: Implement**

```ts
// queue-names.ts
export const CHAMPION_AGGREGATION_QUEUE_NAME = 'champion-aggregation' as const;
export const CHAMPION_AGGREGATION_JOB_NAME = 'RECALCULATE_CHAMPION_AGGREGATES' as const;

// champion-aggregation-job.ts — Zod payload with sourceNormalizationVersion
// champion-stats-cache.ts — generation scope includes sourceNormalizationVersion, aggregationVersion, platform, patch, queueId
// champion-api.ts — full DTO set from spec §4 refinements:
//   envelope disclaimer/sampleScope/freshness/rankTierSemantics
//   no per-row disclaimer
//   AggregateDimensions without championKey
//   concrete passive/spell/baseStats OR omit if seed JSON cannot map safely
//   CHAMPION_STATS_DISCLAIMER + RANK_TIER_SEMANTICS constants
//   supportsStandardPositions on filter queue metadata
```

For abilities: if seed `passive`/`spells`/`baseStats` JSON is not already frontend-safe, **omit** those fields from M8 `ChampionDetailSchema` rather than shipping `z.unknown()`.

- [x] **Step 3: Tests PASS; build shared**

```bash
pnpm --filter @league-helper/shared test
pnpm --filter @league-helper/shared build
```

- [x] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "$(cat <<'EOF'
feat(shared): add champion API schemas and aggregation job contracts

EOF
)"
```

---

### Task 5: Rank-at-ingestion in match persistence

**Files:**
- Modify: `apps/worker/src/queues/match-ingestion/match-persistence.ts`
- Modify: `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts` (ordering only if needed)
- Create: `apps/worker/src/queues/match-ingestion/rank-at-ingestion.ts` (+ tests)
- Modify: worker tests using ranked fixture

- [x] **Step 1: Failing tests**

```ts
it('assigns solo tier for linked 420 participant using snapshot at or before cutoff', async () => { /* … */ });
it('leaves ARAM rankTierAtIngestion null', async () => { /* … */ });
it('does not use snapshot captured after cutoff', async () => { /* … */ });
it('does not overwrite existing non-null tier with null on retry', async () => { /* … */ });
```

- [x] **Step 2: Implement batch rank assignment**

```ts
export async function loadRankTiersAtIngestion(input: {
  prisma: PrismaClient;
  queueId: number;
  cutoff: Date;
  links: Array<{ participantKey: string; playerAccountId: string | null }>;
}): Promise<Map<string, string | null>> {
  // if queueId not in {420,440} → all null
  // batch playerAccountIds
  // query RankSnapshot where playerAccountId in (…) and queueType in (…) and capturedAt <= cutoff
  // pick latest per account+queueType in memory
}
```

Wire into `persistNormalizedMatch` participant create/update: set `rankTierAtIngestion` from map; on update, only set when new value non-null OR existing is null (never clear).

Cutoff: for new match use `ingestedAt` about to be written (same transaction timestamp); for existing COMPLETED rematerialization use existing `match.ingestedAt ?? match.createdAt`.

- [x] **Step 3: Worker tests PASS**

```bash
pnpm --filter @league-helper/worker test
```

- [x] **Step 4: Commit**

```bash
git add apps/worker/src/queues/match-ingestion
git commit -m "$(cat <<'EOF'
feat(worker): assign rankTierAtIngestion from local snapshots at cutoff

EOF
)"
```

---

### Task 6: Champion aggregation worker + post-commit enqueue

**Files:**
- Create: `apps/worker/src/queues/champion-aggregation/*`
- Modify: `apps/worker/src/config.ts`, `apps/worker/src/main.ts`
- Modify: `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts`
- Modify: `apps/worker/package.json` (add `@league-helper/match-analytics`)
- Modify: `apps/worker/.env.example`

- [x] **Step 1: Failing processor/service tests**

Cover: remake excluded; incomplete excluded; default 3 keys; retry idempotent; zero-contributor deletes row; processing marker written; version mismatch skips; cache generation INCR mocked; previous∪current keys when participant position changes.

- [x] **Step 2: Implement service flow**

```ts
async function recalculateForMatch(matchId: string, versions: Versions): Promise<Result> {
  // 1) load previous participants (if any) → previousKeys
  // 2) load current eligible → currentKeys via expandChampionDimensionTuples
  // 3) union keys
  // 4) batch-fetch contributors for shared scopes (patch/platform/region/queue/versions)
  // 5) fold with match-analytics
  // 6) short transaction: upsert non-empty; delete empty keys; upsert ChampionAggregationProcessing COMPLETED
  // 7) after commit: increment cache generations for distinct scopes
}
```

Worker job opts:

```ts
removeOnComplete: { age: 3600, count: 1000 },
removeOnFail: { age: 86400, count: 5000 },
```

Enqueue from processor **after** successful COMPLETED commit (both happy and already-complete paths that still need agg). Catch enqueue errors → warn `champion_aggregation_enqueue_failed`; do not fail ingest.

Durable previous�** successful COMPLETED commit (both happy and already-complete paths that still need agg). Catch enqueue errors → warn `champion_aggregation_enqueue_failed`; do not fail ingest.

Durable previous∪current via `ChampionAggregationRecalcScope` (union upsert + conditional clear + follow-up enqueue on concurrent scope retention).

- [x] **Step 3: Dual-worker bootstrap**

`main.ts` starts match-ingestion + champion-aggregation only; log both; shutdown closes both; bootstrap test asserts queue names.

- [x] **Step 4: Tests PASS**

```bash
pnpm --filter @league-helper/worker test
```

- [x] **Step 5: Commit**

```bash
git add apps/worker packages/match-analytics pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(worker): add champion aggregation queue and post-commit enqueue

EOF
)"
```

---

### Task 7: Aggregation CLIs (rebuild, reconcile, status, audits)

**Files:**
- Create: CLI files under `apps/worker/src/cli/` and/or `apps/api/src/queues/cli/` (prefer worker for rebuild/audit; API or worker for reconcile enqueue)
- Modify: root `package.json` scripts
- Modify: `.env.example` files

- [ ] **Step 1: Implement rebuild with flags**

```text
pnpm aggregates:rebuild-champions --dry-run --patch 16.15 --queue 420 --platform na1
```

Require `AGGREGATES_REBUILD_CHAMPIONS_CONFIRM=YES` or `--confirm` for mutations.  
`--include-all-*` / combined ALL×ALL: dry-run only **or** require `--aggregation-version` ≠ incremental version.  
`--json` on stdout; logs on stderr.  
Batch loop with short transactions; scoped deletes; exit nonzero on batch failure.

- [ ] **Step 2: Implement reconcile / status / audit-rank / audit-champions**

Reconcile uses `ChampionAggregationProcessing` (+ eligible COMPLETED matches) to find missing/stale; enqueues deterministic jobs; dry-run + `--json`.

Status: read-only metrics from spec §3.13 / §6.  
Audits: read-only; integrity checks from §6.13; rank coverage excludes ARAM from primary denominator.

- [ ] **Step 3: Smoke dry-run against test DB (manual in this task)**

```bash
pnpm aggregates:status-champions --json
pnpm aggregates:rebuild-champions --dry-run --json
```

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/cli apps/api/src/queues/cli package.json apps/worker/.env.example apps/api/.env.example
git commit -m "$(cat <<'EOF'
feat(cli): add champion aggregate rebuild reconcile status and audits

EOF
)"
```

---

### Task 8: API config, repositories, services, cache, controllers

**Files:**
- Create: `apps/api/src/config/champion-stats.config.ts` (+ test)
- Create: `apps/api/src/features/champions/*`
- Create: persistence read repositories
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json` (depend on match-analytics)
- Modify: `apps/api/.env.example`
- Expand seed champions in `apps/api/prisma/seed.ts` (static metadata only; more keys for directory)

- [ ] **Step 1: Config test — invalid platform throws**

```ts
expect(() => loadChampionStatsConfig({ CHAMPION_STATS_DEFAULT_PLATFORM: 'nope' })).toThrow(
  ValidationFailureError,
);
```

- [ ] **Step 2: Service/unit tests**

- table without position → `CHAMPION_STATS_POSITION_REQUIRED`  
- unknown key → `CHAMPION_NOT_FOUND`  
- known key no aggregate → 200 shape with `stats: null`  
- default platform resolution  
- semantic patch sort via `parsePatchVersion`  
- Redis fail → PostgreSQL  
- generation race skips stale cache write  
- cache key isolation na1 vs euw1  
- no sentinel `""` in DTOs  
- `effectiveMinimumSample` metadata  

- [ ] **Step 3: Implement Nest module**

```ts
// ChampionsController @Controller('api/champions')
// ChampionStatsController @Controller('api/champion-stats')
// ChampionStatsCacheService: getGen / incrGen / get/set with Zod parse
// ChampionStaticService: findByKey case-insensitive; build URLs via DataDragonChampionService.buildChampionIconUrl/SplashUrl only (no fetchChampion)
// ChampionStatsService: query aggregates for configured versions only; derive via match-analytics; positionBreakdown array of five roles
```

Offset pagination is acceptable for M8 if cursor complexity slips; if using cursor, encode `{ sortValue, championId, sortBy, sortDirection, aggregationVersion, filterFingerprint }` as opaque base64url JSON.

- [ ] **Step 4: Unit + integration tests PASS**

```bash
pnpm --filter @league-helper/api test:unit
pnpm test:api:integration
```

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/shared
git commit -m "$(cat <<'EOF'
feat(api): add champion directory and champion-stats endpoints

EOF
)"
```

---

### Task 9: Nuxt filters composable + API client + links

**Files:**
- Create: `apps/web/composables/useChampionApi.ts`
- Create: `apps/web/composables/useChampionStatsFilters.ts` (+ tests)
- Create: `apps/web/utils/champion-links.ts` (+ tests)
- Create: splash/icon isolation test updates if needed

- [ ] **Step 1: Failing filter tests**

```ts
it('canonicalizes queueId alias to queue', () => { /* … */ });
it('does not ranking-fetch until filtersReady && position', () => { /* … */ });
it('ignores stale out-of-order table responses', async () => { /* … */ });
it('keeps displayedResponse.sampleScope while isUpdating', () => { /* … */ });
```

- [ ] **Step 2: Implement**

```ts
// Public query: platform, queue, tier, position, patch, search, tag
// map queue ↔ queueId at API boundary only inside useChampionApi
// filtersResolving / filtersReady
// ChampionStatsViewState { displayedResponse, pendingFilters, isUpdating }
// request generation token / AbortController
// buildChampionPath(key, filters) — never search/tag onto player links
```

- [ ] **Step 3: Tests PASS**

```bash
pnpm --filter @league-helper/web test
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/composables apps/web/utils
git commit -m "$(cat <<'EOF'
feat(web): add champion filter state and API client

EOF
)"
```

---

### Task 10: Champion pages and components

**Files:**
- Create: pages + `components/champions/*` listed in file structure
- Modify: `AppHeader.vue` (enable Champions → `/champions`)
- Modify: mastery/match cards to use `buildChampionPath` when `championKey` present
- Create: component tests covering §5.18 list

- [ ] **Step 1: Directory page**

Render disclaimer, filter bar, directory grid (static), position-required empty state, table/cards when position set. Use M7 tokens. Label sort “Collected sample ranking”.

- [ ] **Step 2: Detail page**

Hero from metadata; independent stats/breakdown states; limitations panel with search-driven copy; case canonical `replace`; reject numeric params before API.

- [ ] **Step 3: Component tests + isolation**

No Data Dragon URL construction; no PUUID; UNKNOWN tier not primary; ARAM not in role-ranking queue selector.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): add champions directory and detail pages

EOF
)"
```

---

### Task 11: Playwright e2e with isolated setup

**Files:**
- Create: `apps/web/e2e/champions.e2e.ts`
- Create/modify: Playwright global setup using `TEST_DATABASE_URL` / `TEST_REDIS_URL`
- Create: e2e seed helper (static champions + COMPLETED matches + invoke rebuild harness)

- [ ] **Step 1: Global setup**

1. Guard test DB name contains `test`  
2. migrate deploy  
3. seed static + deterministic COMPLETED matches (420, mixed W/L, positions, one remake, timeline missing/present)  
4. run rebuild with test versions (spawn CLI or in-process harness)  
5. bounded poll until expected aggregate rows exist / queues idle  

- [ ] **Step 2: E2E assertions**

Open `/champions` → disclaimer; no ranking until position; select MIDDLE → rows; open Ahri → metrics; DOM scan no `puuid`/`PUUID`; no matchup/AI sections.

- [ ] **Step 3: Run**

```bash
pnpm test:e2e
```

Expected: PASS (or SKIPPED with explicit reason if infra missing — never silent pass)

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e apps/web/playwright.config.ts
git commit -m "$(cat <<'EOF'
test(e2e): add isolated champion statistics playwright coverage

EOF
)"
```

---

### Task 12: README, env examples, rebuild against dev data, final verification

**Files:**
- Modify: `README.md`
- Modify: env examples
- Update: spec status line to “Approved; plan written”

- [ ] **Step 1: README section**

Architecture, dimensions, rollups, formulas, Wilson, thresholds, remake exclusion, queue separation, search-driven limitation, rank-at-ingestion warning, incremental + reconcile, CLI safety table, endpoints, pages, Mermaid, deferred work.

- [ ] **Step 2: Dev backfill (mutating; local only)**

```bash
pnpm aggregates:rebuild-champions --dry-run --json
pnpm aggregates:rebuild-champions --confirm
pnpm aggregates:status-champions --json
pnpm aggregates:audit-champions --json
pnpm aggregates:audit-rank-coverage --json
```

Do not delete match data. Document sample size honesty in final report.

- [ ] **Step 3: Full verification**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:api:integration
pnpm test:e2e
pnpm build
```

Fill baseline vs post-M8 results table.

- [ ] **Step 4: Commit docs + any leftover fixes**

```bash
git add README.md apps/api/.env.example apps/worker/.env.example docs/superpowers
git commit -m "$(cat <<'EOF'
docs: document champion aggregation architecture and operations

EOF
)"
```

---

## Spec coverage checklist

| Spec area | Task(s) |
|-----------|---------|
| match-analytics package | 1–2 |
| Schema + CSD + versions + processing marker | 3 |
| Shared DTOs / jobs / cache keys | 4 |
| Rank at ingestion | 5 |
| Aggregation worker + enqueue | 6 |
| CLIs | 7 |
| API | 8 |
| Web filters/client | 9 |
| Web pages | 10 |
| E2E isolation | 11 |
| README / verify / backfill | 0, 12 |
| No matchups/AI/live Riot | enforced throughout |
| Baseline reporting | 0, 12 |

## Placeholder / consistency self-review

- No TBD steps remaining; processing marker and previous∪current keys locked in plan header.  
- Payload field name consistently `sourceNormalizationVersion`.  
- URL param `queue` vs API `queueId` mapped in Task 9.  
- KDA rules match `computePublicKda`.  
- Optional ability fields omitted if seed JSON is unsafe (Task 4/8).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-05-milestone-8-champion-aggregates.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
