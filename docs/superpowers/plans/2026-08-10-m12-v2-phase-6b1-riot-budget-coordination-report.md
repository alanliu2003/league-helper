# M12-v2 Phase 6B.1 Report — Proactive Riot Request Budget Coordination

**Date:** 2026-08-11  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2`  
**Decision:** `READY_TO_RESUME_M12_V2_PHASE_6B`

---

## Phase 6B problem statement

Phase 6B proved Apex LADDER enrollment/refresh/enrichment correctness, but developer-key throughput was bursty:

| Phase 6B symptom | Observed |
| ---------------- | -------- |
| Shared 429 cooldowns | **3** activations |
| Full ~15m floors waited | **2** (~30 min lost wall time) |
| CD1 → CD2 re-trigger | **~17 seconds** (thrash) |
| Useful yield | +52 current-patch matches amid cooldown stalls |

Root cause: mostly-reactive control (`burst → 429 → shared 15m cooldown → resume → immediate re-429`). Enrichment fan-out after ingest was the dominant post-burst consumer. Shared cooldown worked as a safety net but was invoked too often.

---

## Riot call-site inventory

All production Riot HTTP still flows through `RiotApiClient.requestJson` → `RiotGameDataProvider` (API Nest / worker factory).

| Call class | Endpoint | Primary callers | Pre-6B.1 cooldown | Budget workload tag |
| ---------- | -------- | --------------- | ----------------- | ------------------- |
| Identity | Account-v1 (+ summoner-v4) | ladder enroll, resolvePlayer, product search | partial | `identity` |
| Ladder lists | League-v4 apex / tier pages | `LadderSeedService` | yes | `ladder` |
| Ranked entries | League-v4 by-PUUID | discovery softSync, product sync, enrichment | partial | `refresh` / `enrichment` / `product` |
| Match IDs | Match-v5 ids | collector discovery, product sync | collector yes | `refresh` / `product` / `match` |
| Match detail | Match-v5 match | match-ingestion worker | yes | `match` |
| Timeline | Match-v5 timeline | match-ingestion worker | publish-on-429 only | `match` |
| Enrichment | League-v4 by-PUUID | participant-rank-enrichment worker | yes | `enrichment` |

Competing consumers on one developer key: collector refresh, match ingest (+ timeline), enrichment, ladder, product search/refresh.

---

## Budget coordinator design

Smallest robust shared mechanism in `@league-helper/server-riot`:

1. **`RiotRequestBudgetStore`** — Redis Lua atomic reserve over:
   - short sliding window (default `20:1`)
   - long sliding window (default `100:120`)
   - enrichment max share (default **0.35** of short effective capacity)
   - product reserved share (default **0.10** of short effective capacity)
2. **Shared 429 cooldown key is read first** — active cooldown always wins (no admit).
3. **`RiotApiClient` gate** — `acquireForRequest` before every HTTP send; optional header observation after responses.
4. **Inline wait vs defer**:
   - short waits ≤ `RIOT_REQUEST_BUDGET_MAX_INLINE_WAIT_MS` (default 2s) sleep in-process
   - longer waits throw `RiotRequestBudgetDeferredError` (BullMQ delay / collector wave drain) **without** publishing 429 cooldown
5. **Header observation** (`X-App-Rate-Limit` / `Count`) updates ceilings and short pressure TTL; missing headers fall back to configured windows.

Emergency path unchanged: `429 → Retry-After → RiotSharedCooldownStore.extendCooldown → all consumers defer`.

---

## Workload priority

| Priority | Workload | Policy |
| -------- | -------- | ------ |
| 1 | `match` | Match detail/timeline/ids for source dataset |
| 2 | `refresh` | Tracked-root softSync + match-id discovery |
| 3 | `enrichment` | Capped share; may lag; ALL remains source-complete while `PENDING` |
| 4 | `ladder` / `identity` | New ladder acquisition / Account-v1 |
| 5 | `product` | PRODUCT_SEARCH / player refresh — reserved short-window headroom |

ALS helper `withRiotWorkload(...)` tags collector discovery (`refresh`), ingestion (`match`), enrichment (`enrichment`), product search/refresh (`product`). Explicit request `workload` on ladder/identity provider methods.

---

## Configuration

Example-only (real `.env` files **not** modified). Defaults enable pacing with developer-key headroom:

| Env | Default | Rationale |
| --- | ------- | --------- |
| `RIOT_REQUEST_BUDGET_ENABLED` | `true` | Opt-out available |
| `RIOT_REQUEST_BUDGET_UTILIZATION` | **0.75** | ~25% headroom for product/refresh/variance |
| `RIOT_REQUEST_BUDGET_SHORT_*` | `20` / `1s` | Observed developer-key short window |
| `RIOT_REQUEST_BUDGET_LONG_*` | `100` / `120s` | Observed developer-key long window |
| `RIOT_REQUEST_BUDGET_ENRICHMENT_MAX_SHARE` | `0.35` | Smooth post-ingest fan-out |
| `RIOT_REQUEST_BUDGET_PRODUCT_RESERVED_SHARE` | `0.10` | Keep PRODUCT_SEARCH acquirable |
| `RIOT_REQUEST_BUDGET_MAX_INLINE_WAIT_MS` | `2000` | Avoid holding workers on long waits |
| `RIOT_REQUEST_BUDGET_OBSERVE_HEADERS` | `true` | Use Riot counters when present |

Documented in `.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`.

---

## Tests

Focused coverage added/updated:

- `packages/server-riot/src/riot-request-budget.test.ts` — atomic reserve, multi-consumer short/long windows, utilization, cooldown override + resume, enrichment share, product reserve, header pressure + missing-header fallback, ALS workload gate, deferred error
- Existing `riot-shared-cooldown` / `riot-rate-limit` / `riot-api.client` (Retry-After unchanged)
- Worker: budget deferral classified as delayed **without** 429 cooldown publish; enrichment suite green
- API: RiotModule DI + discovery + collector config green

Commands run:

```text
pnpm --filter @league-helper/server-riot test -- src/riot-request-budget.test.ts
pnpm --filter @league-helper/server-riot typecheck
pnpm --filter @league-helper/api typecheck
pnpm --filter @league-helper/worker typecheck
pnpm --filter @league-helper/worker exec vitest run src/queues/participant-rank-enrichment
pnpm --filter @league-helper/api exec vitest run src/integrations/riot/riot.module.test.ts src/features/players/discovery/player-match-discovery.service.test.ts
```

---

## Comparative live validation

**Guard:** DB `league_helper_m12v2` only; real `.env` untouched; process-env budget defaults used (`utilization=0.75`, worker concurrency 1).  
**Population:** existing Apex LADDER roots only (no new tiers / no cap raises).  
**Wave:** make ≤12 roots eligible → `collector:run` batch 12 / maxMatches 5 / maxEnqueue 50 / concurrency 1 → drain ingest + enrichment.

Artifacts: `apps/api/.local/m12v2-phase6b1/`.

### Phase 6B baseline vs Phase 6B.1

| Metric | Phase 6B | Phase 6B.1 |
| ------ | -------- | ---------- |
| Roots refreshed (this wave) | 14/15 (multi-run) | **12/12 claimed succeeded** |
| Unique matches (420/na1) | +52 (23→75) | **+13** (83→96); 45/60 IDs already complete |
| Current-patch / window created | +52 | **+13** (`final-obs.createdInWindow`) |
| Wall-clock (useful work → drain) | ~30+ min with 2×15m floors | **~10 min** (05:53→06:03) |
| Riot admits (budget metrics) | n/a (no coordinator) | **111** (match 22 / refresh 24 / enrichment 65) |
| Proactive delayed / deferred | n/a | delayed **1985** / deferred **1945** (pacing + long-window waits) |
| 429 / shared cooldowns | **3** / ~30 min waited | **0 / 0** |
| Cooldown thrash (CD1→CD2 ~17s) | yes | **none** |
| Peak enrichment delayed backlog | 31 | **36** (budget defer, not 429 floor) |
| Queues at freeze | bounded | **drained** (waiting/active/delayed = 0) |
| Rank coverage (exact) | ~96.1% freeze | **98.0%** (`final-obs`) |
| Rank semantics | correct | **preserved** (`PENDING` remains; not dumped to UNKNOWN) |
| ALL aggregates (420/na1) | 180→370 (6B wave) | **382→395** (no decrease) |
| Champion-position ≥1 (all patches, wave metrics) | 28→218 (6B) | **257→268** |
| PRODUCT_SEARCH tracked | 1 | **1** (unchanged; product reserve unit-tested) |

Notes:

- Lower unique-match Δ vs 6B is expected: re-refresh of already-ingested Apex roots (45 skipped-complete), not first-touch enrollment.
- `ChampionAggregate` `UNKNOWN` row count rose in wave-metrics (10→133) while `RESOLVED_UNRANKED` participants stayed at 5 and `PENDING` remained 14 — treat as aggregate-row inventory/convergence noise to watch in later phases, **not** unresolved→UNKNOWN conversion (participants still show `PENDING`).

---

## Throughput assessment

**Is developer-key crawling now fast enough to continue representative acquisition?**

**Yes, cautiously — for bounded Apex-scale waves under this coordinator.**

Evidence:

- **Stability:** 0 shared 429 cooldowns; no back-to-back floor thrash; queues bounded then drained.
- **Useful work / wall time:** +13 unique matches in ~10 minutes without a 15-minute stall (vs 6B spending ~30 minutes idle on floors for +52 on first-touch roots).
- **Pacing cost:** enrichment waited on long-window capacity (~2 minutes) via proactive deferrals instead of a 15-minute emergency freeze — preferred.
- **Follow-up tweak:** enrichment BullMQ delay now uses `budgetDeferWaitMs` from the deferred error (avoids 2s wake/retry churn against a full 120s window). Deploy before the next larger wave.

Not a green light for uncapped continuous crawl or D/E/P expansion without another bounded check.

---

## Remaining limitations

1. Re-refresh of saturated roots understates unique-match throughput vs first-touch waves.
2. Long-window saturation still causes enrichment backlog (by design); delay sizing improved post-validation.
3. Product path was not live-hit during the wave (reserve covered by unit tests).
4. One Master LADDER root still missing RankSnapshot (pre-existing from 6B stop).
5. Watch UNKNOWN aggregate row growth vs participant `RESOLVED_UNRANKED` counts in later rank-audit work.
6. Operators should copy budget knobs from `.env.example` into real env when ready; code defaults already enable 0.75 utilization when Redis is present.

---

## Decision

**`READY_TO_RESUME_M12_V2_PHASE_6B`**

Rationale: required success criteria met (no cooldown thrash, no immediate re-429, queues bounded, rank semantics intact, ALL not decreased, emergency cooldown preserved, preferred 0 shared cooldowns on comparable bounded run). Stop for review before Phase 6C / larger population waves.

---

## Files changed (implementation)

### New

- `packages/server-riot/src/riot-request-budget.ts`
- `packages/server-riot/src/riot-request-budget-config.ts`
- `packages/server-riot/src/riot-request-budget-deferred.error.ts`
- `packages/server-riot/src/riot-request-workload.ts`
- `packages/server-riot/src/riot-request-budget.test.ts`
- `apps/api/scripts/phase6b1-budget-snapshot.mjs`
- `apps/api/scripts/phase6b1-make-ladder-eligible.mjs`
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-6b1-riot-budget-coordination-report.md`

