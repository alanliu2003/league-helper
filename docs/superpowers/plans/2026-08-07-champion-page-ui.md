# Champion Page UI + Data Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing Milestone 8 champion detail page into a League-themed, honestly sampled stats surface, after separating detail visibility from the 30-game ranking floor.

**Architecture:** Keep canonical `/champions/:championKey` and existing Nest/shared DTOs. Phase 1 changes detail aggregate reads to use `detailVisibilityMinimumSample = 1` (`sampleSize >= 1`) while ranking table queries continue to apply `CHAMPION_AGGREGATION_MIN_SAMPLE = 30`. Phases 2–3 evolve Nuxt hero/primary/performance/breakdown components on `--lh-*` tokens. Phase 4 readiness gate completed: **`SKIPPED — backend prerequisite`**. Phase 5 a11y/responsive/e2e/real-data smoke completed — committed on `milestone-10-champion-page-ui`.

**Tech Stack:** NestJS, Prisma, Zod (`@league-helper/shared`), `match-analytics`, Nuxt/Vue, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-08-07-champion-page-ui-design.md`

**Base commit:** `91a019f` (Milestone 9 Task 4 merged into `master`)

**Branch:** `milestone-10-champion-page-ui`

**Plan decisions (locked):**

1. Evolve existing M8 champion detail — do not greenfield rewrite.
2. Do **not** lower `CHAMPION_AGGREGATION_MIN_SAMPLE` (default 30) — this is `rankingMinimumSample`.
3. `detailVisibilityMinimumSample = 1` for exact + position breakdown (never 0 — avoids zero-sample rows via `gte 0`).
4. Backend detail contract correct by default — do **not** rely on Nuxt `includeInsufficient=true`.
5. Silently omit pick/ban from primary UI (no placeholders / denominator messaging).
6. No adjacent-champion header chips; omit hero ranking badge unless Phase 5 finds a cheap source.
7. No average K/D/A DTO expansion — `aggregateKdaRatio` only.
8. No player-page redesign; no public collector UI.
9. Matchups = follow-up milestone; Phase 4 readiness gate: **`SKIPPED — backend prerequisite`** (confirmed 2026-08-07).
10. **Do not commit unless the user explicitly asks.**
11. Each phase **STOP FOR REVIEW** before starting the next.

**Phase review gates:** stop after Phase 1, 2, 3, 4 (or skip note), and after Phase 5 verification — await review before proceeding.

---

## File structure

### Likely create

```text
apps/api/src/features/champions/champion-stats.detail-sample.integration.test.ts
  # optional dedicated integration coverage for sub-30 detail visibility

apps/web/components/champions/ChampionPrimaryStats.vue
apps/web/components/champions/ChampionPrimaryStats.test.ts
  # if SampleOverview is replaced rather than renamed in place
```

### Likely modify

```text
apps/api/src/features/champions/champion-stats.service.ts
apps/api/src/features/champions/champion-stats.service.test.ts
apps/api/src/features/champions/champions.integration.test.ts
apps/api/src/persistence/champion-aggregate-read.repository.ts
  # only if introducing an explicit visibilityMinimum vs rankingMinimum helper

apps/web/pages/champions/[championKey].vue
apps/web/composables/useChampionDetailPage.ts
apps/web/composables/useChampionDetailPage.test.ts
apps/web/components/champions/ChampionDetailHero.vue
apps/web/components/champions/ChampionDetailHero.test.ts
apps/web/components/champions/ChampionSampleOverview.vue   # or replace with ChampionPrimaryStats
apps/web/components/champions/ChampionPerformanceCards.vue
apps/web/components/champions/ChampionPositionBreakdown.vue
apps/web/components/champions/ChampionLimitationsPanel.vue
apps/web/e2e/champions.e2e.ts
apps/web/e2e/champion-api.mocks.ts

packages/shared/src/champion-api.ts
  # only if adding optional avg K/D/A or clarifying emptyReason semantics
