# M12-v2 Phase 2 Report — Rank-Dimension Foundation

**Date:** 2026-08-10  
**Branch:** `milestone-12-continuous-population-operations-v2`  
**Code baseline:** `395d251` (M11) + Phase 2 foundation changes (uncommitted)  
**Working DB:** `league_helper_m12v2`  
**Decision:** `READY_FOR_M12_V2_PHASE_3`

---

## M11 audit

Inspected current M11 rank path **before** Phase 2 code changes (abandoned M12 not used).

### Trace

1. **Match ingestion** (`apps/worker/.../match-persistence.ts`) → `loadRankTiersAtIngestion` for queues **420/440** only from local `RankSnapshot` at a stable cutoff.
2. **MatchParticipant create/update** writes nullable `rankTierAtIngestion` (never clears a known tier).
3. **Champion aggregation eligibility** (`eligibility.ts` `resolveRankTier`) mapped `null` / empty / invalid → aggregate sentinel **`UNKNOWN`**.
4. **ALL + exact keys** via `expandChampionDimensionTuples` default policy: exact + ALL-tier + ALL-position.
5. **Previous affected keys** = captured pre-overwrite participant snapshots → `expandPreviousDimensionKeys` → durable `ChampionAggregationRecalcScope.previousDimensionKeys` → union with current keys on recalc.
6. **`rankTierAtIngestion`** is `String?` (nullable) in Prisma; not an enum.
7. **Position normalization** (`normalizeParticipantPosition`) is a key dimension; SUPPORT↔MIDDLE changes are already covered by previous∪current union.
8. **Aggregation versions/key dims:** 9-tuple `[patch, platformRoute, regionalRoute, queueId, rankTier, position, championId, sourceNormalizationVersion, aggregationVersion]`.

### Where null became UNKNOWN

| Location | Behavior |
| -------- | -------- |
| `eligibility.ts` `resolveRankTier` | `null`/empty → `UNKNOWN` (invalid garbage also → `UNKNOWN` + counter) |
| `previous-keys.ts` `resolveRankTier` | same null→`UNKNOWN` for previous-key expansion |

**Honesty gap:** null meant “not resolved from local RankSnapshot” (unlinked / missing snapshot / non-ranked queue), but aggregation treated it as finalized UNKNOWN.

---

## Data model

### Enum `ParticipantRankResolutionStatus`

| Status | Meaning |
| ------ | ------- |
| `PENDING` | Lookup not completed |
| `FAILED_RETRYABLE` | Transient failure; retry later |
| `RESOLVED_RANKED` | Lookup completed with exact tier |
| `RESOLVED_UNRANKED` | Lookup completed; no applicable ranked entry |
| `FAILED_PERMANENT` | Documented permanent technical/data gap (e.g. missing PUUID) — **not** unranked |
| `NOT_APPLICABLE` | Non-420/440 queue — no Solo/Flex rank |

### `ParticipantRankObservation`

Durable append-only observations. **No** TrackedPlayer / PlayerAccount FK.

Fields: `id`, `provider`, `platformRoute`, `externalAccountId` (PUUID), `queueType`, `observedTier`, `observedDivision`, `resolutionStatus`, `observedAt`, `providerResultCode`, timestamps.

Indexes:

- `(provider, platformRoute, externalAccountId, queueType, observedAt DESC)` for latest lookup
- `(externalAccountId, queueType, observedAt)`
- `(resolutionStatus, observedAt)`

`observedAt` is **not** globally unique.

Freshness constant: `PARTICIPANT_RANK_OBSERVATION_FRESHNESS_MS = 6h` (Phase 3 policy starting point).

### `MatchParticipant` fields

| Field | Semantic |
| ----- | -------- |
| `rankTierAtIngestion` | **Preserved.** Rank observed during ingestion/enrichment cycle — **not** exact historical match-start rank |
| `rankDivisionAtIngestion` | Preserved (still unused by worker writer) |
| `rankResolutionStatus` | Explicit lifecycle (default `PENDING`) |
| `rankResolvedAt` | Timestamp when status reached a terminal/updated resolved state |
| `rankObservationId` | Optional FK → `ParticipantRankObservation` |

### Migration

- **Name:** `20260810190000_m12v2_participant_rank_foundation` (fresh; not abandoned `20260810160000_*`)
- **Replay-safe backfill:**
  - non-420/440 → `NOT_APPLICABLE`
  - ranked + missing PUUID → `FAILED_PERMANENT`
  - ranked + valid exact tier → `RESOLVED_RANKED`
  - ranked + null/invalid tier → `PENDING` (**never** silent UNKNOWN)
- Applied **only** to `league_helper_m12v2`

---

## Locked semantics