### Modified

- `packages/server-riot/src/riot-api.client.ts`
- `packages/server-riot/src/riot-api.types.ts`
- `packages/server-riot/src/riot-game-data.provider.ts`
- `packages/server-riot/src/index.ts`
- `apps/api/src/integrations/riot/riot.module.ts`
- `apps/api/src/integrations/riot/riot.tokens.ts`
- `apps/api/src/features/players/discovery/player-match-discovery.service.ts`
- `apps/api/src/features/players/discovery/player-match-discovery.types.ts`
- `apps/api/src/features/collector/population-collector.service.ts`
- `apps/api/src/features/players/player-search.service.ts`
- `apps/api/src/features/players/player-refresh.service.ts`
- `apps/worker/src/provider.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/queues/match-ingestion/match-ingestion.processor.ts`
- `apps/worker/src/queues/match-ingestion/ingestion-error-classifier.ts`
- `apps/worker/src/queues/match-ingestion/ingestion-error-classifier.test.ts`
- `apps/worker/src/queues/participant-rank-enrichment/participant-rank-resolver.ts`
- `apps/worker/src/queues/participant-rank-enrichment/participant-rank-enrichment.service.ts`
- `.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`

### Untouched (as required)

- Real `.env` / `apps/api/.env` / `apps/worker/.env`
- Old DB `league_helper`
- Phase 6C / D/E/P / Gold / continuous crawler / frontend / matchups
- Git commit
