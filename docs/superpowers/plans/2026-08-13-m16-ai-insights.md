# Milestone 16 Champion AI Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship grounded Qwen explanations of existing champion analytics (summary, build/rune/skill, selected matchups) without replacing deterministic statistics or coupling the app to one serving vendor.

**Architecture:** `@league-helper/ai` splits **transport** (`AiProvider`: HTTP, `json_schema` with `json_object` fallback, raw text) from the **generation layer** (prompts, parse, Zod, evidence, numeric grounding, one repair). `@league-helper/shared` owns public DTOs and the BullMQ job contract; API builds context from existing champion read services and enqueues; worker generates asynchronously and distinguishes retryable provider errors from terminal validation failures; Postgres stores durable insights; Nuxt renders supplemental copy on existing Overview / Builds / Matchups tabs. Spec: `docs/superpowers/specs/2026-08-13-m16-ai-insights-design.md`.

**Tech Stack:** pnpm monorepo, TypeScript, Zod, NestJS, BullMQ, Prisma/PostgreSQL, Nuxt 3, Vitest, Playwright. Native `fetch` to OpenAI-compatible `/v1/chat/completions`. No LangChain, no OpenAI SDK.

**Plan decisions (resolve spec ambiguities):**

1. Hashed context **omits** `calculatedAt` / `latestEligibleMatchAt` so cache hits survive recalc timestamps when metrics are unchanged.
2. Insights query = `ChampionBuildsQuerySchema` (required `position`, public `tier`). Do not add `rankScope` until the champion page sends it.
3. Public insight DTO strips evidence IDs. Evidence stays in `structuredResult` JSON for debug/tests.
4. `DISABLED` UI = omit the section. Do not show “AI disabled”.
5. Root `pnpm ai:eval` is offline/CI-safe. Live Qwen is `--live` only. `qwen2.5:7b` is the M16 eval/default model, not a product lock.
6. Manual Prisma migration timestamp: `20260813200000_m16_champion_ai_insights` (after M15 `20260813180000`).
7. Provider tries `response_format.json_schema` first; in-request fallback to `json_object` if unsupported. Provider returns raw text + `structuredOutputMode`.
8. Numeric grounding allowlist = ability-verbatim numbers + matching patch string only. Correct restatements of win rate / sample size / KDA / CS / DPM / diffs are rejected.
9. `AiProviderError.retryable` vs `AiOutputValidationError`: worker rethrows retryable; terminal path `markFailed` then `UnrecoverableError`. Exhausted retries marked FAILED in the worker `failed` handler.
10. Partial eligibility: INSUFFICIENT performance + CREDIBLE build → generate; forbid performance statistical evidence; allow build insight.

---

## File structure (create / modify)

### Create

