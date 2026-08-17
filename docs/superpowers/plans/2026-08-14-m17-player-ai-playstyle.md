# Milestone 17 Player AI Playstyle Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship grounded Qwen explanations of a player's recent Ranked Solo performance relative to ChampionAggregate baselines, without inventing metrics, raw-averaging mixed roles, or calling the model on page render.

**Architecture:** `@league-helper/match-analytics` owns per-match metrics, near-bands (`NEAR` iff `abs(delta) <=` threshold), and profile aggregation (overall mean deltas without KDA; slices use matched per-match baselines). M17 extends `ChampionAggregate` with `totalGoldEarned` / `averageGoldPerMinute` at `aggregationVersion` 2. `@league-helper/ai` adds a player context/prompt/generation module beside M16 champion insights and reuses `AiProvider` (default `AI_MODEL` `qwen2.5:14b`, `AI_ENABLED` false). `@league-helper/shared` owns public DTOs and the BullMQ job. API loads a **fixed 20 Ranked Solo window then skips**, fingerprints, and enqueues. Worker generates asynchronously with the same retryable-vs-terminal split as M16. Spec: `docs/superpowers/specs/2026-08-14-m17-player-ai-playstyle-design.md`.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, NestJS, BullMQ, Prisma/PostgreSQL, Nuxt 3, Vitest, Playwright. Native `fetch` to OpenAI-compatible `/v1/chat/completions`. No LangChain, no OpenAI SDK.

**Plan decisions (resolve spec ambiguities):**

1. **Do** extend `ChampionAggregate` with `totalGoldEarned` / `averageGoldPerMinute`. Bump `CHAMPION_AGGREGATION_VERSION` default `1` → `2`. Rebuild required. **Do not** add kill participation.
2. Do **not** write to `PlayerMetricSnapshot` / `PlayerAnalysisReport` / `AnalysisFinding`.
3. New table `PlayerPlaystyleInsight`; new Prisma enum `PlayerPlaystyleInsightStatus`.
4. Manual migrations: `20260814110000_m17_champion_aggregate_gold` then `20260814120000_m17_player_playstyle_insight`.
5. Extract `canonicalize` / `fingerprintCanonicalPayload` from champion fingerprint into `packages/ai/src/context/canonical-fingerprint.ts` and reuse for both champion and player.
6. Generation-facing comparisons omit numeric values; internal context (hashed + stored) keeps them.
7. Overall public `playerValue` **and** `baseline.value` are always `null`. Champion slices populate both from matched per-match baselines (not a modal row).
8. Per-minute comparison rates use `timePlayedSeconds` if `> 0`, else `gameDurationSeconds`. Do not change match-card `computeCsPerMinute`.
9. `GET /api/players/:playerId/playstyle` has no query params in v1.
10. Extract poll helper `apps/web/utils/ai-insight-poll.ts` from champion poll; champion imports re-export or switch to the shared helper.
11. Root `pnpm ai:eval` remains champion-offline. Add `pnpm ai:eval:playstyle` for player fixtures. Live flag `--live` same pattern.
12. Shared `AI_MODEL` **default becomes `qwen2.5:14b`** (API + worker + `.env.example` + tests that assert the default). `AI_ENABLED` stays `false`.
13. `NEAR_BASELINE` iff `abs(delta) <=` threshold (inclusive).
14. Overall omits `KDA`. Slices use `computeAggregateKdaRatio` on summed K/D/A vs mean matched `aggregateKdaRatio`.
15. Match window: fetch 20 most recent Ranked Solo, then skip. Do not backfill. `skipped.* + matchesAnalyzed = windowSize`.

---

## File structure (create / modify)

### Create

```text
packages/match-analytics/src/player-playstyle/metrics.ts
packages/match-analytics/src/player-playstyle/metrics.test.ts
packages/match-analytics/src/player-playstyle/sample-policy.ts
packages/match-analytics/src/player-playstyle/sample-policy.test.ts
packages/match-analytics/src/player-playstyle/comparison.ts
packages/match-analytics/src/player-playstyle/comparison.test.ts
packages/match-analytics/src/player-playstyle/aggregate-profile.ts
packages/match-analytics/src/player-playstyle/aggregate-profile.test.ts

packages/shared/src/player-playstyle.ts
packages/shared/src/player-playstyle.test.ts
packages/shared/src/job-queues/player-playstyle-insight-job.ts
packages/shared/src/job-queues/player-playstyle-insight-job.test.ts

packages/ai/src/context/canonical-fingerprint.ts
packages/ai/src/context/canonical-fingerprint.test.ts
packages/ai/src/context/player-playstyle-types.ts
packages/ai/src/context/player-playstyle-builder.ts
packages/ai/src/context/player-playstyle-builder.test.ts
packages/ai/src/context/player-playstyle-evidence.ts
packages/ai/src/context/player-playstyle-evidence.test.ts
packages/ai/src/prompts/player-playstyle-v1.ts
packages/ai/src/prompts/player-playstyle-v1.test.ts
packages/ai/src/validation/player-playstyle-output.ts
packages/ai/src/validation/player-playstyle-output.test.ts
packages/ai/src/generation/stored-player-playstyle.json-schema.ts
packages/ai/src/generation/generate-player-playstyle.ts
packages/ai/src/generation/generate-player-playstyle.test.ts
packages/ai/src/eval/fixtures/player-playstyle/*.json
packages/ai/src/eval/player-playstyle-offline.ts
packages/ai/src/eval/player-playstyle-cli.ts

apps/api/prisma/migrations/20260814110000_m17_champion_aggregate_gold/migration.sql
apps/api/prisma/migrations/20260814120000_m17_player_playstyle_insight/migration.sql
apps/api/src/config/player-playstyle-ai.config.ts
apps/api/src/config/player-playstyle-ai.config.test.ts
apps/api/src/persistence/player-playstyle-insight.repository.ts
apps/api/src/queues/player-playstyle-insight.producer.ts
apps/api/src/features/players/player-playstyle.service.ts
apps/api/src/features/players/player-playstyle.service.test.ts
apps/api/src/features/players/player-playstyle.mapper.ts
apps/api/src/features/players/player-playstyle-matches.ts

apps/worker/src/queues/player-playstyle-insight/player-playstyle-insight.worker.ts
apps/worker/src/queues/player-playstyle-insight/player-playstyle-insight.processor.ts
apps/worker/src/queues/player-playstyle-insight/player-playstyle-insight.processor.test.ts

apps/web/components/player/PlayerPlaystylePanel.vue
apps/web/components/player/PlayerPlaystylePanel.test.ts
apps/web/components/player/PlayerPlaystyleAiPanel.vue
apps/web/components/player/PlayerPlaystyleAiPanel.test.ts
apps/web/utils/ai-insight-poll.ts
```

