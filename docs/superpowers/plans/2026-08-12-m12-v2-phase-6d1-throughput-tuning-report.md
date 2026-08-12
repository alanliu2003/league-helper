# M12-v2 Phase 6D.1 Report — Collector Throughput / Soft-Gate Tuning

**Date:** 2026-08-12  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Working DB:** `league_helper_m12v2` (verified; `league_helper` untouched)  
**Real `.env` files:** not modified (process-env budget/concurrency overrides only)  
**Decision:** `READY_FOR_M12_V2_PHASE_6E`

Stopped for review. Phase 6E / Silver / Bronze / Iron / continuous crawler were **not** started.

---

## Root cause

Phase 6D paced refresh used an ops-script soft long-window gate at **55** while:

- shared Riot budget utilization ceiling ≈ **75** (`floor(100 * 0.75)`)
- hard long-window heuristic = **85**
- **184 / 264** soft waits occurred with `enrichPending=0`

`longWin` is the Redis `ZCARD` of `riot:request-budget:win:long` — the **current observed** count of reserved/admitted requests in the sliding long window (approximate live pressure). It is not a separate future reservation beyond what `RiotRequestBudgetStore` already counted.

The soft gate therefore duplicated (and undercut) protection already provided by the shared coordinator: the collector idled well below the approved admission envelope. Bottleneck was proactive idle time, not 429 pressure.

Phase 6C comparison context: enrichment-only soft gate (`enrichPending <= 10`), no long-window soft=55 → ~43 s/root, ~424 matches/hour.

---

## Existing soft/hard semantics

| Layer | Role | Phase 6D value | Notes |
| ----- | ---- | -------------- | ----- |
| `RiotRequestBudgetStore` | **Authoritative admission** | util **0.75**, short/long windows, enrichment share, product reserve | Unchanged |
| Shared 429 cooldown | Emergency floor | Retry-After aware | Unchanged |
| Soft enrich pending | Ops paced-loop heuristic | 40 | Unchanged |
| Hard enrich pending | Ops paced-loop heuristic | 120 | Unchanged |
| Soft long-window | Ops paced-loop heuristic | **55** (over-conservative) | Tuned this phase |
| Hard long-window | Ops paced-loop heuristic | **85** | Kept |

Hard=85 is intentionally **above** the util ceiling (~75). It is a queue/pressure heuristic for unusually full observed windows (e.g. header skew), **not** a second request-admission controller. Normal coordinator pacing admits up to ~75; hard waits should remain rare.

Soft wait interval was fixed 15s; hard 25s; cooldown 20s (no busy-spin).

---

## Change made

Promoted collector paced-refresh pressure into a pure, tested module:

`apps/api/src/features/collector/collector-riot-pressure.ts`

### Threshold semantics (config-derived)

```text
effectiveLongBudget = floor(RIOT_REQUEST_BUDGET_LONG_LIMIT * UTILIZATION)  # 75
softLongWindow      = effectiveLongBudget - SOFT_LONG_SAFETY_MARGIN         # 75 - 4 = 71
hardLongWindow      = COLLECTOR_RIOT_PRESSURE_HARD_LONG_WINDOW              # 85 (heuristic)
```

### Enrichment-aware soft wait

Soft long-window wait requires **both**:

1. `longWindowMembers > softLongWindow`
2. `enrichPending >= LONG_SOFT_MIN_ENRICH_PENDING` (default **1**)

So `enrichPending=0` never soft-idles solely because `longWin` crossed the soft gate. Soft enrichment backlog (`enrichPending > 40`) still slows the collector. Hard gates and shared cooldown unchanged.

### Wait timing

When waiting, prefer budget-suggested `waitMs` when present (floored at 5s, capped at 60s). Otherwise use configured soft/hard/cooldown waits. No rapid retry spam.

### Configuration (example env only)

Documented in `.env.example` / `apps/api/.env.example`:

- `COLLECTOR_RIOT_PRESSURE_SOFT_LONG_SAFETY_MARGIN=4`
- `COLLECTOR_RIOT_PRESSURE_HARD_LONG_WINDOW=85`
- `COLLECTOR_RIOT_PRESSURE_SOFT_ENRICH_PENDING=40`
- `COLLECTOR_RIOT_PRESSURE_HARD_ENRICH_PENDING=120`
- `COLLECTOR_RIOT_PRESSURE_LONG_SOFT_MIN_ENRICH_PENDING=1`
- wait ms knobs

Worker `.env.example` notes that pressure knobs are API/collector-side; worker continues to honor `RiotRequestBudgetStore` + shared cooldown only.

**Not weakened:** utilization 0.75, short/long enforcement, enrichment max share, product reserved share, shared 429 cooldown, Retry-After, emergency floor, rank enrichment correctness.

---

## Why chosen threshold is safe

| Check | Result |
| ----- | ------ |
| Soft below util ceiling | 71 < 75 |
| Soft below hard | 71 < 85 |
| Hard above util ceiling | 85 > 75 (heuristic headroom) |
| Admission authority | still `RiotRequestBudgetStore` on every HTTP send |
| Product reserve | unchanged (unit-tested in server-riot) |
| Enrichment fairness | soft enrich=40 / hard=120 retained; long soft requires backlog |

Candidate range from Phase 6D evidence was ~70–72. Derived **71** matches that without blindly setting 75.

---

## Tests

```text
pnpm --filter @league-helper/api exec vitest run \
  src/features/collector/collector-riot-pressure.test.ts \
  src/features/collector/collector.config.test.ts \
  src/features/collector/collector-refresh-policy.test.ts
pnpm --filter @league-helper/server-riot test -- src/riot-request-budget.test.ts
pnpm --filter @league-helper/api typecheck
```