Centralized in `@league-helper/shared` → `classifyParticipantRankForAggregates`.

| Status | ALL | Exact tier | UNKNOWN | Permanent-unavailable diagnostic |
| ------ | --- | ---------- | ------- | -------------------------------- |
| `PENDING` | yes | no | no | no |
| `FAILED_RETRYABLE` | yes | no | no | no |
| `RESOLVED_RANKED(T)` | yes | T | no | no |
| `RESOLVED_UNRANKED` | yes | no | yes | no |
| `FAILED_PERMANENT` | yes | no | **no** | **yes** |
| `NOT_APPLICABLE` | yes | no | no | no |

Locked distinction:

```text
UNKNOWN               = successfully resolved as having no applicable rank
PERMANENT_UNAVAILABLE = rank could not be resolved for a documented permanent technical/data reason
```

They are not the same product bucket. Missing PUUID does not prove unranked.

**Canonical Camille SUPPORT proof:** 1 Challenger + 1 Grandmaster + 25 PENDING → `ALL=27`, exact=2, `UNKNOWN=0`, unresolved=25.

While enrichment is incomplete: `ALL` may exceed `sum(exact tiers + UNKNOWN)`. That is correct (unresolved + permanent-unavailable residuals).

**Phase 2 semantic correction:** `FAILED_PERMANENT` no longer maps to product UNKNOWN.

Normal eligibility filters (queue/patch/position/champion/invalid/version) still gate samples; rank resolution never bypasses them and never gates ALL.

---

## Aggregation convergence

### Generic affected-key approach

**One mechanism:** expand previous participant snapshots (status + tier + position) ∪ expand current contributors via `expandDimensionTuplesForRankClassification` / `expandDimensionKeysForRankClassification`.

No abandoned one-off UNKNOWN sibling patch.

Unresolved emits **ALL-tier only**. Exact / UNKNOWN (+ ALL-position) emit only when classification allows.

Contributor matching uses the same classification (`contributorFeedsKeyForRankClassification`) so PENDING samples never pollute UNKNOWN keys during recalculation.

### Transitions tested

- PENDING → DIAMOND  
- FAILED_RETRYABLE → MASTER  
- RESOLVED_UNRANKED → DIAMOND (stale UNKNOWN in affected set; absent from current)  
- DIAMOND → EMERALD  
- DIAMOND → RESOLVED_UNRANKED  
- same-state idempotent rerun  
- SUPPORT → MIDDLE position cleanup via previous∪current  

Properties covered: ALL key preserved, old exact/UNKNOWN leave current, empty rows deleted by existing recalc path, no duplicate contribution, idempotent.

---

## Metrics

Pure helpers in `packages/shared/src/participant-rank-quality.ts`:

| Metric | Definition |
| ------ | ---------- |
| `rankClassifiedSampleCount` | `RESOLVED_RANKED + RESOLVED_UNRANKED + FAILED_PERMANENT` |
| `rankUnresolvedSampleCount` | `PENDING + FAILED_RETRYABLE` |
| `permanentUnavailableSampleCount` | `FAILED_PERMANENT` (separate; never UNKNOWN) |
| `rankResolutionCoverage` | classified / denominator (excl. `NOT_APPLICABLE`) |
| `exactRankCoverage` | `RESOLVED_RANKED` / denominator (**includes** permanent-unavailable — they penalize exact coverage) |

### Health bands (`exactRankCoverage`)

| Range | Health | Warning |
| ----- | ------ | ------- |
| denominator 0 | `INSUFFICIENT_DENOMINATOR` | none (not RED) |
| `< 0.60` | `RED` | `RANK_COVERAGE_UNHEALTHY` |
| `[0.60, 0.80)` | `YELLOW` | none |
| `[0.80, 0.90)` | `HEALTHY_ISH` | none |
| `≥ 0.90` | `MATURE` | none |

Zero-denominator tested: returns `null` coverage + `INSUFFICIENT_DENOMINATOR` (empty DB is not “0% unhealthy”).

Population scaling **not** implemented in Phase 2.

---

## Tests

### Commands / results

```text
pnpm --filter @league-helper/shared test
→ 17 files / 176 tests passed

pnpm --filter worker exec vitest run src/queues/champion-aggregation src/cli/aggregates/aggregates-cli.test.ts
→ 7 files / 86 tests passed

pnpm --filter worker exec vitest run src/queues/match-ingestion/match-persistence.test.ts
→ 14 tests passed

pnpm --filter @league-helper/shared typecheck
pnpm --filter worker typecheck
pnpm --filter api typecheck
→ all exit 0

pnpm --filter api exec prisma validate
→ schema valid

DATABASE_URL=...league_helper_m12v2... prisma migrate status
→ 10 migrations, Database schema is up to date
```