### Modify

```text
packages/match-analytics/src/index.ts
packages/match-analytics/src/champion/aggregate-accumulation.ts
packages/match-analytics/src/champion/aggregate-accumulation.test.ts
packages/match-analytics/src/champion/aggregate-derivations.ts
packages/match-analytics/src/champion/aggregate-derivations.test.ts
packages/shared/src/index.ts
packages/shared/src/champion-api.ts
packages/shared/src/champion-api.test.ts
packages/shared/src/job-queues/queue-names.ts
packages/shared/src/job-queues/index.ts
packages/ai/src/context/fingerprint.ts          # delegate to canonical helper
packages/ai/src/index.ts
packages/ai/package.json
apps/api/prisma/schema.prisma
apps/api/src/persistence/persistence.integration.test.ts
apps/api/src/features/champions/champion-stats.mapper.ts
apps/api/src/features/players/players.controller.ts
apps/api/src/features/players/players.module.ts
apps/api/src/features/players/players.integration.test.ts
apps/api/src/queues/queue.tokens.ts
apps/api/src/queues/queues.module.ts
apps/api/package.json
apps/api/.env.example
apps/api/src/config/champion-stats.config.ts
apps/api/src/config/champion-ai.config.ts          # DEFAULT_MODEL → qwen2.5:14b
apps/api/src/config/champion-ai.config.test.ts
apps/worker/src/main.ts
apps/worker/src/config.ts
apps/worker/package.json
apps/worker/.env.example
apps/worker/src/cli/aggregates/aggregates-cli.test.ts
apps/worker/src/cli/aggregates/rebuild-core.ts
apps/worker/src/queues/champion-aggregation/eligibility.ts
apps/worker/src/queues/champion-aggregation/eligibility.test.ts
apps/worker/src/queues/champion-aggregation/champion-aggregation.service.ts
apps/api/src/features/champions/champions.integration.test.ts
apps/worker/src/queues/champion-build-aggregation/rebuild-core.test.ts
apps/worker/src/queues/champion-matchup-aggregation/rebuild-core.test.ts
apps/worker/src/main.bootstrap.test.ts
apps/worker/src/queues/champion-ai-insight/champion-ai-insight.processor.test.ts
package.json
.env.example
apps/web/composables/usePlayerApi.ts
apps/web/composables/usePlayerProfilePage.ts
apps/web/pages/players/[playerId].vue
apps/web/utils/champion-insights-poll.ts
apps/web/e2e/player-search.e2e.ts
README.md
```

Do **not** change ranking floor, M16 champion insight prompts/performance schema, or match-card `computeCsPerMinute`.

---

### Task 1: Shared public contracts

**Files:**