```

### Do not modify (unless tiny nav bug)

```text
apps/web/components/player/**
apps/api/src/features/collector/**
MatchupAggregate writer (unless Phase 4 explicitly unlocked)
```

---

## PHASE 1 — Backend detail / ranking floor separation

**Status:** Implemented and committed.

**Gate:** STOP FOR REVIEW after Task 1–3 green.

### Task 1: Failing tests for detail visibility vs ranking floor

**Files:**

- Modify: `apps/api/src/features/champions/champion-stats.service.test.ts`
- Modify or create: integration test under `apps/api/src/features/champions/`

- [x] **Step 1: Write failing unit test — detail returns sub-30 metrics**

Add a test that seeds/mocks an exact aggregate with `sampleSize: 18`, calls `getChampionStats('Ahri', { tier: 'ALL', position: 'MIDDLE' })` **without** `includeInsufficient`, and expects:

```ts
expect(response.stats).not.toBeNull();
expect(response.stats?.metrics.sampleSize).toBe(18);
expect(response.stats?.metrics.sampleConfidence).toBe('INSUFFICIENT');
expect(response.emptyReason).toBeUndefined();
```

- [x] **Step 2: Write failing unit test — breakdown includes sub-30 roles**

Mock breakdown row with `sampleSize: 8` for `SUPPORT`. Expect that entry’s `metrics.sampleSize === 8` and `sampleConfidence === 'INSUFFICIENT'`.

- [x] **Step 3: Write failing/keeping test — ranking table still hides <30**

Keep/extend existing table test:

```ts
expect(tableResponse.rows).toEqual([]);
expect(tableResponse.emptyReason).toBe('BELOW_MINIMUM_SAMPLE');
```

for `sampleSize: 29` without `includeInsufficient`.

- [x] **Step 4: Run tests to verify detail cases fail on current code**

Run:

```bash
pnpm --filter @league-helper/api exec vitest run src/features/champions/champion-stats.service.test.ts
```

Expected: new detail visibility assertions FAIL (stats null / BELOW_MINIMUM_SAMPLE).

### Task 2: Implement `detailVisibilityMinimumSample = 1`

**Files:**

- Modify: `apps/api/src/features/champions/champion-stats.service.ts`
- Modify: `apps/api/src/features/champions/champion-stats-filters.ts` (only if helper clarity helps)
- Optionally modify: `apps/api/src/persistence/champion-aggregate-read.repository.ts`

- [x] **Step 1: Implement minimal service change**

In `getChampionStats`, build aggregate read scopes with `detailVisibilityMinimumSample = 1` for:

- `findExactAggregate`
- `findPositionBreakdown`

Keep ranking `getTable` on `shared.effectiveMinimumSample` (config floor unless `includeInsufficient`).

Suggested shape (illustrative):

```ts
const DETAIL_VISIBILITY_MINIMUM_SAMPLE = 1;

const detailVisibilityScope = {
  ...baseScope,
  minimumSample: DETAIL_VISIBILITY_MINIMUM_SAMPLE,
};
```

Still pass `this.config.minimumSample` (30) into `mapAggregateMetrics` as `insufficientBelow` so confidence labels remain honest.

When no visible row (`sampleSize < 1` / missing): `stats: null` + `CHAMPION_HAS_NO_STATS`. Do **not** emit `BELOW_MINIMUM_SAMPLE` for detail 1–29 rows (that empty reason remains ranking-table oriented).

Envelope `effectiveMinimumSample` remains the ranking/confidence floor (typically 30) — document in tests; do not rename the DTO.

- [x] **Step 2: Re-run unit tests**

```bash
pnpm --filter @league-helper/api exec vitest run src/features/champions/champion-stats.service.test.ts
```

Expected: PASS for new detail cases; table floor case still PASS.

- [x] **Step 3: Integration coverage**

If integration suite can seed aggregates, add assertion that HTTP `GET /api/champions/Ahri/stats?position=MIDDLE&...` returns metrics for `sampleSize < 30`.

Run:

```bash
pnpm test:api:integration
```

(or the package’s existing champions integration target).

- [x] **Step 4: STOP FOR REVIEW**

Do not start Phase 2 until review. **Do not commit** unless asked.

---

## PHASE 2 — Hero + context + primary stats

**Status:** Implemented and committed.

**Gate:** STOP FOR REVIEW after Task 4–6.

### Task 3: Primary stats presentation (low-sample first-class)

**Files:**

- Modify: `apps/web/components/champions/ChampionSampleOverview.vue`
  **or** Create: `ChampionPrimaryStats.vue` and update page import
- Modify: `apps/web/pages/champions/[championKey].vue`
- Tests beside the component

- [x] **Step 1: Failing UI test for limited-sample copy**

Assert that when metrics `{ sampleSize: 18, winRate: 0.542, sampleConfidence: 'INSUFFICIENT', wins: 10, ... }` render:

- Win rate visible (formatted)
- “18” / games visible
- Limited / insufficient labeling visible
- Not the old “Not enough collected matches meet the minimum sample size…” empty shell

- [x] **Step 2: Implement presentation**

Hierarchy:

1. Win rate (large)
2. Games / sample size (first-class)
3. W–L
4. Confidence indicator

Remove pick/ban placeholders entirely.

- [x] **Step 3: Wire page to show primary stats whenever** `exactMetrics` **exists** (including insufficient)

- [x] **Step 4: Unit test PASS**

### Task 4: Hero League UI Concept polish

**Files:**

- Modify: `apps/web/components/champions/ChampionDetailHero.vue` (+ test)

- [x] **Step 1: Strengthen splash-led hierarchy**

Requirements:

- Splash remains dominant background
- Readable gradient overlay (preserve/improve contrast)
- Name / title / icon / tags
- Patch + selected position context (can stay compact summary)
- **No** adjacent champion name chips
- Mobile: reduce min-height vs desktop (e.g. desktop ~16–18rem, mobile ~11–12rem — tune to tokens)

- [x] **Step 2: Tests for fallback initials when splash/icon fail; no adjacent-nav elements**
- [x] **Step 3: STOP FOR REVIEW** (with Task 3)

Context bar can remain the existing filter section in `[championKey].vue` for Phase 2; optional extract to `ChampionContextBar.vue` if it clarifies structure — not required.

---

## PHASE 3 — Performance + position breakdown

**Status:** Implemented and committed.

**Gate:** STOP FOR REVIEW after Task 5–6.

### Task 5: Performance panel bind + null honesty

**Files:**

- Modify: `apps/web/components/champions/ChampionPerformanceCards.vue` (+ test)

- [x] **Step 1: Confirm cards only format backend fields**

Keep: KDA, CS/min, DPM, Vision/min, GD@10/15, CSD@10/15.

Do not add KP, GPM, pick/ban.

- [x] **Step 2: Low-sample still shows cards when metrics present**

- [x] **Step 3: Null timeline metrics show “unavailable”, never** `0` **invented**

### Task 6: Position breakdown responsive + ungated samples

**Files:**

- Modify: `apps/web/components/champions/ChampionPositionBreakdown.vue` (+ test)

- [x] **Step 1: Desktop table remains; add mobile stacked row layout** (`md:` breakpoint)
- [x] **Step 2: Missing role = “No data”; never 0%**
- [x] **Step 3: Sub-30 role shows sample + INSUFFICIENT after Phase 1**
- [x] **Step 4: STOP FOR REVIEW**

---

## PHASE 4 — Matchups / counters (gated)

**Status:** SKIPPED — backend prerequisite (reviewed 2026-08-07 on `milestone-10-champion-page-ui`).

**Gate result:** NOT READY — do not implement matchup UI in Milestone 10.

### Task 7: Matchup readiness gate

- [x] **Step 1: Verify prerequisites** (all false as of this review)

| Prerequisite                                                 | Present? | Evidence                                                                                                           |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. Worker writes `MatchupAggregate` rows                     | **no**   | Prisma model only; worker aggregate pipeline has no matchup writer (only schema/table-name references in tests)    |
| 2. Public Nest matchup read endpoint                         | **no**   | No controller/service/repository route such as `GET /api/champions/:key/matchups`                                  |
| 3. Shared public matchup DTO/schema                          | **no**   | No matchup types in `packages/shared`                                                                              |
| 4. Documented stable matchup semantics + opponent resolution | **no**   | Schema dims exist; no public product contract for directional WR, sample floors, or opponent key/name/icon binding |

- [x] **Step 2A: NOT ready — skip documented**

**Phase 4 result: `SKIPPED — backend prerequisite`**

Do **not** add `ChampionMatchups` / Strong Against / Weak Against placeholders or mock numbers. Do **not** broaden this UI milestone into a matchup backend milestone. Matchups remain a follow-up backend/data milestone.

- [ ] **Step 2B: If ready — implement** — N/A (skipped)

- [x] **Step 3: STOP FOR REVIEW** — await Phase 5 approval before polish/e2e work.

---

## PHASE 5 — Polish, a11y, e2e, real-data smoke

**Status:** Implemented and committed (`f115b5c`).

**Gate:** Final STOP FOR REVIEW / merge readiness.

### Task 8: SEO + a11y + navigation polish

**Files:**

- Modify: `apps/web/pages/champions/[championKey].vue`
- Modify: `apps/web/composables/useChampionDetailPage.ts` (optional preserve-last-stats)
- Modify: `apps/web/utils/champion-links.ts` only if back-link helper needs a tweak

- [x] **Step 1: Add** `useSeoMeta` **description** when champion metadata loaded (name + title + collected-sample framing)
- [x] **Step 2: Heading / radiogroup / contrast checklist against spec §13**
- [x] **Step 3: If animations added, respect** `prefers-reduced-motion`
- [x] **Step 4: Filter-preserving back link** — replace hardcoded `/champions` with `buildChampionsDirectoryPath({ platform, queue, tier, position, patch })`
- [x] **Step 5 (optional partial):** `aria-busy` on stats region while pending; keep clearing prior metrics on filter/position change (avoids stale WR flash). Full last-good soft-refresh deferred.
- [ ] **Step 6 (optional):** `.lh-skeleton` loading blocks — skipped (text loading + reserved hero min-height sufficient)

### Task 9: Playwright + mocks

**Files:**

- Modify: `apps/web/e2e/champions.e2e.ts`
- Modify: `apps/web/e2e/champion-api.mocks.ts`

- [x] **Step 1: Add scenario — detail with sampleSize 18 shows win rate + limited sample**
- [x] **Step 2: Keep assertions — no matchup mock numbers; no puuid leakage**
- [x] **Step 3: Canonical key replace + numeric reject still covered**

Run:

```bash
pnpm --filter @league-helper/web test:e2e
```

(or repo’s documented e2e script from README).

### Task 10: Real-data smoke (manual)

Against local API with collected aggregates:

1. Open a champion with 0 games for a position → honest empty
2. Open a champion with 1–29 games → stats visible + limited sample
3. Open a champion with ≥30 → confidence not INSUFFICIENT solely due to floor; ranking table may list them
4. Switch positions → URL + stats update; no stale flash
5. Mobile width smoke
6. Confirm no collector/scheduler fields in DOM

- [x] **Step 1: Record smoke results in review note** — Ahri MIDDLE `CHAMPION_HAS_NO_STATS`; Diana MIDDLE `sampleSize=1` / `INSUFFICIENT` / GD@10=-115; Top switch clears stale metrics; mobile 375px no overflow (Playwright Edge live smoke + API curl). Local DB has no ≥30 bucket (acceptable; covered by backend tests).
- [x] **Step 2: Run format/lint/typecheck/relevant unit tests** — `pnpm lint` pass; `pnpm typecheck` pass; `pnpm test` pass (all packages); `pnpm build` pass; focused web/backend champion suites pass; Playwright champions e2e 15/15 via msedge. Repo-wide `pnpm format:check` still fails on many pre-existing files outside M10; M10 touched sources Prettier-clean.
- [x] **Step 3: FINAL STOP FOR REVIEW** — commit only if user requests

---

## Real-data validation checklist

| Case            | Expected                                                                                |
| --------------- | --------------------------------------------------------------------------------------- |
| 0 games         | Hero + filters; empty exact stats; breakdown “No data” roles                            |
| 1–29 games      | Stats shown; Limited/INSUFFICIENT; not in ranking eligibility messaging as ranked       |
| ≥30 games       | Stats + non-insufficient confidence band by thresholds; may appear in directory ranking |
| Splash missing  | Gradient fallback; identity still readable                                              |
| Stats API error | Hero still visible; section error                                                       |
| Matchups        | Absent unless Phase 4 unlocked                                                          |

---

## Out of scope reminders

- Pick rate / ban rate implementation
- Matchup aggregation pipeline (unless unlocked)
- Player page redesign
- Directory redesign
- Collector public UI
- Lowering min sample
- Commits without explicit ask

---

## Spec coverage map

| Spec area                  | Plan tasks                    |
| -------------------------- | ----------------------------- |
| Sample floor separation    | Task 1–2                      |
| Hero / League UI Concept   | Task 4                        |
| Primary stats + low-sample | Task 3                        |
| Performance metrics        | Task 5                        |
| Position breakdown         | Task 6                        |
| Matchups gated             | Task 7                        |
| a11y / SEO / e2e / smoke   | Task 8–10                     |
| No pick/ban fabrication    | Tasks 3, 5, 7, 9              |
| No collector UI            | File structure + out of scope |

---

## Execution handoff (after Phase 0 approval)

When the user approves this plan and asks to implement:

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — execute in this session with checkpoints

Do not start Phase 1 until Phase 0 review approval.