Coverage includes resolution mapping, ALL/UNKNOWN inclusion rules, Camille canonical, convergence transitions, position cleanup, five champion-position smoke fixtures, metric formulas + health boundaries, enrichment job contract.

---

## DB validation

| Check | Result |
| ----- | ------ |
| Target DB | `league_helper_m12v2` |
| Migration head | `20260810190000_m12v2_participant_rank_foundation` |
| `ParticipantRankObservation` present on m12v2 | yes |
| Abandoned DB `league_helper` received new migration | **no** (`m12v2_migration` count = 0) |
| Real `.env` files edited by agent | **no** |
| Live participant-rank backfill / League-v4 flood | **not run** |
| Scheduler / crawler enable | **not done** |

---

## Redis orphan note

Phase 1 found BullMQ failed-set ≈ 30 orphan entries from the old environment; durable clean-DB jobs = 0.

**Phase 3 risk:** if the same Redis prefix / queue namespace is reused for `participant-rank-enrichment`, stale failed entries from unrelated historical jobs could clutter ops views. They should not process unless job names/payloads match the new contract.

**Operator hygiene (do not mass-delete without approval):**

1. Confirm BullMQ prefix (`BULLMQ_DEFAULT_PREFIX` / connection options).
2. Inspect failed counts for `match-ingestion` / `champion-aggregation` / future `participant-rank-enrichment`.
3. Prefer drain/clean of **known-orphan failed jobs** for queues that will be reused, after explicit approval.
4. Optional: use a distinct prefix for m12v2 if full Redis isolation is desired.

---

## Files changed

### Schema / migration

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260810190000_m12v2_participant_rank_foundation/migration.sql`

### Shared pure semantics + queue contract

- `packages/shared/src/participant-rank-resolution.ts` (+ test)
- `packages/shared/src/participant-rank-quality.ts` (+ test)
- `packages/shared/src/job-queues/participant-rank-enrichment-job.ts` (+ test)
- `packages/shared/src/job-queues/queue-names.ts`
- `packages/shared/src/job-queues/index.ts`
- `packages/shared/src/index.ts`

### Aggregation / ingestion

- `apps/worker/src/queues/champion-aggregation/eligibility.ts` (+ test)
- `apps/worker/src/queues/champion-aggregation/previous-keys.ts` (+ test)
- `apps/worker/src/queues/champion-aggregation/rank-dimension-keys.ts` (new)
- `apps/worker/src/queues/champion-aggregation/champion-aggregation.service.ts`
- `apps/worker/src/queues/champion-aggregation/champion-aggregation.repository.ts`
- `apps/worker/src/queues/champion-aggregation/champion-aggregation.service.test.ts`
- `apps/worker/src/queues/champion-aggregation/recalc-scope-race.test.ts`
- `apps/worker/src/queues/match-ingestion/match-persistence.ts`
- `apps/worker/src/cli/aggregates/rebuild-core.ts`
- `apps/worker/src/cli/aggregates/reconcile-core.ts`
- `apps/worker/src/cli/aggregates/audit-rank-core.ts`
- `apps/worker/src/cli/aggregates/status-core.ts`
- `apps/worker/src/cli/aggregates/aggregates-cli.test.ts`
- `apps/worker/scripts/prepare-test-db.mjs`
- `apps/api/src/persistence/match.repository.ts`

### Docs / examples

- `apps/worker/.env.example` (enrichment queue scaffold comments)
- `docs/superpowers/plans/2026-08-10-continuous-population-operations.md` (Phase 2 checkboxes)
- `docs/superpowers/plans/2026-08-10-m12-v2-phase-2-rank-foundation-report.md` (this file)

---

## Remaining Phase 3 work

**Scaffolding done (Phase 2):** data model, pure classification, aggregation eligibility/convergence, metrics, job payload/dedupe contract, migration on clean DB.

**Not yet implemented (Phase 3 live enrichment):**

1. Worker processor for `ENRICH_PARTICIPANT_RANK` (League-v4 entries/by-PUUID).
2. Enforce `RiotSharedCooldownStore` before Riot calls (unit test: cooldown active → no call, status stays retryable).
3. Write durable `ParticipantRankObservation` rows; update `MatchParticipant` status/tier/observation link.
4. Tiny co-participant validation (bounded; not population-scale backfill).
5. Enqueue enrichment from match ingestion for unresolved ranked participants.
6. Prove end-to-end convergence on live-ish tiny fixture data.
7. Optional operator Redis orphan cleanup before enabling the new queue.

Do **not** start Phase 3 without: `APPROVE M12_V2 PHASE 3` (plan phrase: `APPROVE M12-V2 PHASE 3`).

---

## Decision

`READY_FOR_M12_V2_PHASE_3`