- Create: `packages/shared/src/player-playstyle.ts`
- Create: `packages/shared/src/player-playstyle.test.ts`
- Create: `packages/shared/src/job-queues/player-playstyle-insight-job.ts`
- Create: `packages/shared/src/job-queues/player-playstyle-insight-job.test.ts`
- Modify: `packages/shared/src/job-queues/queue-names.ts`
- Modify: `packages/shared/src/job-queues/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add queue names**

```ts
export const PLAYER_AI_PLAYSTYLE_QUEUE_NAME = 'player-ai-playstyle' as const;
export const PLAYER_AI_PLAYSTYLE_JOB_NAME = 'GENERATE_PLAYER_PLAYSTYLE_INSIGHT' as const;
```

- [ ] **Step 2: Add public DTO schemas in `player-playstyle.ts`**

Export:

- `PLAYER_PLAYSTYLE_AI_DISCLAIMER` = `'AI playstyle explanations are generated from League Helper statistical comparisons. They do not replace the numbers shown on this page.'`
- `PLAYER_PLAYSTYLE_PROMPT_VERSION = 'player-playstyle-v1'`
- `PlayerPlaystyleMetricIdSchema` = enum of spec §7.1 ids including `GOLD_PER_MIN` and `KDA` (KDA is slice-only; overall responses must not include a `KDA` comparison row)
- `PlayerPlaystyleDirectionSchema` = `ABOVE_BASELINE | NEAR_BASELINE | BELOW_BASELINE | NOT_COMPARABLE`
- `PlayerPlaystyleSampleBandSchema` = `INSUFFICIENT | EXPLORATORY | CREDIBLE | STRONG`
- `PlayerAiInsightStatusSchema` = `DISABLED | PENDING | AVAILABLE | UNAVAILABLE | LOW_CONFIDENCE`
- `PlayerPlaystyleEmptyReasonSchema` = `INSUFFICIENT_SAMPLE | INSUFFICIENT_EVIDENCE | GENERATION_FAILED | QUEUE_UNAVAILABLE | AI_DISABLED`
- `PlayerMetricComparisonSchema` with `playerValue` nullable, `baseline` nullable, `delta` nullable, `comparableMatchCount`, `direction`, `interpretationAllowed`
- `PlayerPlaystyleResponseSchema` matching spec §12
- Internal `PlayerPlaystyleGroundedClaimSchema` / `PlayerPlaystyleStoredInsightSchema` (with evidence) for worker/API

Text bounds: summary 80–600; claim 40–400; champion tendency 40–500; evidence min 1; strengths/tradeoffs max 3; championTendencies max 3.

- [ ] **Step 3: Add job payload**

Mirror `champion-ai-insight-job.ts`: `{ insightId, contextFingerprint, correlationId? }`, job id `ai_player_` + first 24 hex chars of fingerprint.

- [ ] **Step 4: Tests**

- Parse a full valid response
- Reject `playerValue` required (must allow null)
- Reject unknown metric ids
- Job id length ≤ 128
- Export from `packages/shared/src/index.ts`

- [ ] **Step 5: Run**

```bash
pnpm --filter @league-helper/shared test -- player-playstyle player-playstyle-insight-job
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/player-playstyle.ts packages/shared/src/player-playstyle.test.ts packages/shared/src/job-queues/player-playstyle-insight-job.ts packages/shared/src/job-queues/player-playstyle-insight-job.test.ts packages/shared/src/job-queues/queue-names.ts packages/shared/src/job-queues/index.ts packages/shared/src/index.ts
git commit -m "feat(shared): add player playstyle DTOs and job contract"
```

---

### Task 2: Player sample bands and near-band classification

**Files:**

- Create: `packages/match-analytics/src/player-playstyle/sample-policy.ts`
- Create: `packages/match-analytics/src/player-playstyle/sample-policy.test.ts`
- Create: `packages/match-analytics/src/player-playstyle/comparison.ts`
- Create: `packages/match-analytics/src/player-playstyle/comparison.test.ts`
- Modify: `packages/match-analytics/src/index.ts`

- [ ] **Step 1: Write failing tests for sample bands**

```ts
expect(classifyPlayerPlaystyleSampleBand(0)).toBe('INSUFFICIENT');
expect(classifyPlayerPlaystyleSampleBand(4)).toBe('INSUFFICIENT');
expect(classifyPlayerPlaystyleSampleBand(5)).toBe('EXPLORATORY');
expect(classifyPlayerPlaystyleSampleBand(9)).toBe('EXPLORATORY');
expect(classifyPlayerPlaystyleSampleBand(10)).toBe('CREDIBLE');
expect(classifyPlayerPlaystyleSampleBand(19)).toBe('CREDIBLE');
expect(classifyPlayerPlaystyleSampleBand(20)).toBe('STRONG');
```

Constants: `PLAYER_PLAYSTYLE_EXPLORATORY_MIN = 5`, `CREDIBLE_MIN = 10`, `STRONG_MIN = 20`.

- [ ] **Step 2: Write failing tests for direction**

```ts
expect(classifyMetricDirection('CS_PER_MIN', -0.39)).toBe('NEAR_BASELINE');
expect(classifyMetricDirection('CS_PER_MIN', -0.4)).toBe('NEAR_BASELINE'); // inclusive
expect(classifyMetricDirection('CS_PER_MIN', -0.41)).toBe('BELOW_BASELINE');
expect(classifyMetricDirection('CS_PER_MIN', 0.4)).toBe('NEAR_BASELINE');
expect(classifyMetricDirection('CS_PER_MIN', 0.41)).toBe('ABOVE_BASELINE');
expect(classifyMetricDirection('DAMAGE_PER_MIN', 40)).toBe('NEAR_BASELINE');
expect(classifyMetricDirection('DAMAGE_PER_MIN', 41)).toBe('ABOVE_BASELINE');
expect(classifyMetricDirection('GOLD_PER_MIN', 25)).toBe('NEAR_BASELINE');
expect(classifyMetricDirection('GOLD_PER_MIN', 26)).toBe('ABOVE_BASELINE');
expect(classifyMetricDirection('GOLD_PER_MIN', 0)).toBe('NEAR_BASELINE');
```

Use exact near-bands from spec §8.1. **`NEAR_BASELINE` iff `abs(delta) <=` threshold.** `delta === 0` → `NEAR_BASELINE`.

- [ ] **Step 3: Implement sample-policy.ts and comparison.ts**

Export `PLAYER_METRIC_NEAR_BANDS: Record<PlayerPlaystyleMetricId, number>` and `classifyMetricDirection(metric, delta)`.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @league-helper/match-analytics test -- sample-policy comparison
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/match-analytics/src/player-playstyle packages/match-analytics/src/index.ts
git commit -m "feat(analytics): classify player playstyle sample bands and metric directions"
```

---

### Task 3: ChampionAggregate gold per minute (prerequisite)

**Files:**