```text
packages/ai/                                         # new package
packages/ai/package.json
packages/ai/tsconfig.json
packages/ai/eslint.config.mjs
packages/ai/vitest.config.mts
packages/ai/src/index.ts
packages/ai/src/provider/types.ts
packages/ai/src/provider/errors.ts
packages/ai/src/provider/openai-compatible.ts
packages/ai/src/provider/openai-compatible.test.ts
packages/ai/src/prompts/champion-insight-v1.ts
packages/ai/src/prompts/champion-insight-v1.test.ts
packages/ai/src/context/evidence.ts
packages/ai/src/context/builder.ts
packages/ai/src/context/builder.test.ts
packages/ai/src/context/fingerprint.ts
packages/ai/src/context/fingerprint.test.ts
packages/ai/src/validation/output.ts
packages/ai/src/validation/grounding.ts
packages/ai/src/validation/output.test.ts
packages/ai/src/validation/partial-eligibility.test.ts
packages/ai/src/generation/stored-insight.json-schema.ts
packages/ai/src/generation/generate-champion-insight.ts
packages/ai/src/generation/generate-champion-insight.test.ts
packages/ai/src/eval/fixtures/*.json
packages/ai/src/eval/run-eval.ts
packages/ai/src/eval/cli.ts

packages/shared/src/champion-insights.ts
packages/shared/src/champion-insights.test.ts
packages/shared/src/job-queues/champion-ai-insight-job.ts
packages/shared/src/job-queues/champion-ai-insight-job.test.ts

apps/api/prisma/migrations/20260813200000_m16_champion_ai_insights/migration.sql
apps/api/src/config/champion-ai.config.ts
apps/api/src/config/champion-ai.config.test.ts
apps/api/src/persistence/champion-ai-insight.repository.ts
apps/api/src/queues/champion-ai-insight.producer.ts
apps/api/src/features/champions/champion-insights.service.ts
apps/api/src/features/champions/champion-insights.service.test.ts
apps/api/src/features/champions/champion-insights.mapper.ts

apps/worker/src/queues/champion-ai-insight/champion-ai-insight.worker.ts
apps/worker/src/queues/champion-ai-insight/champion-ai-insight.processor.ts
apps/worker/src/queues/champion-ai-insight/champion-ai-insight.processor.test.ts

apps/web/components/champions/ChampionAiInsightPanel.vue
apps/web/components/champions/ChampionAiInsightPanel.test.ts
apps/web/components/champions/ChampionAiMatchupWhy.vue
```

### Modify

```text
apps/api/prisma/schema.prisma
apps/api/src/persistence/persistence.integration.test.ts
apps/api/src/features/champions/champions.controller.ts
apps/api/src/features/champions/champions.module.ts
apps/api/src/features/champions/champions.integration.test.ts
apps/api/src/queues/queue.tokens.ts
apps/api/src/queues/queues.module.ts
apps/api/package.json
apps/api/.env.example
apps/worker/src/main.ts
apps/worker/src/config.ts
apps/worker/package.json
apps/worker/.env.example
apps/worker/src/cli/aggregates/aggregates-cli.test.ts   # TRUNCATE list
apps/worker/src/queues/champion-build-aggregation/rebuild-core.test.ts
apps/worker/src/queues/champion-matchup-aggregation/rebuild-core.test.ts
packages/shared/src/index.ts
packages/shared/src/job-queues/queue-names.ts
packages/shared/src/job-queues/index.ts
package.json                                            # postinstall build + ai:eval
.env.example
apps/web/composables/useChampionApi.ts
apps/web/pages/champions/[championKey].vue
apps/web/components/champions/ChampionBuildsPanel.vue
apps/web/components/champions/ChampionMatchupsPanel.vue
apps/web/e2e/champion-api.mocks.ts
apps/web/e2e/champions.e2e.ts
README.md
```

Do **not** modify `@league-helper/match-analytics` formulas, ranking floor, or matchup pairing.

---

### Task 1: Shared public contracts