Coverage includes:

1. below soft → proceed  
2. old 55–new soft with `enrichPending=0` → proceed  
3. near soft with enrichment pressure → soft wait  
4. above hard → hard wait  
5. shared cooldown → defer  
6. budget suggested waitMs respected (no busy-spin)  
7. product/utilization defaults unchanged via pressure loader  
8. no bypass of budget store (documented + unchanged call path)  
9. config-derived soft from util + margin  
10. enrich threshold inversion rejected; soft clamped below hard  

---

## Live validation

**Guard:** DB `league_helper_m12v2`; worker rebuilt + restarted with util 0.75 / concurrency 1; real `.env` untouched.

**Cohort:** 25 existing Apex LADDER roots (C11 / GM8 / M6), oldest successful refreshes (~22h), no new tiers / no cap raises.

**Ops note:** one mid-wave `PARTIAL` (budget defer, 82ms) initially aborted by an over-strict harness check; resumed with the same soft-gate policy to finish remaining roots. Not a 429 / cooldown event.

| Metric | Value |
| ------ | ----- |
| Roots refreshed | **25 / 25** |
| Wall clock | **13.05 min** (03:43:52 → 03:56:55 UTC) |
| Sec / root | **31.3** |
| Discovered / skipped / enqueued | 125 / 81 / 44 |
| Duplicate rate | **64.8%** (Apex re-refresh; expected) |
| New matches (420/na1) | **885 → 929 (+44)** |
| Matches / hour | **~202** |
| Soft wait ticks | **8** (~120 s) |
| Soft waits `enrichPending=0` | **0** |
| Hard waits | **0** |
| Shared cooldowns / 429 thrash | **0 / none** |
| Budget admits (wave metrics) | 382 (match 83 / refresh 50 / enrichment 249) |
| Delayed / deferred | 401 / 118 (proactive pacing) |
| Queue peaks | ingest ≤1, enrich ≤20, agg ≤1 |
| Queue drain | **all waiting/active/delayed = 0** |
| Rank health | **MATURE** — exact ~99.8%, resolution 100%, PENDING 0 |

Artifacts: `apps/api/.local/m12v2-phase6d1/**`.

---

## Phase 6D comparison

| Metric | Phase 6D | Phase 6D.1 | Phase 6C (ref) |
| ------ | -------- | ---------- | -------------- |
| roots refreshed | 40 | **25** | 80 |
| new matches | +185 (focused) / +206 unique | **+44** | (wave-dependent) |
| sec/root | ~121 | **~31.3** | ~43 |
| matches/hour | ~125 | **~202** | ~424 |
| soft waits | 264 | **8** | n/a (enrich-only) |
| soft wait seconds | ~3960 | **120** | — |
| soft waits enrichPending=0 | 184 | **0** | — |
| hard waits | 0 | **0** | — |
| 429 / shared cooldowns | 0 / 0 | **0 / 0** | 0 / 0 |
| queue drain | yes | **yes** | yes |
| rank health | MATURE | **MATURE** | MATURE |

Notes:

- Absolute matches/hour is below Phase 6C primarily because this cohort was **duplicate-heavy Apex re-refresh** (64.8% skip), not fresh Gold enrollment. Throughput *efficiency* (sec/root, soft idle) recovered to / past the 6C operating range.
- Soft idle time collapsed: ~3960s → **120s**; unnecessary `enrichPending=0` soft waits **184 → 0**.

---

## Throughput verdict

**A. TUNING_SUCCESSFUL_READY_FOR_6E**

Evidence:

1. Soft idle time materially decreased  
2. Soft waits with `enrichPending=0` eliminated  
3. No 429 / shared-cooldown thrash  
4. Hard safety intact (hard waits 0; hard gate still 85)  
5. Global budget coordinator remained authoritative (admits/deferred pacing present; no bypass)  
6. Queues bounded and drained  
7. Rank correctness unchanged (MATURE, PENDING=0)  
8. Product reserve unchanged  

---

## Recommendation

`READY_FOR_M12_V2_PHASE_6E`

Phase 6E = later Silver / Bronze / Iron representative expansion.

**Do not start automatically.** Apply the new collector pressure defaults for future paced waves; keep global util at 0.75.

### What passed

- Soft gate raised to config-derived **71** with enrichment awareness  
- sec/root **121 → 31.3**; soft waits **264 → 8**; enrichPending=0 soft waits **184 → 0**  
- matches/hour **125 → ~202** under duplicate-heavy cohort  
- 0 shared cooldowns; queues drained; rank MATURE  

### Limitations

1. Live cohort was Apex re-refresh (high duplicate %) — not a fresh Gold yield comparison.  
2. Pressure policy is used by paced multi-batch orchestration; single `collector:run` still relies on `RiotRequestBudgetStore` + shared cooldown (unchanged, correct).  
3. One harness PARTIAL abort required resume (ops tooling issue, not rate-limit thrash).

---

## Files changed

| File | Change |
| ---- | ------ |
| `apps/api/src/features/collector/collector-riot-pressure.ts` | **new** pressure policy module |
| `apps/api/src/features/collector/collector-riot-pressure.test.ts` | **new** focused tests |
| `.env.example` | pressure knobs + docs |
| `apps/api/.env.example` | pressure knobs + docs |
| `apps/worker/.env.example` | pointer note (no duplicated thresholds) |
| `docs/superpowers/plans/2026-08-12-m12-v2-phase-6d1-throughput-tuning-report.md` | this report |
| `apps/api/.local/m12v2-phase6d1/**` | live validation artifacts (local only) |