- Modify: `packages/match-analytics/src/champion/aggregate-accumulation.ts` (+ test)
- Modify: `packages/match-analytics/src/champion/aggregate-derivations.ts` (+ test)
- Modify: `packages/shared/src/champion-api.ts` (`ChampionAggregateMetricsSchema.averageGoldPerMinute`)
- Modify: `apps/api/prisma/schema.prisma` (`ChampionAggregate.totalGoldEarned`)
- Create: `apps/api/prisma/migrations/20260814110000_m17_champion_aggregate_gold/migration.sql`
- Modify: `apps/api/src/features/champions/champion-stats.mapper.ts`
- Modify: `apps/worker/src/queues/champion-aggregation/eligibility.ts` (+ test) — require non-negative `goldEarned`
- Modify: `apps/worker/src/queues/champion-aggregation/champion-aggregation.service.ts` — pass `goldEarned` into contributions
- Modify: `apps/worker/src/cli/aggregates/rebuild-core.ts` — select/pass `goldEarned`
- Modify: `apps/api/src/config/champion-stats.config.ts` and `apps/worker/src/config.ts` — default `CHAMPION_AGGREGATION_VERSION` `'2'`
- Modify: `.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`

- [ ] **Step 1: Write failing accumulation/derivation tests**

```ts
const acc = accumulateContribution(
  emptyAccumulator(),
  baseContribution({ goldEarned: 12_000, gameSeconds: 1800 }),
);
expect(acc.totalGoldEarned).toBe(12_000);
const derived = deriveChampionAggregateMetrics(acc, { confidenceLevel: 0.95 });
expect(derived.averageGoldPerMinute).toBe(400);
expect(() =>
  accumulateContribution(emptyAccumulator(), baseContribution({ goldEarned: -1 })),
).toThrow();
```

Existing derivation tests must still pass; add `goldEarned: 0` to contribution fixtures.

- [ ] **Step 2: Implement column + math**

`totalGoldEarned` always increments (like damage), not a nullable sample-count field. `averageGoldPerMinute` uses `perMinute(totalGoldEarned, totalGameSeconds)`.

Do **not** add `averageGoldPerMinute` to M16 `ChampionInsightPerformanceSchema`.

- [ ] **Step 3: Version bump + SQL**

```sql
ALTER TABLE "ChampionAggregate" ADD COLUMN "totalGoldEarned" INTEGER NOT NULL DEFAULT 0;
```

Default env/config `CHAMPION_AGGREGATION_VERSION=2`. Tests that **pin** `'1'` stay pinned. Tests that load config defaults must expect `'2'`.

- [ ] **Step 4: Run**

```bash
pnpm --filter @league-helper/match-analytics test -- aggregate-accumulation aggregate-derivations
pnpm --filter @league-helper/shared test -- champion-api
pnpm --filter @league-helper/worker test -- eligibility
```

- [ ] **Step 5: Commit**

```bash
git add packages/match-analytics/src/champion packages/shared/src/champion-api.ts packages/shared/src/champion-api.test.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260814110000_m17_champion_aggregate_gold apps/api/src/features/champions/champion-stats.mapper.ts apps/worker/src/queues/champion-aggregation apps/worker/src/cli/aggregates/rebuild-core.ts apps/api/src/config/champion-stats.config.ts apps/worker/src/config.ts .env.example apps/api/.env.example apps/worker/.env.example
git commit -m "feat(analytics): accumulate champion gold per minute at aggregation v2"
```

Operational (not a unit test): after deploy, `pnpm aggregates:rebuild-champions --confirm`. Playstyle GPM comparisons must not treat leftover v1 rows (`totalGoldEarned = 0`) as baselines — reads use version 2 only.

---

### Task 4: Per-match metrics and normalized profile aggregation

**Files:**

- Create: `packages/match-analytics/src/player-playstyle/metrics.ts`
- Create: `packages/match-analytics/src/player-playstyle/metrics.test.ts`
- Create: `packages/match-analytics/src/player-playstyle/aggregate-profile.ts`
- Create: `packages/match-analytics/src/player-playstyle/aggregate-profile.test.ts`

- [ ] **Step 1: Write failing tests for per-match metrics**

Input shape (plain data, no Prisma):

```ts
type PlayerPlaystyleMatchInput = {
  matchId: string;
  participantId: number;
  championId: number;
  position: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'SUPPORT' | 'UNKNOWN';
  patch: string;
  platformRoute: string;
  queueId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalCs: number;
  goldEarned: number;
  damageToChampions: number;
  visionScore: number;
  timePlayedSeconds: number;
  gameDurationSeconds: number;
  goldDifferenceAt10: number | null;
  goldDifferenceAt15: number | null;
  csDifferenceAt10: number | null;
  csDifferenceAt15: number | null;
  rankTier: string | null; // exact when RESOLVED_RANKED
  rankResolutionStatus: string;
};
```

Assert:

- `seconds` prefers `timePlayedSeconds` when > 0
- KDA perfect-game convention matches `computeAggregateKdaRatio`
- Null timeline diffs stay null (do not coerce to 0)
- UNKNOWN position still extracts metrics (eligibility happens later)

- [ ] **Step 2: Write failing tests for aggregate-profile**

Cover spec cases:

