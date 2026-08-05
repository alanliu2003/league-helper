# `@league-helper/match-analytics`

Pure TypeScript math for champion aggregate statistics. No Prisma, NestJS, BullMQ, Redis, network, `process.env`, or app-layer imports.

Public API is exported only from `src/index.ts`.

## Exact vs materialized dimensions

- **Exact** dimensions describe one eligible participant contribution key:
  - concrete `platformRoute`, `regionalRoute`, `queueId` (not ALL / `-1` / `""`)
  - `rankTier`: `RankTier | 'UNKNOWN'` (never `'ALL'`)
  - `position`: `NormalizedPosition` including `'UNKNOWN'` (never `'ALL'`, never raw Riot positions)
- **Materialized** dimensions may additionally use approved `'ALL'` for **tier** and **position** only.

Raw Riot positions (`UTILITY`, `SOLO`, `DUO`, `DUO_CARRY`, `DUO_SUPPORT`) are rejected. Callers must pass already-normalized positions from `@league-helper/shared`.

## Sentinels

| Dimension | ALL sentinel | UNKNOWN |
|-----------|--------------|---------|
| platform / regional route | `""` (reserved; unused by default materialization) | n/a |
| queue | `-1` (reserved; unused by default) | n/a |
| rank tier | `'ALL'` | `'UNKNOWN'` |
| position | `'ALL'` | `'UNKNOWN'` |

`ALL` and `UNKNOWN` are distinct. Public helpers (`isAllPlatformRoute`, `isAllQueueId`, …) understand reserved ALL platform/region/queue values so API layers can reject them; default rollup never emits those keys.

## Rollup policy

Default (`DEFAULT_CHAMPION_ROLLUP_POLICY`):

- exact tuple
- ALL tier (same concrete position)
- ALL position (same concrete / UNKNOWN tier)
- **no** ALL×ALL
- **no** ALL platform / regional route / queue

For known tier + known position this yields **exactly 3 unique** materialized tuples.

## Dimension keys

```ts
JSON.stringify([
  patch, platformRoute, regionalRoute, queueId, rankTier, position,
  championId, sourceNormalizationVersion, aggregationVersion,
])
```

Fixed-order JSON array tuple (not object key order). Package field name is `position`; DB column will be `teamPosition` later.

## Accumulation

`emptyAccumulator` / `accumulateContribution` / `combineAccumulators` maintain storage-aligned totals:

- counters: `sampleSize`, `wins`, kills/deaths/assists, CS, game seconds, damage, vision
- timeline: GD10/GD15 and CSD10/CSD15 totals + sample counts
- `latestEligibleMatchAt`

Rules:

- `null` timeline values do **not** increment sample counters; totals stay `null` until the first present sample
- a real `0` difference with `samples > 0` is valid
- `combineAccumulators` is order-independent

## Match end timestamp

`resolveMatchEndedAt(gameEndTimestamp, gameCreation, gameDurationSeconds)`:

1. Prefer a valid finite game-end timestamp `> 0`
2. Else `gameCreation + gameDurationSeconds` only when creation is valid and duration is **strictly positive** and finite
3. Otherwise `null`

## Derived metrics

`deriveChampionAggregateMetrics(acc, { confidenceLevel, thresholds })`:

| Metric | Formula |
|--------|---------|
| win rate | `safeDivide(wins, sampleSize)` |
| Wilson interval | Wilson score interval at `confidenceLevel` (null if `sampleSize === 0`) |
| sample confidence | default thresholds: `<30` INSUFFICIENT, `<100` LOW, `<500` MEDIUM, else HIGH |
| aggregate KDA | see below |
| per-minute rates | `safeDivide(total, totalGameSeconds / 60)` |
| avg GD/CSD | `safeDivide(total, samples)` when `samples > 0` (including total `0`) |

### Aggregate KDA (player UI convention)

- `sampleSize === 0` → `null`
- `deaths > 0` → `(kills + assists) / deaths`
- `deaths === 0` and `kills + assists === 0` → `0`
- `deaths === 0` and `kills + assists > 0` → `kills + assists`

Never returns `NaN` / `Infinity`. **No display rounding** in this package.

## Wilson score interval

For binomial win rate with confidence level `c ∈ (0, 1)`:

- `p = wins / n`, `z = Φ⁻¹((1 + c) / 2)`
- center / margin via standard Wilson formula; bounds clamped to `[0, 1]`

## Purity rules

- Pure functions and types only
- Depend on `@league-helper/shared` for `RankTier` / `NormalizedPosition` only
- Do not import Prisma, NestJS, BullMQ, Redis, apps, or read `process.env`
- Do not call Riot or any network