**Files:**
- Create: `packages/shared/src/champion-insights.ts`
- Create: `packages/shared/src/champion-insights.test.ts`
- Create: `packages/shared/src/job-queues/champion-ai-insight-job.ts`
- Create: `packages/shared/src/job-queues/champion-ai-insight-job.test.ts`
- Modify: `packages/shared/src/job-queues/queue-names.ts`
- Modify: `packages/shared/src/job-queues/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add queue names**

```ts
export const CHAMPION_AI_INSIGHT_QUEUE_NAME = 'champion-ai-insight' as const;
export const CHAMPION_AI_INSIGHT_JOB_NAME = 'GENERATE_CHAMPION_AI_INSIGHT' as const;
```

- [ ] **Step 2: Add public DTO schemas in `champion-insights.ts`**

Export:

- `CHAMPION_AI_DISCLAIMER` (exact spec sentence)
- `CHAMPION_AI_PROMPT_VERSION = 'champion-insight-v1'`
- `ChampionAiInsightStatusSchema` = `DISABLED | PENDING | AVAILABLE | UNAVAILABLE | LOW_CONFIDENCE`
- `ChampionAiInsightsEmptyReasonSchema`
- `ChampionAiInsightsQuerySchema` = `ChampionBuildsQuerySchema`
- `ChampionAiPublicInsightSchema` (no evidence ids)
- `ChampionAiInsightsResponseSchema` (disclaimer + aiDisclaimer + sampleScope + resolvedFilters + status + emptyReason optional + insight nullable)
- Internal `ChampionAiGroundedClaimSchema` / `ChampionAiStoredInsightSchema` (with evidence) for worker/API persistence validation — export from shared so API/worker/ai agree

Text bounds: summary 80–600; claim 40–400; matchup text 40–500; evidence min 1; strengths/weaknesses max 3; matchupInsights max 6.

- [ ] **Step 3: Job payload**

```ts
export const ChampionAiInsightJobPayloadSchema = z.object({
  insightId: z.string().uuid(),
  contextFingerprint: z.string().min(16).max(64),
  correlationId: z.string().min(1).max(128).optional(),
});
```

`buildChampionAiInsightBullMqJobId({ contextFingerprint })` → `ai_champ_` + first 24 hex chars, max 128.

- [ ] **Step 4: Tests + export from `index.ts`**

Zod parse happy path; reject missing position; job id length; re-export types.

- [ ] **Step 5: Run** `pnpm --filter @league-helper/shared test` and `typecheck`

---

### Task 2: `@league-helper/ai` package skeleton

**Files:** package.json / tsconfig / eslint / vitest copied from `packages/match-analytics` (depend on `shared` + `zod` only).

- [ ] **Step 1: Scaffold package; add to root `postinstall` / `build` after shared, before match-analytics is fine (ai depends only on shared)**

Root `package.json`:

- `postinstall`: also `pnpm --filter @league-helper/ai build`
- `"ai:eval": "pnpm --filter @league-helper/ai eval"`

- [ ] **Step 2: `src/index.ts` barrel** — will fill in later tasks; empty export placeholder fails typecheck until Task 3.

---

### Task 3: Context builder, evidence, fingerprint (TDD)

**Files:** `packages/ai/src/context/*`

- [ ] **Step 1: Write failing tests for builder**

Fixtures constructed from minimal `ChampionStatsResponse` / `ChampionBuildsResponse` / `ChampionMatchupsResponse` / abilities:

1. Copies sampleSize, wins, winRate, sampleConfidence; does not invent pick/ban rate
2. Omits `iconUrl` / splash from context
3. Omits `BELOW_DISPLAY` core builds
4. Marks `EXPLORATORY` / matchup `lowSample` as `interpretationAllowed: false`
5. `generationEligible === false` when stats INSUFFICIENT, no CREDIBLE/STRONG build, no non-lowSample matchup
6. **Partial eligibility:** stats INSUFFICIENT + one CREDIBLE core + no eligible matchups → `generationEligible === true`, `performanceConclusionsAllowed === false`, `buildInsightAllowed === true`, `matchupExplanationsAllowed === false`; `CHAMPION_WIN_RATE` has `interpretationAllowed: false`; `BUILD_CORE_PRIMARY` has `interpretationAllowed: true`
7. Evidence ids include `CHAMPION_WIN_RATE`, `BUILD_CORE_PRIMARY`, `MATCHUP_STRONG_<key>`, `ABILITY_<key>_E`
8. Caps matchups at 3+3 and cores at 2

- [ ] **Step 2: Implement `buildChampionInsightContext(input)` + `listEvidenceIds(context)`**

Input type: `{ champion, scope, stats, builds, matchups, abilities, opponentAbilities? }`. Truncate ability descriptions to 400 chars. Export `performanceConclusionsAllowed`, `buildInsightAllowed`, `matchupExplanationsAllowed`, and evidence catalog entries `{ id, interpretationAllowed }`.

- [ ] **Step 3: Fingerprint tests**

Same context → same sha256 hex; change winRate → different; change prompt version → different; change model → different; adding `calculatedAt` on stats must **not** change hash (omit volatile timestamps when canonicalizing).

Use Node `crypto.createHash('sha256')`. Canonicalize with sorted keys.

- [ ] **Step 4: Run** `pnpm --filter @league-helper/ai test`

---

### Task 4: Output validation + grounding (TDD)

**Files:** `packages/ai/src/validation/*`

- [ ] **Step 1: Failing tests**

Reject: truncated JSON; evidence `NOT_A_REAL_ID`; missing summary; 5000-char text; opponent key `Zed` when context only has `Syndra`; `side: STRONG` for a weak-only opponent; HTML `<script>`.

Numeric grounding (qualitative policy):

- Reject `54.8%` when context winRate is `0.512`
- Reject **correct** restatement `51.2%` / `51.2 percent`
- Reject `120 games`, `n=8`, `KDA 3.2`, `8.4 CS/min`, `+212 gold at 10`
- Accept qualitative “slightly above even in this collected sample”
- Accept ability cooldown digits that appear verbatim in supplied ability text (e.g. `12/11/10`)
- Accept patch `16.15` when `scope.patch === '16.15'`
- When performance **is** allowed: accept qualitative summary citing `CHAMPION_WIN_RATE` with no digits

Partial eligibility (same INSUFFICIENT + CREDIBLE-build fixture as Task 3):

- Accept `buildInsight` citing `BUILD_CORE_PRIMARY`
- Reject summary/strengths that cite `CHAMPION_WIN_RATE`
- Accept summary citing `BUILD_CORE_PRIMARY` + `CONFIDENCE_WARNING` with no performance statistical ids
- Reject matchupInsights when no allowed matchups exist
- Reject ability-only evidence as the sole support for a statistical conclusion

- [ ] **Step 2: Implement `validateChampionAiInsight(raw, context)`**

Order: JSON parse (strip a single ```json fence if present) → stored Zod schema → evidence catalog membership → `interpretationAllowed` on statistical ids → opponent/side/slice rules → numeric allowlist (`extractNumericTokens` vs ability+patch allowlist; **do not** allowlist analytics stats) → reject `/<[a-z][\s\S]*>/i`.

- [ ] **Step 3: Run package tests**

---

### Task 5: Prompt module + transport provider + generation layer

**Files:** `packages/ai/src/prompts/champion-insight-v1.ts`, `provider/*`, `generation/*`

- [ ] **Step 1: Prompt module**

Export `CHAMPION_AI_PROMPT_VERSION`, `buildChampionInsightSystemPrompt()`, `buildChampionInsightUserPrompt(context)`. System prompt includes every locked rule from spec §10, including qualitative-only numbers and partial eligibility. User prompt is context JSON + allowed evidence id list (with `interpretationAllowed`) + schema reminder. Temperature not in prompt (request field).

Test: system prompt contains “Never invent”, “qualitative”, and “interpretationAllowed”; does not contain API keys.

- [ ] **Step 2: Hand-maintained JSON Schema companion** `stored-insight.json-schema.ts` matching `ChampionAiStoredInsightSchema`. Zod remains validation source of truth. Used only as `response_format.json_schema.schema`.

- [ ] **Step 3: Transport provider (no Zod, no grounding)**

`OpenAiCompatibleProvider.generate(request)`:

1. POST with `response_format: { type: 'json_schema', json_schema: { name: request.jsonSchemaName, strict: true, schema: request.jsonSchema } }`
2. On unsupported-mode 400/422, retry **once** with `{ type: 'json_object' }`
3. Return `{ content, structuredOutputMode }`
4. Timeout/429/5xx/network → `AiProviderError({ retryable: true })`
5. 401/403 → `AiProviderError({ retryable: false })`

Unit tests with mock `fetch` (no network):

- 200 json_schema success
- json_schema 400 then json_object 200 (fallback)
- 500 → retryable error
- abort → retryable timeout
- Provider module does not import Zod insight schemas

- [ ] **Step 4: `generateChampionInsight({ provider, context, config })`**

Build prompts + JSON Schema → `provider.generate` → parse → Zod → evidence → numeric grounding → on validation failure, one repair generate with error text → still invalid throw `AiOutputValidationError` (not retryable). Provider retryable errors propagate.

Tests with a fake provider that returns raw strings:

- valid qualitative JSON accepted
- bad evidence then valid on repair
- always-invalid → `AiOutputValidationError`
- fake throws retryable → same error type bubbles (generation does not mark it validation)
- fake reports `structuredOutputMode: 'json_object'` still validates in generation layer

---

### Task 6: Prisma model + migration

**Files:** `schema.prisma`, `migrations/20260813200000_m16_champion_ai_insights/migration.sql`

- [ ] **Step 1: Add enum `ChampionAiInsightStatus` and model exactly as spec §12**
- [ ] **Step 2: SQL migration creating enum + table + unique + indexes**
- [ ] **Step 3: Add `"ChampionAiInsight"` to every `TRUNCATE TABLE` list that includes `PlayerAnalysisReport`** (API persistence + champions integration + worker rebuild/cli tests)
- [ ] **Step 4:** `pnpm db:generate` (and document `pnpm db:migrate` for local)

Do not add FKs to `ChampionStaticData` (that table is patch-scoped; insights are analytics-scoped).

---

### Task 7: API config, repository, producer, service, endpoint

**Files:** listed in Create/Modify for apps/api

- [ ] **Step 1: `loadChampionAiConfig()`** — parse booleans/ints like `champion-stats.config.ts`. When `AI_ENABLED` is unset/false, `enabled: false` even if base URL is set. Never throw solely because Ollama is down.

- [ ] **Step 2: Repository** — `findByScopeFingerprint`, `upsertPending`, `markReady`, `markFailed`

- [ ] **Step 3: Producer** — copy match-ingestion LIVE-state dedupe; token `CHAMPION_AI_INSIGHT_QUEUE`; register Queue in `QueuesModule` only using `createBullMqConnectionOptions` (not shared ioredis). If `enabled` is false, producer can no-op.

- [ ] **Step 4: `ChampionInsightsService.getInsights(championKey, query)`** implements spec §11 GET behavior. Reuse `ChampionStaticService.requireByKey`, `ChampionStatsService.getChampionStats` (with position), `ChampionBuildsService.getBuilds`, `ChampionMatchupsService.getMatchups`. Map UNKNOWN via same `legacyTierFilterToRankScope` as builds. Map stored result → public DTO (strip evidence).

Unit-test the state machine with fakes (no Qwen, no Redis required if queue is mocked): DISABLED, LOW_CONFIDENCE, AVAILABLE hit, PENDING, FAILED cooldown, enqueue on miss, enqueue failure → UNAVAILABLE 200, unknown champion throws `ChampionNotFoundError`.

- [ ] **Step 5: Controller** — `GET :championKey/insights` **before** `:championKey`. `parseRequest(ChampionAiInsightsQuerySchema, ...)`.

- [ ] **Step 6: Integration test** — 404 numeric/unknown key; 400 missing position; DISABLED when config off (can inject config). Do not require live Qwen.

- [ ] **Step 7:** Wire module providers + `apps/api/package.json` dependency on `@league-helper/ai`

---

### Task 8: Worker consumer

**Files:** `apps/worker/src/queues/champion-ai-insight/*`, `main.ts`, `config.ts`

- [ ] **Step 1: `loadChampionAiInsightWorkerConfig()`** — queue name, concurrency default 1, attempts, plus AI provider settings (same env names). If `AI_ENABLED=false`, still construct worker but processor marks unexpected jobs FAILED with `AI_DISABLED` (API should not enqueue). Safer: always start consumer so enabling AI does not require a different binary; idle when no jobs.

- [ ] **Step 2: Processor**

Validate job name + payload → load row by `insightId` → if missing, UnrecoverableError → if READY, return `{ status: 'already_ready' }` → `generateChampionInsight` using `inputContext` parsed with context Zod schema.

Error handling (required):

- Success → `markReady`
- `AiOutputValidationError` or non-retryable `AiProviderError` → `markFailed` (`VALIDATION` / `GROUNDING` / `PROVIDER_AUTH`) **then** throw `UnrecoverableError` (no BullMQ retry of a deterministic bad generation)
- Retryable `AiProviderError` → **do not** `markFailed`; rethrow so BullMQ retries; row stays PENDING
- Worker `failed` handler: if attempts exhausted, `markFailed('PROVIDER_RETRY_EXHAUSTED')`

Do not log full prompt. Truncate failureReason to ~500 chars.

- [ ] **Step 3: Register in `main.ts`** — create Queue + Worker; include in shutdown and queue probe list. Attach `failed` handler for retry exhaustion.

- [ ] **Step 4: Processor unit test** with fake provider + prisma mock or test DB:

- validation error → FAILED and UnrecoverableError (attempts not retried)
- retryable timeout → error thrown, status still PENDING
- exhausted retries path marks FAILED

- [ ] **Step 5:** `apps/worker/package.json` dependency on `@league-helper/ai`

---

### Task 9: Frontend

**Files:** composable, page, two panels, tests, e2e mocks

- [ ] **Step 1: `useChampionApi().getChampionInsights(key, opts)`** — map UI `queue` → `queueId`; parse `ChampionAiInsightsResponseSchema`; throw `ChampionApiError` on 4xx the same way as other champion calls. 200 statuses are success.

- [ ] **Step 2: Page fetch** — when `filters.position` is set, load insights in parallel with stats (or on same watch as builds). Request-id guard. Insights fetch failure sets local `insightsError` but **must not** set `statsError`.

- [ ] **Step 3: `ChampionAiInsightPanel`** — props: response, pending, error, variant `'overview' | 'builds'`. Overview shows summary + strengths/weaknesses; builds shows `buildInsight`. Omit entirely when status `DISABLED` or response null and not pending. `data-testid="champion-ai-insight"`.

- [ ] **Step 4: Overview insert** after performance cards, before position breakdown.

- [ ] **Step 5: Builds panel** — optional `insight` prop; render explanation after low-sample banner.

- [ ] **Step 6: Matchups** — `ChampionAiMatchupWhy` under a row when `matchupInsights` contains that opponent key. Stats (win rate, games, confidence) remain in the existing column.

- [ ] **Step 7: Pending poll** — if status PENDING, `setTimeout` 2s then 4s (max 2–3 retries) to refetch; clear on unmount.

- [ ] **Step 8: Component tests** — available copy; unavailable text; pending; DISABLED renders empty; does not render HTML if text somehow contained tags (assert `v-text` / mustache, not `v-html`).

- [ ] **Step 9: E2E mock** — add `/insights` route returning AVAILABLE fixture; assert Overview shows “AI Insight” and disclaimer; assert body still has no `ai coaching`; assert primary stats still show games.

---

### Task 10: Eval harness + docs/env

- [ ] **Step 1: 12+ fixture JSON files** covering spec §17 cases. Each fixture is a context-builder input (not live DB). Include an explicit **partial-eligibility** fixture (INSUFFICIENT performance + CREDIBLE build).

- [ ] **Step 2: `eval` script**

Offline (default, CI): build context, assert `expectGenerationEligible`, `expectPerformanceConclusionsAllowed`, `expectBuildInsightAllowed`, `expectEvidenceContains` / `expectEvidenceNotCitable`.

`--live`: call configured `AI_MODEL` (docs default `qwen2.5:7b` as M16 eval baseline). Print each fixture output. Print a **summary metrics table** per spec §17: fixtures, skipped_ineligible, generated, json_schema_mode, json_object_mode, validation_pass/fail, repair_used, terminal_validation_fail, retryable_provider_fail, numeric_grounding_fail, evidence_fail, p50_ms, p95_ms, model. Exit non-zero on live validation_fail or retryable_provider_fail. Exit 0 if `AI_ENABLED=false` (print skipped). No LLM-as-judge.

- [ ] **Step 3: Env examples** — root `.env.example`, `apps/api/.env.example`, `apps/worker/.env.example` with `AI_ENABLED=false` and commented Ollama instructions. Never put a real key.

- [ ] **Step 4: README** — replace “AI coaching generation is not implemented yet” with M16 champion insights: off by default, Ollama pull/serve, `GET /insights`, AI is supplemental, player coaching still deferred.

---

### Task 11: Verification

Run and fix failures caused by this milestone:

```text
pnpm --filter @league-helper/shared test
pnpm --filter @league-helper/ai test
pnpm --filter @league-helper/ai eval
pnpm --filter @league-helper/api test:unit
pnpm --filter @league-helper/api test:integration
pnpm --filter @league-helper/worker test
pnpm --filter @league-helper/web test
pnpm typecheck
pnpm lint
pnpm --filter @league-helper/web exec playwright test e2e/champions.e2e.ts   # if env allows
```

Do not claim complete without command output.

---

## Architecture review (plan vs repo)

| Existing contract | Plan alignment | Risk if ignored |
|---|---|---|
| `GET .../builds` requires `position` | Insights use same query schema | Incompatible filters / 400 vs UI |
| UI query param `queue` maps to API `queueId` | Composable mapping unchanged | Silent wrong-queue insights |
| `UNKNOWN` hidden on builds/matchups | Same short-circuit | AI explaining hidden rank |
| Ranking floor 30 vs detail visibility 1 vs build bands vs matchup floor 10 | Context uses each system’s own flags (`sampleConfidence`, `sampleBand`, `lowSample`) plus slice `interpretationAllowed` | Prompt treating n=8 matchup as HIGH, or letting a CREDIBLE build unlock win-rate claims |
| Redis gen cache for stats/builds/matchups | Unchanged; insights not cached in Redis | Unnecessary coupling |
| `PlayerAnalysisReport` is player-scoped and unused | Dedicated table | Semantic collision with future player AI |
| BullMQ LIVE-state job ids | Same producer pattern | Duplicate Qwen calls |
| Champion controller route order | `/insights` before `/:championKey` | `:championKey` captures `insights` |
| E2E forbids “ai coaching” | Copy uses “AI Insight” / “AI explanation” | False e2e failure |
| `match-analytics` is deterministic-only | No LLM code there | Architecture regression |
| Worker cannot import Nest services | Context built in API, stored on row | Duplicate mappers in worker |
| No OpenAI package today | Native fetch; `json_schema` then `json_object` fallback | Extra vendor SDK; Ollama-only coupling |
| BullMQ retries on 5xx | Retryable `AiProviderError` rethrown; validation uses `UnrecoverableError` | Schema failures multiplied 3× against a local GPU |

**Conflicts with requested product text:** none material. Suggested `AI_PROVIDER=qwen` is adapter `openai_compatible` + `AI_MODEL=qwen2.5:7b` as the **M16 eval/default**, not a permanent lock.

**Intentionally deferred (do not implement in this plan):**

- Player AI Analysis / coaching
- Chatbot, RAG, VOD, agents, LLM-as-judge
- Redis hot cache for insights
- `rankScope` on insights query
- Matchup explanations beyond top 3+3
- Precompute popular scopes
- Qwen3 / thinking models as the default
- Exposing evidence IDs in UI
- Allowlisting restated analytics numbers in AI prose

---

## Local verify (after implementation)

```bash
# AI off (default)
pnpm dev

# AI on
ollama pull qwen2.5:7b
ollama serve
# set AI_ENABLED=true and optionally AI_MODEL=qwen2.5:7b in apps/api/.env and apps/worker/.env
pnpm dev
# open /champions/Ahri?position=MIDDLE&...
pnpm ai:eval -- --live   # summary metrics table; model is whatever AI_MODEL is
```