1. Two champions, different CS/min: overall `playerValue` **and** `baseline.value` for `CS_PER_MIN` are `null`; `delta` is mean of per-match deltas
2. Slice CS/min: `playerValue` = mean player CS/min; `baseline.value` = mean of **per-match selected** baseline CS/min (two patches → two baseline values averaged). **Fail the test if implementation uses a modal aggregate.**
3. Slice `KDA`: `playerValue === computeAggregateKdaRatio(n, ΣK, ΣD, ΣA)` (not mean of per-match KDAs); `baseline.value` = mean of matched `aggregateKdaRatio`; overall comparisons array has **no** `KDA` row
4. Match with insufficient baseline → excluded from that metric's `comparableMatchCount`
5. ALL-tier fallback sets `usedAllTierFallback` when any matched match used ALL
6. Slice with 4 analyzed games omitted; slice with 5 included
7. Max 3 slices, highest count then most recent
8. `<5` comparable matches → overall band INSUFFICIENT, no interpretationAllowed
9. Early diffs null on 4/5 games → `GOLD_DIFF_AT_10` NOT_COMPARABLE; CS_PER_MIN still allowed
10. `GOLD_PER_MIN` comparable when baseline `averageGoldPerMinute` present
11. Window accounting helper (if in this package): `remake + incomplete + unknownPosition + matchesAnalyzed = windowSize`; `noBaseline` does not shrink `matchesAnalyzed`

Baseline input is a lookup function/result map keyed by dimension tuple, not a DB call.

```ts
type BaselineLookupResult = {
  metrics: DerivedChampionAggregateMetrics;
  rankTier: 'ALL' | RankTier;
  usedAllTierFallback: boolean;
} | null;
```

- [ ] **Step 3: Implement metrics.ts and aggregate-profile.ts**

`buildPlayerPlaystyleProfile(matches, baselinesByMatchId): PlayerPlaystyleProfile` returns overall comparisons (**no KDA**), slices (including KDA via ratio-of-sums), mix, sample band.

Skipped counters: prefer classifying the **fixed window** in the API loader (Task 9) and passing `skipped` + analyzed matches into analytics. Analytics must not pull extra matches.

`interpretationAllowed` implementation must match spec §8.2 exactly.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @league-helper/match-analytics test -- player-playstyle
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/match-analytics/src/player-playstyle packages/match-analytics/src/index.ts
git commit -m "feat(analytics): aggregate baseline-normalized player playstyle profiles"
```

---

### Task 5: Prisma `PlayerPlaystyleInsight`

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260814120000_m17_player_playstyle_insight/migration.sql`
- Modify: every `TRUNCATE TABLE` list that includes `PlayerAnalysisReport` (API persistence, champions integration, worker rebuild/cli tests)

- [ ] **Step 1: Add enum + model + PlayerAccount relation** (`totalGoldEarned` already added in Task 3)

```prisma
enum PlayerPlaystyleInsightStatus {
  PENDING
  READY
  FAILED
}

model PlayerPlaystyleInsight {
  id                 String                        @id @default(uuid())
  playerAccountId    String
  queueId            Int
  contextFingerprint String
  promptVersion      String
  provider           String
  model              String
  status             PlayerPlaystyleInsightStatus  @default(PENDING)
  inputContext       Json
  structuredResult   Json?
  failureReason      String?
  generatedAt        DateTime?                     @db.Timestamptz(3)
  createdAt          DateTime                      @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime                      @updatedAt @db.Timestamptz(3)

  playerAccount PlayerAccount @relation(fields: [playerAccountId], references: [id], onDelete: Cascade)

  @@unique([playerAccountId, queueId, contextFingerprint], map: "PlayerPlaystyleInsight_scope_fp_key")
  @@index([playerAccountId, status])
  @@index([status, updatedAt])
}
```

Add `playerPlaystyleInsights PlayerPlaystyleInsight[]` on `PlayerAccount`.

Do **not** add columns to `PlayerMetricSnapshot` / `PlayerAnalysisReport`.

- [ ] **Step 2: Hand-write SQL migration** (do not `prisma migrate dev` until implementing; this task **is** the implementation step after approval)

Include enum create + table + indexes + unique. Mirror `20260813200000_m16_champion_ai_insights` style.

- [ ] **Step 3: Add `"PlayerPlaystyleInsight"` to every TRUNCATE list** that includes `PlayerAnalysisReport`

- [ ] **Step 4: Run persistence integration if the suite is in this change set**

```bash
pnpm --filter @league-helper/api test -- persistence.integration
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260814120000_m17_player_playstyle_insight
git commit -m "feat(db): add PlayerPlaystyleInsight for M17 fingerprint cache"
```

---

### Task 6: Canonical fingerprint helper + player AI context

**Files:**

- Create: `packages/ai/src/context/canonical-fingerprint.ts`
- Create: `packages/ai/src/context/canonical-fingerprint.test.ts`
- Modify: `packages/ai/src/context/fingerprint.ts` to call the helper
- Create: `packages/ai/src/context/player-playstyle-types.ts`
- Create: `packages/ai/src/context/player-playstyle-evidence.ts`
- Create: `packages/ai/src/context/player-playstyle-builder.ts`
- Create: `packages/ai/src/context/player-playstyle-builder.test.ts`
- Create: `packages/ai/src/context/player-playstyle-evidence.test.ts`

- [ ] **Step 1: Extract canonicalize**

`fingerprintCanonicalPayload({ context, promptVersion, model, provider })` must produce the same hex as current `fingerprintChampionInsightContext` for a frozen champion fixture (copy one champion fingerprint test as a regression).

- [ ] **Step 2: Write failing builder tests**

- `generationEligible` false when all comparisons `interpretationAllowed=false`
- Mixed-role overall: generation-facing overall comparisons have **no** numeric `delta` / `playerValue` / `baseline.value`
- Catalog has **no** `OVERALL_KDA` id; slice may have `SLICE_*_KDA` when allowed
- `GOLD_PER_MIN` overall id exists when that comparison is interpretation-allowed
- Disallowed metrics do not receive `E*` handles (`buildPlayerPlaystyleGenerationPayload`)
- Slice evidence ids include championKey and position
- Internal context includes sorted `matchIdentity` for fingerprint; generation payload omits match ids and playerAccountId
- `economyAllowed` / `combatAllowed` flags match spec §10.4
- Platform omitted from generation payload

- [ ] **Step 3: Implement builder + evidence**

Reuse `EVIDENCE_HANDLE_PATTERN` and handle mapping style from `evidence-handles.ts`. Prefer a shared `buildEvidenceHandleMapping(entries: {id, interpretationAllowed}[])` extracted if it avoids duplication; otherwise copy the small helper into player-playstyle-evidence.ts. Do not break champion handle tests.

- [ ] **Step 4: Run**

```bash
pnpm --filter @league-helper/ai test -- canonical-fingerprint fingerprint player-playstyle
```

Expected: PASS (including existing champion fingerprint tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/context
git commit -m "feat(ai): build grounded player playstyle context and citable evidence handles"
```

---

### Task 7: Prompts, JSON Schema, generation, numeric grounding

**Files:**

- Create: `packages/ai/src/prompts/player-playstyle-v1.ts`
- Create: `packages/ai/src/prompts/player-playstyle-v1.test.ts`
- Create: `packages/ai/src/validation/player-playstyle-output.ts`
- Create: `packages/ai/src/validation/player-playstyle-output.test.ts`
- Create: `packages/ai/src/generation/stored-player-playstyle.json-schema.ts`
- Create: `packages/ai/src/generation/generate-player-playstyle.ts`
- Create: `packages/ai/src/generation/generate-player-playstyle.test.ts`

- [ ] **Step 1: Write failing validation tests**

- Unknown evidence id → reject
- Statistical claim citing only `SCOPE_MIX` → reject
- `economy` non-null when `economyAllowed=false` → reject
- `championTendencies` for unknown championKey → reject
- Prose containing `6.1` or `7.0` → NUMERIC reject
- Patch token `14.16` when that patch is in scope allowlist → allowed
- HTML `<p>` → reject
- Handle `E1` resolves to canonical id in stored insight

Numeric allowlist: patch strings from internal `patchRange` only. Reuse `extractNumericTokens` from `grounding.ts`. Add `findDisallowedNumericTokenForTexts(texts, allowlist)` if the champion function is too champion-specific; do not weaken champion allowlist behavior.

- [ ] **Step 2: Implement prompt**

System prompt must include spec §10.6 bullets. User prompt is canonical JSON of the **generation** payload (handles, no numbers).

- [ ] **Step 3: Implement `generatePlayerPlaystyle`**

Copy control flow from `generateChampionInsight` (json_schema, parse, Zod, evidence, numeric, HTML, one repair, `AiOutputValidationError`). Do not modify `OpenAiCompatibleProvider`.

- [ ] **Step 4: Provider mock tests**

- Valid JSON → stored insight
- Retryable provider error propagates
- After repair still invalid → `AiOutputValidationError.retryable === false`

- [ ] **Step 5: Run**

```bash
pnpm --filter @league-helper/ai test -- player-playstyle generate-player-playstyle
```

- [ ] **Step 6: Commit**

```bash
git add packages/ai/src/prompts/player-playstyle-v1.ts packages/ai/src/prompts/player-playstyle-v1.test.ts packages/ai/src/validation/player-playstyle-output.ts packages/ai/src/validation/player-playstyle-output.test.ts packages/ai/src/generation/stored-player-playstyle.json-schema.ts packages/ai/src/generation/generate-player-playstyle.ts packages/ai/src/generation/generate-player-playstyle.test.ts packages/ai/src/index.ts
git commit -m "feat(ai): generate and ground player playstyle insights"
```

---

### Task 8: Offline eval fixtures

**Files:**

- Create: `packages/ai/src/eval/fixtures/player-playstyle/01-high-cs-low-dpm.json` through the spec §15 cases (at least 01–17)
- Create: `packages/ai/src/eval/player-playstyle-offline.ts`
- Create: `packages/ai/src/eval/player-playstyle-cli.ts`
- Modify: `package.json` add `"ai:eval:playstyle": "pnpm --filter @league-helper/ai eval:playstyle"`
- Modify: `packages/ai/package.json` scripts

- [ ] **Step 1: Fixture schema**

Each fixture: `id`, `description`, `expectGenerationEligible`, `expectEconomyAllowed`, `expectCombatAllowed`, `expectSliceChampionKeys`, `expectEvidenceNotCitable`, `expectOverallCsPlayerValueNull`, `expectNoOverallKda`, `input` (profile-shaped internal context **before** builder, or builder input).

Cover spec §15 cases 1–19. Include a window-accounting fixture and a matched-baseline (non-modal) slice fixture.

Do **not** invent KP baselines in fixtures.

- [ ] **Step 2: Offline runner**

Build context, assert eligibility/handles/no numeric generation fields. No provider calls.

- [ ] **Step 3: Run**

```bash
pnpm ai:eval:playstyle
```

Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add packages/ai/src/eval packages/ai/package.json package.json
git commit -m "test(ai): add offline player playstyle evaluation fixtures"
```

---

### Task 9: API GET + enqueue

**Files:**

- Create: `apps/api/src/config/player-playstyle-ai.config.ts` (+ test)
- Create: `apps/api/src/persistence/player-playstyle-insight.repository.ts`
- Create: `apps/api/src/queues/player-playstyle-insight.producer.ts`
- Create: `apps/api/src/features/players/player-playstyle-matches.ts`
- Create: `apps/api/src/features/players/player-playstyle.mapper.ts`
- Create: `apps/api/src/features/players/player-playstyle.service.ts` (+ test)
- Modify: `players.controller.ts`, `players.module.ts`, `queues.module.ts`, `queue.tokens.ts`
- Modify: `champion-aggregate-read.repository.ts` only if a batch `findByDimensionTuples` is needed; otherwise loop `findExact` with `minimumSample: 1` then apply confidence in analytics
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Match loader tests**

`loadPlaystyleWindow(accountId)` (spec §9):

- `queueId = 420`
- **Include remakes** (`includeRemakes: true`)
- **Do not** filter `ingestionStatus` at fetch time
- limit **20** by `gameCreation` desc — this is the fixed window
- Then classify skips: remake → incomplete → unknown position → structurally invalid (incomplete) → analyzed
- `skipped.remake + skipped.incomplete + skipped.unknownPosition + matchesAnalyzed === windowSize`
- `skipped.noBaseline` counted after baseline lookup; does not change `matchesAnalyzed`
- **Do not** fetch match 21+ to replace skips
- select fields needed for metrics **plus** `goldEarned`, `rankTierAtIngestion`, `rankResolutionStatus`, `timePlayedSeconds`, `totalDamageDealtToChampions`, `visionScore`, `normalizedPatch`, `platformRoute`, `remake`, `ingestionStatus`
- never select `externalAccountId` / `rawPayload`

- [ ] **Step 2: Service tests (mocked repos)**

- Unknown player → not found error (same as profile)
- `AI_ENABLED=false` → comparisons present, `ai.status=DISABLED`
- <5 comparable → `LOW_CONFIDENCE`, no enqueue
- Eligible + no row → upsert PENDING + enqueue
- READY matching fingerprint → `AVAILABLE` with stripped public insight
- Fresh FAILED → `UNAVAILABLE`
- Response `assertNoPuuidLeak`

Baseline lookup: exact rank then ALL. Use existing `ChampionAggregateReadRepository` + `deriveChampionAggregateMetrics` + `CHAMPION_STATS_CONFIG` versions. `regionalRoute` from `getRegionalRouteForPlatform(platform)`.

- [ ] **Step 3: Controller**

```ts
@Get(':playerId/playstyle')
getPlaystyle(@Param('playerId', ParseUUIDPipe) playerId: string) {
  return this.playstyleService.getPlaystyle(playerId);
}
```

Register **before** any conflicting wildcard if needed; current controller already uses `:playerId/...` siblings.

- [ ] **Step 4: Config**

Share `AI_*` via `loadChampionAiConfig` **or** a thin `loadPlayerPlaystyleAiConfig` that reads the same `AI_*` plus `PLAYER_AI_PLAYSTYLE_*` queue knobs. Do not invent `PLAYER_AI_ENABLED`.

- [ ] **Step 5: Run**

```bash
pnpm --filter @league-helper/api test -- player-playstyle players.integration
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/player-playstyle-ai.config.ts apps/api/src/config/player-playstyle-ai.config.test.ts apps/api/src/persistence/player-playstyle-insight.repository.ts apps/api/src/queues/player-playstyle-insight.producer.ts apps/api/src/features/players apps/api/src/queues apps/api/.env.example
git commit -m "feat(api): serve deterministic player playstyle and enqueue AI generation"
```

---

### Task 10: Worker processor

**Files:**

- Create: `apps/worker/src/queues/player-playstyle-insight/player-playstyle-insight.processor.ts` (+ test)
- Create: `apps/worker/src/queues/player-playstyle-insight/player-playstyle-insight.worker.ts`
- Modify: `apps/worker/src/config.ts`, `apps/worker/src/main.ts`, `apps/worker/.env.example`, `apps/worker/package.json`

- [ ] **Step 1: Copy champion processor control flow**

- Parse `PlayerPlaystyleInsightJobPayloadSchema`
- Load row by `insightId`; no-op if missing or not PENDING
- `generatePlayerPlaystyle` from stored `inputContext`
- Retryable `AiProviderError` → throw
- Terminal validation → `markFailed` + `UnrecoverableError`
- Success → `markReady`
- `failed` handler marks FAILED when attempts exhausted
- Truncate `failureReason` to 500
- Do not log `inputContext` (may contain match ids). Log `safeJobId` only.

- [ ] **Step 2: Worker boots with `AI_ENABLED=false`** (idle consumer ok) and with Ollama down (do not connect on startup)

- [ ] **Step 3: Run**

```bash
pnpm --filter @league-helper/worker test -- player-playstyle-insight
```

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/queues/player-playstyle-insight apps/worker/src/config.ts apps/worker/src/main.ts apps/worker/.env.example
git commit -m "feat(worker): generate player playstyle insights asynchronously"
```

---

### Task 11: Frontend

**Files:**

- Create: `apps/web/utils/ai-insight-poll.ts` (move logic from `champion-insights-poll.ts`; keep champion file as re-export to avoid breaking imports)
- Create: `apps/web/components/player/PlayerPlaystylePanel.vue` (+ test)
- Create: `apps/web/components/player/PlayerPlaystyleAiPanel.vue` (+ test)
- Modify: `apps/web/composables/usePlayerApi.ts`
- Modify: `apps/web/composables/usePlayerProfilePage.ts` and its test
- Modify: `apps/web/pages/players/[playerId].vue`
- Modify: `apps/web/e2e/player-search.e2e.ts` if the player page is loaded (mock `GET /playstyle` so e2e does not depend on Qwen)

- [ ] **Step 1: API client**

`getPlaystyle(playerId)` → `GET /api/players/:id/playstyle`. Do not attach to profile GET.

- [ ] **Step 2: Panel tests**

- INSUFFICIENT: message, no direction rows
- CREDIBLE overall: Farming/Combat groups, direction labels, **no** overall CS/min number, **no** overall KDA row
- Champion slice: You / Baseline / Δ visible (matched-baseline means)
- `DISABLED`: comparison cards yes, AI panel omitted
- `PENDING`: "Generating AI playstyle analysis…"
- `AVAILABLE`: summary + optional sections; no evidence ids in HTML
- Playstyle fetch error: banner, match list still rendered (page test)

- [ ] **Step 3: Insert in page order**

Hero → Ranked overview → **Playstyle** → Mastery → Match list.

Poll while `ai.status === PENDING` using shared poll delays (2s / 4s / 8s, max 120s).

- [ ] **Step 4: Run**

```bash
pnpm --filter @league-helper/web test -- PlayerPlaystyle
pnpm --filter @league-helper/web test -- usePlayerProfilePage
```

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): show player playstyle comparisons and grounded AI analysis"
```

---

### Task 12: Docs, env, README

**Files:**

- Modify: `.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`, `README.md`

- [ ] **Step 1: Document**

- `GET /api/players/:playerId/playstyle`
- Ranked Solo **fixed 20-match window, then skip** (no backfill)
- Collected-sample + ingestion-rank semantics
- `AI_ENABLED=false` default; playstyle cards still work
- Shared `AI_MODEL` default **`qwen2.5:14b`** (still overridable)
- `pnpm ai:eval:playstyle` and live `--live`
- `CHAMPION_AGGREGATION_VERSION=2` and `pnpm aggregates:rebuild-champions --confirm` after gold column
- Two AI queues both concurrency 1 (GPU)
- Never `NUXT_PUBLIC_*` for AI secrets

- [ ] **Step 2: Commit**

```bash
git add .env.example apps/api/.env.example apps/worker/.env.example README.md
git commit -m "docs: document M17 player playstyle analysis"
```

---

### Task 13: Full verification

- [ ] **Step 1: Format, lint, typecheck, tests**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```

Fix failures caused by this milestone only.

- [ ] **Step 2: Confirm negatives**

- ChampionAggregate gained **only** `totalGoldEarned` (no KP columns)
- No PlayerMetricSnapshot writes
- Default `AI_MODEL` is `qwen2.5:14b` when unset; `AI_ENABLED` default false
- No `RIOT_API_KEY` in web
- `assertNoPuuidLeak` on playstyle
- Champion insight tests still pass (performance schema unchanged)
- `NEAR` at exact threshold; no `OVERALL_KDA`

- [ ] **Step 3: Final commit only if verification produced extra fixes**

---

## Spec coverage checklist

| Spec section                                                          | Task                         |
| --------------------------------------------------------------------- | ---------------------------- |
| Near-bands inclusive `<=`                                             | 2                            |
| ChampionAggregate GPM + version 2                                     | 3                            |
| Mixed-role normalized deltas; slice matched baselines; no overall KDA | 4                            |
| Sample bands / eligibility                                            | 2, 4, 9                      |
| Persistence table                                                     | 5                            |
| Evidence + handles + no numbers to Qwen; no OVERALL_KDA               | 6, 7                         |
| Fingerprint lifecycle                                                 | 6, 9, 10                     |
| Fixed 20-window then skip                                             | 9                            |
| API                                                                   | 9                            |
| Worker retry classes                                                  | 10                           |
| UI placement + qualitative AI                                         | 11                           |
| Eval fixtures 1–19                                                    | 8                            |
| Privacy                                                               | 6, 9, 10                     |
| `AI_MODEL` default 14b                                                | 10, 12, 13                   |
| Deferred KP / coaching / chatbot                                      | (no task — do not implement) |

## Placeholder scan

No TBD. KP remains an explicit non-task. Gold/min is Task 3.

## Type consistency

- Metric ids: `CS_PER_MIN`, `GOLD_PER_MIN`, `DAMAGE_PER_MIN`, `VISION_PER_MIN`, `KDA` (slice only), `KILLS_PER_GAME`, `DEATHS_PER_GAME`, `ASSISTS_PER_GAME`, `GOLD_DIFF_AT_10`, `GOLD_DIFF_AT_15`, `CS_DIFF_AT_10`, `CS_DIFF_AT_15`
- Directions: `ABOVE_BASELINE | NEAR_BASELINE | BELOW_BASELINE | NOT_COMPARABLE` with `NEAR` iff `abs(delta) <=` band
- Public AI status: `DISABLED | PENDING | AVAILABLE | UNAVAILABLE | LOW_CONFIDENCE`
- DB status: `PENDING | READY | FAILED`
- Prompt version: `player-playstyle-v1`
- Queue: `player-ai-playstyle` / `GENERATE_PLAYER_PLAYSTYLE_INSIGHT`
- Aggregation version: `2`
- Default `AI_MODEL`: `qwen2.5:14b`

---

**Plan updated for approved spec revisions.** Do not implement production code until the implementation pass starts.

Two execution options after that:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in-session with checkpoints
